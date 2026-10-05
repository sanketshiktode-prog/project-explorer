import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from '../db/migrate.js';
import { pool } from './db.js';

if (process.env.MIGRATE_ON_START !== 'false') await migrate({ log: () => {} });

// First boot on an empty database: load starting data without needing a shell.
//   SEED_ON_EMPTY=production → reference data + the 9 workbook projects
//   SEED_ON_EMPTY=sample     → reference data + workbook + 33 fictional sample projects
//   SEED_ON_EMPTY=reference  → reference data only
const mode = process.env.SEED_ON_EMPTY;
if (mode && ['production', 'sample', 'reference'].includes(mode)) {
  const { n } = (await pool.query('SELECT count(*)::int n FROM roles')).rows[0];
  if (n === 0) {
    const { seedAll } = await import('../db/seed/index.js');
    console.log(`Empty database — seeding (${mode})…`);
    await seedAll(console.log, { workbook: mode !== 'reference', sample: mode === 'sample' });
  }
}

createApp().listen(config.port, () => {
  console.log(`Project Explorer API listening on :${config.port} (${config.env})${config.devLogin ? ' — DEV LOGIN ENABLED' : ''}`);
});
