// Seeds reference data + the Navi Mumbai workbook projects + synthetic sample projects.
// Usage: npm run seed            (expects an empty, migrated database)
//        npm run reset-db        (drop, migrate, seed)
import { pool, tx } from '../../src/db.js';
import { invalidate } from '../../src/services/meta.js';
import { normalizeName } from '../../src/lib/util.js';
import * as R from './reference.js';
import { seedWorkbook } from './workbook.js';
import { seedSample } from './sample.js';

export async function seedReference(c, log = console.log, { demoUsers = true } = {}) {
  log('Seeding roles & users…');
  const roleIds = {};
  for (const r of R.roles) {
    const x = await c.query('INSERT INTO roles (key,name,description,permissions,is_system) VALUES ($1,$2,$3,$4,$5) RETURNING id', [r.key, r.name, r.description, r.permissions, r.is_system]);
    roleIds[r.key] = x.rows[0].id;
  }
  for (const [email, name, role, active = true] of R.demoUsers.filter(([e]) => demoUsers || !e.endsWith('@example.com'))) {
    await c.query('INSERT INTO users (email,name,role_id,is_active,deactivated_at) VALUES ($1,$2,$3,$4,$5)', [email, name, roleIds[role], active, active ? null : new Date()]);
  }
  log('Seeding settings…');
  for (const s of R.settings) await c.query('INSERT INTO app_settings (key,value,label,description) VALUES ($1,$2,$3,$4)', [s.key, JSON.stringify(s.value), s.label, s.description]);

  log('Seeding master lists…');
  const mv = {};
  for (const l of R.masterLists) {
    await c.query('INSERT INTO master_lists (key,name,is_system) VALUES ($1,$2,$3)', [l.key, l.name, l.is_system]);
    let i = 10;
    for (const [code, label, meta = {}] of l.values) {
      const x = await c.query('INSERT INTO master_values (list_key,code,label,sort_order,meta) VALUES ($1,$2,$3,$4,$5) RETURNING id', [l.key, code, label, i, JSON.stringify(meta)]);
      mv[`${l.key}.${code}`] = x.rows[0].id;
      i += 10;
    }
  }
  let i = 10;
  for (const [cat, names] of Object.entries(R.amenities)) {
    for (const n of names) { await c.query('INSERT INTO amenities (category_id,name,sort_order) VALUES ($1,$2,$3)', [mv[`amenity_category.${cat}`], n, i]); i += 10; }
  }
  i = 10;
  for (const [code, label, category, bedrooms, areaLabel] of R.configurationTypes) {
    await c.query('INSERT INTO configuration_types (code,label,category,bedrooms,area_label,sort_order) VALUES ($1,$2,$3,$4,$5,$6)', [code, label, category, bedrooms ?? null, areaLabel || 'Carpet', i]);
    i += 10;
  }
  log('Seeding geography…');
  let ci = 10;
  for (const city of R.geography) {
    const cid = (await c.query('INSERT INTO cities (code,name,state,latitude,longitude,sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [city.code, city.name, city.state, city.lat, city.lng, ci])).rows[0].id;
    ci += 10;
    let li = 10;
    for (const [lname, lat, lng, subs] of city.locations) {
      const lid = (await c.query('INSERT INTO locations (city_id,name,latitude,longitude,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id', [cid, lname, lat, lng, li])).rows[0].id;
      li += 10;
      let si = 10;
      for (const [sname, slat, slng] of subs) {
        await c.query('INSERT INTO sub_locations (location_id,name,latitude,longitude,sort_order) VALUES ($1,$2,$3,$4,$5)', [lid, sname, slat, slng, si]);
        si += 10;
      }
    }
  }
  log('Seeding bands, filters & field definitions…');
  for (const b of R.bandSets) {
    await c.query('INSERT INTO band_sets (key,label,unit,display_format) VALUES ($1,$2,$3,$4)', [b.key, b.label, b.unit, b.display_format]);
    let bi = 10;
    for (const [label, lo, hi] of b.bands) { await c.query('INSERT INTO band_definitions (band_set_key,label,lower_bound,upper_bound,sort_order) VALUES ($1,$2,$3,$4,$5)', [b.key, label, lo, hi, bi]); bi += 10; }
  }
  for (const [key, label, control, source, x] of R.filters) {
    await c.query(`INSERT INTO filter_definitions (key,label,control,source_key,depends_on,match_mode,min_value,max_value,step,unit,display_format,band_set_key,sort_order,is_active,is_primary)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [key, label, control, source, x.depends_on ?? null, x.match_mode ?? 'graded', x.min_value ?? null, x.max_value ?? null, x.step ?? null, x.unit ?? null, x.display_format ?? null, x.band_set_key ?? null, x.sort_order ?? 100, x.is_active ?? true, x.is_primary ?? false]);
  }
  let fi = 10;
  for (const [entity, key, label, dataType, section, x] of R.fields) {
    const storage = x.storage || 'column';
    await c.query(`INSERT INTO field_definitions (entity,key,label,data_type,storage,master_list_key,unit,section,sort_order,show_in_card,show_in_summary,show_in_detail,is_required,is_system,help_text,validation,visible_when)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [entity, key, label, dataType, storage, x.master_list_key ?? null, x.unit ?? null, section, fi, x.show_in_card ?? false, x.show_in_summary ?? false, x.show_in_detail ?? true, x.is_required ?? false, storage === 'column', x.help_text ?? null, JSON.stringify(x.validation || {}), x.visible_when ? JSON.stringify(x.visible_when) : null]);
    fi += 10;
  }
  // Generic objection library (project_id NULL) — shown to sales alongside project-specific answers
  const lib = [
    ['Price is high compared to nearby projects', 'Compare on ₹/sq.ft. of carpet, not ticket size. Point to amenities, brand delivery record and payment-plan flexibility; show 2–3 comparable launches in the same micro-market.', ['price']],
    ['Possession is too far away', 'Explain the RERA-registered possession date is a legal commitment; under-construction pricing is typically lower than ready inventory, and staggered payment plans reduce carrying cost.', ['possession']],
    ['Location is too far from my workplace', 'Walk through upcoming connectivity (metro, highways, airport) with travel times, and current social infrastructure already operational.', ['location']],
  ];
  for (const [o, r, tags] of lib) await c.query('INSERT INTO objections (project_id, objection, response, tags) VALUES (NULL,$1,$2,$3)', [o, r, tags]);
  return { roleIds, mv };
}

/**
 * opts.workbook — migrate the 9 Navi Mumbai projects from the Excel prototype (default true)
 * opts.sample   — add ~33 fictional sample projects for testing (default true)
 */
export async function seedAll(log = console.log, { workbook = true, sample = true } = {}) {
  const existing = (await pool.query('SELECT count(*)::int n FROM roles')).rows[0].n;
  if (existing) throw new Error('Database already contains data. Seed only runs on an empty database (use npm run reset-db for a fresh start).');
  await tx(async (c) => { await seedReference(c, log, { demoUsers: sample }); });
  invalidate();
  const admin = (await pool.query("SELECT u.* FROM users u JOIN roles r ON r.id=u.role_id WHERE r.key='admin' ORDER BY u.id LIMIT 1")).rows[0];
  if (workbook) await tx(async (c) => { await seedWorkbook(c, admin, log); });
  if (sample) await tx(async (c) => { await seedSample(c, admin, log); });
  invalidate();
}

export { normalizeName };

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url === `file://${process.argv[1]}`) {
  // npm run seed                       → reference data + workbook projects + sample projects
  // npm run seed -- --no-sample         → reference data + the 9 workbook projects (production start)
  // npm run seed -- --reference-only    → reference data only
  const ref = process.argv.includes('--reference-only');
  seedAll(console.log, { workbook: !ref, sample: !ref && !process.argv.includes('--no-sample') })
    .then(async () => {
      const n = (await pool.query('SELECT count(*)::int n FROM projects')).rows[0].n;
      console.log(`Seed complete: ${n} projects`);
      await pool.end();
    })
    .catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
}
