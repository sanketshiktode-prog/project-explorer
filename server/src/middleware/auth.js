import crypto from 'node:crypto';
import { query } from '../db.js';
import { config } from '../config.js';
import { forbidden, HttpError } from '../lib/util.js';

export const COOKIE = 'pe_session';
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');

export async function createSession(res, user, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip) VALUES ($1,$2,$3,$4,$5)',
    [hash(token), user.id, expires, String(req.headers['user-agent'] || '').slice(0, 300), req.ip]);
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires, path: '/' });
}

export async function destroySession(req, res) {
  const t = req.cookies?.[COOKIE];
  if (t) await query('DELETE FROM sessions WHERE token_hash = $1', [hash(t)]);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Attach req.user if a valid session exists. Deactivated users are rejected immediately. */
export async function loadUser(req, _res, next) {
  try {
    const t = req.cookies?.[COOKIE];
    if (!t) return next();
    const r = await query(`SELECT u.id, u.email, u.name, u.picture_url, u.is_active, r.key AS role_key, r.name AS role_name, r.permissions
      FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`, [hash(t)]);
    const u = r.rows[0];
    if (u && u.is_active) {
      req.user = { ...u, permissions: new Set(u.permissions) };
      query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [hash(t)]).catch(() => {});
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  next();
}

export const requirePerm = (...perms) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in'));
  if (!perms.every((p) => req.user.permissions.has(p))) return next(forbidden());
  next();
};

/** Light CSRF defence: state-changing requests must be same-site AND carry our custom header. */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'project-explorer') return next(new HttpError(403, 'Missing request header'));
  next();
}
