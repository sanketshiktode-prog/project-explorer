import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

// Return BIGINT / NUMERIC as JS numbers (our money values stay < 2^53).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// DATE stays a plain 'YYYY-MM-DD' string — no timezone shifting.
pg.types.setTypeParser(1082, (v) => v);

// On a normal server one long-lived pool is shared. On Cloudflare Workers a connection cannot be
// reused across requests, so the Worker entry runs each request inside runWithPool() with its own
// small pool (Hyperdrive does the real pooling at the edge).
const als = new AsyncLocalStorage();
let sharedPool = null;
function shared() {
  if (!sharedPool) sharedPool = new pg.Pool({ connectionString: config.databaseUrl, max: Number(process.env.DB_POOL || 10) });
  return sharedPool;
}
export const getPool = () => als.getStore() || shared();
export const runWithPool = (p, fn) => als.run(p, fn);
export const newPool = (connectionString, max = 4) => new pg.Pool({ connectionString, max });

/** Back-compat facade: behaves like a pg.Pool but always targets the current pool. */
export const pool = {
  query: (...a) => getPool().query(...a),
  connect: () => getPool().connect(),
  end: () => (sharedPool ? sharedPool.end() : Promise.resolve()),
};

export const query = (text, params) => getPool().query(text, params);

/** Run fn inside a transaction. fn receives a client with .query */
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
