// Minimal, dependable migration runner: applies db/migrations/*.sql in order, once.
import { pool } from '../src/db.js';
import migrations from './migrations/index.js';

export async function migrate({ reset = false, log = console.log } = {}) {
  const c = await pool.connect();
  try {
    if (reset) {
      log('Resetting database schema…');
      await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const { name: f, sql } of migrations) {
      if (done.has(f)) continue;
      log(`Applying ${f}`);
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Migration ${f} failed: ${e.message}`);
      }
    }
  } finally {
    c.release();
  }
}

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === `file://${process.argv[1]}`) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => { console.log('Migrations complete'); return pool.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
