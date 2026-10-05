// Central runtime configuration. Read lazily so it also works on Cloudflare Workers,
// where variables/secrets are injected into process.env at start-up.
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));
const env = (k) => (typeof process !== 'undefined' ? process.env[k] : undefined);

export const config = {
  get env() { return env('NODE_ENV') || 'development'; },
  get port() { return Number(env('PORT') || 4000); },
  get databaseUrl() { return env('DATABASE_URL') || 'postgres://postgres@localhost:5432/explorer'; },
  get googleClientId() { return env('GOOGLE_CLIENT_ID') || ''; },
  // Optional: restrict Google sign-in to a Workspace domain (e.g. propertypistol.com)
  get allowedDomain() { return env('ALLOWED_GOOGLE_DOMAIN') || ''; },
  // Comma-separated emails auto-provisioned as admin on first sign-in (bootstrap only)
  get bootstrapAdmins() { return (env('BOOTSTRAP_ADMIN_EMAILS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); },
  // Developer sign-in (pick a seeded user without Google). Never enabled in production.
  get devLogin() { return bool(env('AUTH_DEV_LOGIN'), false) && env('NODE_ENV') !== 'production'; },
  get sessionDays() { return Number(env('SESSION_DAYS') || 14); },
  get cookieSecure() { return bool(env('COOKIE_SECURE'), env('NODE_ENV') === 'production'); },
  get staticDir() { return env('STATIC_DIR') || new URL('../../client/dist', import.meta.url).pathname; },
};
