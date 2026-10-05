import { Router } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { query } from '../db.js';
import { config } from '../config.js';
import { createSession, destroySession } from '../middleware/auth.js';
import { HttpError, badRequest } from '../lib/util.js';
import { writeAudit } from '../services/records.js';

const r = Router();
// Google's public signing keys (cached by jose); works on Node and Cloudflare Workers
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

// Tiny in-memory rate limit for sign-in endpoints (per IP, 20 attempts / 5 min)
const hits = new Map();
function limit(req, _res, next) {
  const now = Date.now();
  const k = req.ip;
  const arr = (hits.get(k) || []).filter((t) => now - t < 300000);
  arr.push(now);
  hits.set(k, arr);
  if (arr.length > 20 && process.env.NODE_ENV !== 'test') return next(new HttpError(429, 'Too many sign-in attempts. Wait a few minutes.'));
  next();
}

// Overridable in tests
let verifyGoogleToken = async (idToken) => {
  if (!config.googleClientId) throw new HttpError(500, 'Google sign-in is not configured (GOOGLE_CLIENT_ID)');
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.googleClientId,
  });
  return payload;
};
export const setGoogleVerifier = (fn) => { verifyGoogleToken = fn; };

r.get('/config', (_req, res) => {
  res.json({ google_client_id: config.googleClientId || null, dev_login: config.devLogin, allowed_domain: config.allowedDomain || null });
});

async function signIn(req, res, email, profile = {}) {
  email = String(email || '').toLowerCase().trim();
  let u = (await query('SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.email) = $1', [email])).rows[0];
  if (!u && config.bootstrapAdmins.includes(email)) {
    const role = (await query("SELECT id FROM roles WHERE key='admin'")).rows[0];
    u = (await query('INSERT INTO users (email, name, role_id) VALUES ($1,$2,$3) RETURNING *', [email, profile.name || email, role.id])).rows[0];
  }
  if (!u) throw new HttpError(403, `${email} is not an approved user. Ask an administrator to add you.`);
  if (!u.is_active) throw new HttpError(403, 'Your access has been deactivated. Contact an administrator.');
  if (profile.sub || profile.picture) await query('UPDATE users SET google_sub = COALESCE($2, google_sub), picture_url = COALESCE($3, picture_url), name = COALESCE(name, $4) WHERE id = $1', [u.id, profile.sub || null, profile.picture || null, profile.name || null]);
  await createSession(res, u, req);
  await writeAudit({ query: (...a) => query(...a) }, [{ user_id: u.id, action: 'login', entity: 'user', entity_id: String(u.id), note: profile.method || 'google' }]);
  res.json({ ok: true });
}

r.post('/google', limit, async (req, res, next) => {
  try {
    const { credential } = req.body || {};
    if (!credential) throw badRequest('Missing Google credential');
    let payload;
    try { payload = await verifyGoogleToken(credential); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(401, 'Google sign-in could not be verified'); }
    if (!payload?.email || payload.email_verified === false) throw new HttpError(401, 'Google account email is not verified');
    if (config.allowedDomain && payload.hd !== config.allowedDomain && !payload.email.toLowerCase().endsWith(`@${config.allowedDomain}`)) {
      throw new HttpError(403, `Only ${config.allowedDomain} accounts can sign in`);
    }
    await signIn(req, res, payload.email, { sub: payload.sub, picture: payload.picture, name: payload.name, method: 'google' });
  } catch (e) { next(e); }
});

// Developer sign-in for local testing — disabled unless AUTH_DEV_LOGIN=true and not in production.
r.get('/dev-users', async (_req, res, next) => {
  try {
    if (!config.devLogin) throw new HttpError(404, 'Not found');
    const u = await query('SELECT u.email, u.name, r.name AS role, u.is_active FROM users u JOIN roles r ON r.id=u.role_id ORDER BY r.id, u.name');
    res.json(u.rows);
  } catch (e) { next(e); }
});
r.post('/dev-login', limit, async (req, res, next) => {
  try {
    if (!config.devLogin) throw new HttpError(404, 'Not found');
    await signIn(req, res, req.body?.email, { method: 'dev-login' });
  } catch (e) { next(e); }
});

r.post('/logout', async (req, res, next) => {
  try { await destroySession(req, res); res.json({ ok: true }); } catch (e) { next(e); }
});

r.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const { permissions, ...u } = req.user;
  res.json({ ...u, permissions: [...permissions] });
});

export default r;
