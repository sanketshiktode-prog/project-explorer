// Cloudflare Workers entry point. Runs the same Express app via Cloudflare's Node.js HTTP server
// support; the React build is served by Workers Static Assets (see wrangler.jsonc).
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { createApp } from './app.js';
import { newPool, runWithPool } from './db.js';
import { migrate } from '../db/migrate.js';

let ready = null; // migrations (+ first-time seed) run once per isolate

async function prepare() {
  await migrate({ log: () => {} });
  const mode = process.env.SEED_ON_EMPTY;
  if (mode && ['production', 'sample', 'reference'].includes(mode)) {
    const { query } = await import('./db.js');
    const { n } = (await query('SELECT count(*)::int n FROM roles')).rows[0];
    if (n === 0) {
      const { seedAll } = await import('../db/seed/index.js');
      await seedAll(console.log, { workbook: mode !== 'reference', sample: mode === 'sample' });
    }
  }
}

const app = createApp({
  worker: true,
  perRequest(req, res, next) {
    const cs = env.HYPERDRIVE?.connectionString || process.env.DATABASE_URL;
    if (!cs) return next(Object.assign(new Error('Database is not connected. Add a Hyperdrive binding (HYPERDRIVE) or a DATABASE_URL secret.'), { status: 500 }));
    const pool = newPool(cs, 4);
    let ended = false;
    const end = () => { if (!ended) { ended = true; pool.end().catch(() => {}); } };
    res.on('finish', end);
    res.on('close', end);
    runWithPool(pool, async () => {
      try {
        if (!ready) ready = prepare().catch((e) => { ready = null; throw e; });
        await ready;
        next();
      } catch (e) { next(e); }
    });
  },
});

app.listen(8080);
export default httpServerHandler({ port: 8080 });
