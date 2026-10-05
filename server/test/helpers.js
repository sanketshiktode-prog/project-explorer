import './setup.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../db/migrate.js';
import { seedAll } from '../db/seed/index.js';
import { pool } from '../src/db.js';
import { invalidate } from '../src/services/meta.js';

export const app = createApp();

export async function resetDb() {
  await migrate({ reset: true, log: () => {} });
  await seedAll(() => {});
  invalidate();
}

/** A logged-in agent that sends the CSRF header automatically. */
export async function agentFor(email) {
  const a = request.agent(app);
  const r = await a.post('/api/auth/dev-login').set('x-requested-with', 'project-explorer').send({ email });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  const wrap = (m) => (url) => a[m](url).set('x-requested-with', 'project-explorer');
  return { raw: a, get: (u) => a.get(u), post: wrap('post'), patch: wrap('patch'), put: wrap('put'), del: wrap('delete') };
}

export const q1 = async (sql, p) => (await pool.query(sql, p)).rows[0];
export const qa = async (sql, p) => (await pool.query(sql, p)).rows;
export { pool, request };
