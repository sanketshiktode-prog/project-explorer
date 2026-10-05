// Admin API: master data, filters, bands, fields, settings, users/roles, data quality, audit.
// Every change is audited and invalidates the metadata cache so the explorer picks it up instantly.
import { Router } from 'express';
import { requirePerm } from '../middleware/auth.js';
import { query, tx } from '../db.js';
import { getMeta, invalidate } from '../services/meta.js';
import { writeAudit } from '../services/records.js';
import { availableSources, resolveSource } from '../services/filterSources.js';
import { PERMISSIONS, PERMISSION_KEYS } from '../lib/permissions.js';
import { badRequest, conflict, notFound, normalizeName, same, haversineKm } from '../lib/util.js';
import { optionsFor } from './explorer.js';

const r = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- column typing for admin resources ----------
const T = {
  text: (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim()),
  reqText: (v, k) => { const s = T.text(v); if (!s) throw badRequest(`${k} is required`); return s; },
  int: (v) => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : (() => { throw badRequest('Expected a whole number'); })()),
  num: (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : (() => { throw badRequest('Expected a number'); })()),
  bool: (v) => v === true || v === 'true' || v === 1,
  json: (v) => (v === undefined ? null : JSON.stringify(v ?? null)),
  arr: (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : T.text(v)?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
};
const keyRe = /^[a-z][a-z0-9_]*$/;

const RESOURCES = {
  cities: { table: 'cities', perm: 'master.manage', order: 'sort_order, name', cols: { code: (v) => { const s = T.reqText(v, 'Code').toUpperCase(); if (!/^[A-Z]{2,5}$/.test(s)) throw badRequest('City code must be 2–5 letters (used in project IDs)'); return s; }, name: (v) => T.reqText(v, 'Name'), state: T.text, latitude: T.num, longitude: T.num, sort_order: T.int, is_active: T.bool },
    usage: ['SELECT count(*)::int n FROM projects WHERE city_id=$1', 'SELECT count(*)::int n FROM locations WHERE city_id=$1'] },
  locations: { table: 'locations', perm: 'master.manage', order: 'city_id, sort_order, name', cols: { city_id: T.int, name: (v) => T.reqText(v, 'Name'), latitude: T.num, longitude: T.num, sort_order: T.int, is_active: T.bool },
    usage: ['SELECT count(*)::int n FROM projects WHERE location_id=$1', 'SELECT count(*)::int n FROM sub_locations WHERE location_id=$1'] },
  'sub-locations': { table: 'sub_locations', perm: 'master.manage', order: 'location_id, sort_order, name', cols: { location_id: T.int, name: (v) => T.reqText(v, 'Name'), latitude: T.num, longitude: T.num, sort_order: T.int, is_active: T.bool },
    usage: ['SELECT count(*)::int n FROM projects WHERE sub_location_id=$1'] },
  developers: { table: 'developers', perm: 'master.manage', order: 'name', where: 'merged_into_id IS NULL', cols: { name: (v) => T.reqText(v, 'Name'), about: T.text, website: T.text, aliases: T.arr, is_active: T.bool },
    usage: ['SELECT count(*)::int n FROM projects WHERE developer_id=$1'] },
  'configuration-types': { table: 'configuration_types', perm: 'master.manage', order: 'sort_order, label', cols: { code: (v) => T.reqText(v, 'Code'), label: (v) => T.reqText(v, 'Label'), category: (v) => { const s = T.text(v) || 'residential'; if (!['residential', 'commercial', 'plot', 'villa', 'other'].includes(s)) throw badRequest('Invalid category'); return s; }, bedrooms: T.num, area_label: (v) => T.text(v) || 'Carpet', sort_order: T.int, is_active: T.bool },
    usage: ['SELECT count(*)::int n FROM project_configurations WHERE config_type_id=$1'] },
  'master-lists': { table: 'master_lists', perm: 'master.manage', pk: 'key', order: 'name', cols: { key: (v) => { const s = T.reqText(v, 'Key'); if (!keyRe.test(s)) throw badRequest('Key must be lower_snake_case'); return s; }, name: (v) => T.reqText(v, 'Name'), description: T.text },
    usage: ['SELECT count(*)::int n FROM master_values WHERE list_key=$1'] },
  'master-values': { table: 'master_values', perm: 'master.manage', order: 'list_key, sort_order, label', cols: { list_key: (v) => T.reqText(v, 'List'), code: (v) => T.reqText(v, 'Code').toUpperCase().replace(/[^A-Z0-9_]/g, '_'), label: (v) => T.reqText(v, 'Label'), sort_order: T.int, is_active: T.bool, meta: T.json },
    usage: ['SELECT count(*)::int n FROM projects WHERE $1 IN (purpose_id, launch_stage_id, sales_status_id, eoi_type_id)', 'SELECT count(*)::int n FROM project_configurations WHERE inventory_status_id=$1', 'SELECT count(*)::int n FROM amenities WHERE category_id=$1'] },
  amenities: { table: 'amenities', perm: 'master.manage', order: 'category_id, sort_order, name', cols: { category_id: T.int, name: (v) => T.reqText(v, 'Name'), sort_order: T.int, is_active: T.bool },
    usage: ['SELECT count(*)::int n FROM project_amenities WHERE amenity_id=$1'] },
  'band-sets': { table: 'band_sets', perm: 'config.manage', pk: 'key', order: 'label', cols: { key: (v) => { const s = T.reqText(v, 'Key'); if (!keyRe.test(s)) throw badRequest('Key must be lower_snake_case'); return s; }, label: (v) => T.reqText(v, 'Label'), unit: T.text, display_format: (v) => T.text(v) || 'number', description: T.text },
    usage: ['SELECT count(*)::int n FROM band_definitions WHERE band_set_key=$1', 'SELECT count(*)::int n FROM filter_definitions WHERE band_set_key=$1'] },
  bands: { table: 'band_definitions', perm: 'config.manage', order: 'band_set_key, sort_order, lower_bound NULLS FIRST', cols: { band_set_key: (v) => T.reqText(v, 'Band set'), label: (v) => T.reqText(v, 'Label'), lower_bound: T.num, upper_bound: T.num, sort_order: T.int, is_active: T.bool },
    usage: [] },
  filters: { table: 'filter_definitions', perm: 'config.manage', order: 'sort_order, id', cols: {
    key: (v) => { const s = T.reqText(v, 'Key'); if (!keyRe.test(s)) throw badRequest('Key must be lower_snake_case'); return s; }, label: (v) => T.reqText(v, 'Label'),
    control: (v) => { if (!['multiselect', 'select', 'range', 'bands', 'toggle'].includes(v)) throw badRequest('Invalid control type'); return v; },
    source_key: (v) => T.reqText(v, 'Source'), depends_on: T.text, match_mode: (v) => (v === 'hard' ? 'hard' : 'graded'),
    min_value: T.num, max_value: T.num, step: T.num, unit: T.text, display_format: T.text, band_set_key: T.text,
    sort_order: T.int, is_active: T.bool, is_primary: T.bool, default_value: T.json, help_text: T.text }, usage: [] },
  fields: { table: 'field_definitions', perm: 'config.manage', order: 'entity, sort_order, id', cols: {
    entity: (v) => { if (!['project', 'configuration', 'tower'].includes(v)) throw badRequest('Invalid entity'); return v; },
    key: (v) => { const s = T.reqText(v, 'Key'); if (!keyRe.test(s)) throw badRequest('Key must be lower_snake_case'); return s; },
    label: (v) => T.reqText(v, 'Label'),
    data_type: (v) => { if (!['text', 'longtext', 'number', 'integer', 'money', 'area', 'date', 'boolean', 'tristate', 'select', 'multiselect'].includes(v)) throw badRequest('Invalid data type'); return v; },
    master_list_key: T.text, unit: T.text, section: (v) => T.text(v) || 'other', sort_order: T.int,
    show_in_card: T.bool, show_in_summary: T.bool, show_in_detail: T.bool, show_in_form: T.bool, is_required: T.bool, is_active: T.bool,
    help_text: T.text, validation: T.json, visible_when: T.json }, usage: [] },
};

// Columns an admin may change on a *core* (column-backed) field definition — its storage & type are fixed by the schema.
const CORE_FIELD_EDITABLE = ['label', 'section', 'sort_order', 'show_in_card', 'show_in_summary', 'show_in_detail', 'show_in_form', 'is_required', 'help_text', 'visible_when'];

async function validateResource(res, row, existing, c) {
  const meta = await getMeta();
  if (res === 'filters') {
    const src = resolveSource(row.source_key, meta);
    if (!src) throw badRequest('Unknown filter source. Pick one from the list (custom fields must be active and of a filterable type).');
    const ok = { ref: ['multiselect', 'select'], enum: ['multiselect', 'select'], refarray: ['multiselect'], bool: ['toggle'], number: ['range', 'bands'], range: ['range', 'bands'] }[src.kind];
    if (!ok.includes(row.control)) throw badRequest(`A "${src.kind}" source needs one of these controls: ${ok.join(', ')}`);
    if (row.control === 'bands' && !row.band_set_key) throw badRequest('A bands filter needs a band set');
    if (row.band_set_key && !meta.bandSets.some((b) => b.key === row.band_set_key)) throw badRequest('Unknown band set');
    if (row.depends_on && !meta.filters.some((f) => f.key === row.depends_on)) throw badRequest('depends_on must be the key of another filter');
    if (row.min_value != null && row.max_value != null && row.min_value >= row.max_value) throw badRequest('Minimum must be below maximum');
  }
  if (res === 'bands') {
    if (row.lower_bound != null && row.upper_bound != null && row.upper_bound <= row.lower_bound) throw badRequest('Upper bound must be greater than lower bound');
  }
  if (res === 'fields') {
    if (existing?.storage === 'column') {
      for (const k of Object.keys(row)) if (!CORE_FIELD_EDITABLE.includes(k) && !same(row[k], existing[k]) && k !== 'is_active') throw badRequest(`"${k}" of a core field is fixed by the database schema`);
      if (row.is_active === false && existing.is_required) throw badRequest('Core required fields cannot be deactivated');
    }
    if (['select', 'multiselect'].includes(row.data_type ?? existing?.data_type) && (existing?.storage ?? 'attribute') === 'attribute' && !(row.master_list_key ?? existing?.master_list_key)) throw badRequest('Select fields need a master list for their options');
    if (existing && existing.storage === 'attribute' && row.data_type && row.data_type !== existing.data_type) {
      const tbl = { project: 'projects', configuration: 'project_configurations', tower: 'towers' }[existing.entity];
      const n = (await c.query(`SELECT count(*)::int n FROM ${tbl} WHERE attributes ? $1`, [existing.key])).rows[0].n;
      if (n) throw conflict(`${n} records already hold values for "${existing.label}". Create a new field instead of changing its type.`);
    }
  }
}

function pick(res, body, partial) {
  const def = RESOURCES[res];
  const row = {};
  for (const [k, fn] of Object.entries(def.cols)) {
    if (partial && !(k in body)) continue;
    if (!(k in body) && !partial) continue;
    row[k] = fn(body[k], k);
  }
  return row;
}

const resource = (req) => {
  const d = RESOURCES[req.params.res];
  if (!d) throw notFound('Unknown admin resource');
  if (!req.user.permissions.has(d.perm)) throw Object.assign(new Error('You do not have permission to do this'), { status: 403 });
  return d;
};

// ---------- generic list ----------
r.get('/r/:res', wrap(async (req, res) => {
  const d = resource(req);
  const rows = (await query(`SELECT * FROM ${d.table} ${d.where ? `WHERE ${d.where}` : ''} ORDER BY ${d.order}`)).rows;
  if (req.query.usage === '1' && d.usage.length) {
    const pk = d.pk || 'id';
    for (const row of rows) {
      let n = 0;
      for (const u of d.usage) n += (await query(u, [row[pk]])).rows[0].n;
      row.usage_count = n;
    }
  }
  res.json(rows);
}));

r.post('/r/:res', wrap(async (req, res) => {
  const d = resource(req);
  const row = pick(req.params.res, req.body || {}, false);
  if (req.params.res === 'fields') { row.storage = 'attribute'; row.is_system = false; }
  if (req.params.res === 'developers') {
    row.normalized_name = normalizeName(row.name);
    const sim = (await query('SELECT id, name, similarity(normalized_name, $1) s FROM developers WHERE merged_into_id IS NULL AND (normalized_name = $1 OR similarity(normalized_name, $1) > 0.5) ORDER BY s DESC LIMIT 5', [row.normalized_name])).rows;
    if (sim.some((s) => s.s >= 0.999 || s.name.toLowerCase() === row.name.toLowerCase())) throw conflict(`Developer already exists: ${sim[0].name}`, { candidates: sim });
    if (sim.length && !req.body.confirm_not_duplicate) return res.status(409).json({ error: 'Similar developer(s) already exist', code: 'possible_duplicate', candidates: sim });
  }
  const created = await tx(async (c) => {
    await validateResource(req.params.res, row, null, c);
    // New values go to the end of their list unless an order was given
    const parentCol = { locations: 'city_id', 'sub-locations': 'location_id', 'master-values': 'list_key', bands: 'band_set_key', amenities: 'category_id' }[req.params.res];
    if ('sort_order' in d.cols && row.sort_order == null) {
      const mx = (await c.query(`SELECT COALESCE(max(sort_order), 0) + 10 AS n FROM ${d.table} ${parentCol ? `WHERE ${parentCol} = $1` : ''}`, parentCol ? [row[parentCol]] : [])).rows[0].n;
      row.sort_order = mx;
    }
    const cols = Object.keys(row);
    const out = (await c.query(`INSERT INTO ${d.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((k) => row[k]))).rows[0];
    await writeAudit(c, [{ user_id: req.user.id, action: 'create', entity: req.params.res, entity_id: String(out[d.pk || 'id']), new_value: out }]);
    return out;
  }).catch((e) => { if (e.code === '23505') throw conflict('A record with the same name/code already exists'); if (e.code === '23503') throw badRequest('A referenced record does not exist'); throw e; });
  invalidate();
  res.status(201).json(created);
}));

r.patch('/r/:res/:id', wrap(async (req, res) => {
  const d = resource(req);
  const pk = d.pk || 'id';
  const id = pk === 'id' ? Number(req.params.id) : req.params.id;
  const updated = await tx(async (c) => {
    const existing = (await c.query(`SELECT * FROM ${d.table} WHERE ${pk} = $1 FOR UPDATE`, [id])).rows[0];
    if (!existing) throw notFound();
    if (req.body.row_version != null && existing.row_version != null && Number(req.body.row_version) !== existing.row_version) {
      throw conflict('Someone else changed this record. Reload and try again.', { current: existing });
    }
    const row = pick(req.params.res, req.body || {}, true);
    if (pk !== 'id') delete row[pk]; // keys of key-based resources are immutable
    await validateResource(req.params.res, { ...existing, ...row, ...Object.fromEntries(Object.entries(row)) }, existing, c);
    if (req.params.res === 'fields' && existing.storage === 'column') {
      for (const k of Object.keys(row)) if (!CORE_FIELD_EDITABLE.includes(k) && k !== 'is_active') delete row[k];
    }
    if (req.params.res === 'developers' && row.name) row.normalized_name = normalizeName(row.name);
    const changed = Object.keys(row).filter((k) => !same(typeof existing[k] === 'object' && existing[k] !== null && !Array.isArray(existing[k]) ? JSON.stringify(existing[k]) : existing[k], row[k]));
    if (!changed.length) return existing;
    const hasRv = 'row_version' in existing;
    const out = (await c.query(`UPDATE ${d.table} SET ${changed.map((k, i) => `${k} = $${i + 2}`).join(', ')} ${hasRv ? ', row_version = row_version + 1' : ''} WHERE ${pk} = $1 RETURNING *`, [id, ...changed.map((k) => row[k])])).rows[0];
    await writeAudit(c, changed.map((k) => ({ user_id: req.user.id, action: 'update', entity: req.params.res, entity_id: String(id), field: k, old_value: existing[k], new_value: out[k] })));
    return out;
  }).catch((e) => { if (e.code === '23505') throw conflict('A record with the same name/code already exists'); throw e; });
  invalidate();
  res.json(updated);
}));

r.delete('/r/:res/:id', wrap(async (req, res) => {
  const d = resource(req);
  const pk = d.pk || 'id';
  const id = pk === 'id' ? Number(req.params.id) : req.params.id;
  await tx(async (c) => {
    const existing = (await c.query(`SELECT * FROM ${d.table} WHERE ${pk} = $1 FOR UPDATE`, [id])).rows[0];
    if (!existing) throw notFound();
    let n = 0;
    for (const u of d.usage) n += (await c.query(u, [id])).rows[0].n;
    if (n) throw conflict(`In use by ${n} record(s). Deactivate it instead so existing data stays intact.`);
    if (req.params.res === 'fields' && existing.storage === 'column') throw conflict('Core fields cannot be deleted. Hide them instead.');
    if (req.params.res === 'fields') {
      const tbl = { project: 'projects', configuration: 'project_configurations', tower: 'towers' }[existing.entity];
      const k = (await c.query(`SELECT count(*)::int n FROM ${tbl} WHERE attributes ? $1`, [existing.key])).rows[0].n;
      if (k) throw conflict(`${k} records hold values for this field. Deactivate it instead.`);
      const f = (await c.query("SELECT key FROM filter_definitions WHERE source_key LIKE $1", [`%.attr.${existing.key}`])).rows;
      if (f.length) throw conflict(`Used by filter(s): ${f.map((x) => x.key).join(', ')}`);
    }
    if (['master-lists', 'band-sets'].includes(req.params.res) && existing.is_system) throw conflict('System lists cannot be deleted');
    await c.query(`DELETE FROM ${d.table} WHERE ${pk} = $1`, [id]);
    await writeAudit(c, [{ user_id: req.user.id, action: 'delete', entity: req.params.res, entity_id: String(id), old_value: existing }]);
  });
  invalidate();
  res.json({ ok: true });
}));

// ---------- helpers for admin screens ----------
r.get('/filter-sources', requirePerm('config.manage'), wrap(async (_req, res) => {
  const meta = await getMeta();
  res.json(availableSources(meta));
}));

r.get('/band-check/:key', requirePerm('config.manage'), wrap(async (req, res) => {
  const meta = await getMeta();
  res.json(bandIssues(meta.bands.filter((b) => b.band_set_key === req.params.key && b.is_active)));
}));

export function bandIssues(bands) {
  const sorted = [...bands].sort((a, b) => (a.lower_bound ?? -Infinity) - (b.lower_bound ?? -Infinity));
  const issues = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]; const cur = sorted[i];
    const pu = prev.upper_bound == null ? Infinity : Number(prev.upper_bound);
    const cl = cur.lower_bound == null ? -Infinity : Number(cur.lower_bound);
    if (cl > pu) issues.push({ level: 'warning', message: `Gap between "${prev.label}" and "${cur.label}" (${pu} – ${cl})` });
    if (cl < pu) issues.push({ level: 'warning', message: `"${prev.label}" overlaps "${cur.label}"` });
  }
  return issues;
}

r.get('/preview-options/:filterKey', requirePerm('config.manage'), wrap(async (req, res) => {
  const meta = await getMeta();
  const f = meta.filters.find((x) => x.key === req.params.filterKey);
  if (!f) throw notFound();
  res.json(optionsFor(resolveSource(f.source_key, meta), meta));
}));

// ---------- developer merge (duplicate developers) ----------
r.post('/developers/:id/merge', requirePerm('master.manage'), wrap(async (req, res) => {
  const from = Number(req.params.id);
  const into = Number(req.body?.into_id);
  if (!into || into === from) throw badRequest('Choose the developer to merge into');
  await tx(async (c) => {
    const a = (await c.query('SELECT * FROM developers WHERE id=$1 FOR UPDATE', [from])).rows[0];
    const b = (await c.query('SELECT * FROM developers WHERE id=$1 FOR UPDATE', [into])).rows[0];
    if (!a || !b) throw notFound();
    const moved = (await c.query('UPDATE projects SET developer_id=$2, updated_at=now(), updated_by=$3 WHERE developer_id=$1 RETURNING id', [from, into, req.user.id])).rows;
    await c.query('UPDATE developers SET merged_into_id=$2, is_active=false WHERE id=$1', [from, into]);
    await c.query('UPDATE developers SET aliases = array(SELECT DISTINCT unnest(aliases || $2::text[])) WHERE id=$1', [into, [a.name, ...a.aliases]]);
    await writeAudit(c, [
      { user_id: req.user.id, action: 'merge', entity: 'developers', entity_id: String(from), old_value: a, new_value: { merged_into: into }, note: `Merged "${a.name}" into "${b.name}" (${moved.length} projects moved)` },
      ...moved.map((m) => ({ user_id: req.user.id, action: 'update', entity: 'project', entity_id: String(m.id), project_id: m.id, field: 'developer_id', old_value: from, new_value: into, note: 'Developer merge' })),
    ]);
  });
  invalidate();
  res.json({ ok: true });
}));

// ---------- settings ----------
r.get('/settings', requirePerm('config.manage'), wrap(async (_req, res) => {
  res.json((await query('SELECT s.*, u.name AS updated_by_name FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by ORDER BY key')).rows);
}));
r.put('/settings/:key', requirePerm('config.manage'), wrap(async (req, res) => {
  const { value } = req.body || {};
  if (value === undefined) throw badRequest('value is required');
  const key = req.params.key;
  const checks = {
    psf_display_rule: (v) => ['developer_first', 'calculated_first', 'developer_only', 'calculated_only'].includes(v),
    stale_after_days: (v) => Number.isInteger(v) && v > 0 && v < 3650,
    sales_visible_statuses: (v) => Array.isArray(v) && v.length && v.every((s) => ['draft', 'under_review', 'verified', 'published', 'needs_update', 'inactive', 'archived'].includes(s)),
    matching: (v) => v && ['contained', 'overlap'].includes(v.range_exact_rule) && Number(v.tolerance_pct) >= 0 && Number(v.tolerance_pct) <= 100 && ['partial', 'exclude'].includes(v.missing_value),
  };
  if (checks[key] && !checks[key](value)) throw badRequest(`Invalid value for ${key}`);
  await tx(async (c) => {
    const old = (await c.query('SELECT value FROM app_settings WHERE key=$1 FOR UPDATE', [key])).rows[0];
    if (!old) throw notFound('Unknown setting');
    await c.query('UPDATE app_settings SET value=$2, updated_by=$3, updated_at=now() WHERE key=$1', [key, JSON.stringify(value), req.user.id]);
    await writeAudit(c, [{ user_id: req.user.id, action: 'update', entity: 'setting', entity_id: key, field: key, old_value: old.value, new_value: value }]);
  });
  invalidate();
  res.json({ ok: true });
}));

// ---------- users & roles ----------
r.get('/users', requirePerm('users.manage'), wrap(async (_req, res) => {
  res.json((await query(`SELECT u.id, u.email, u.name, u.role_id, r.name AS role_name, u.is_active, u.last_login_at, u.created_at, u.deactivated_at, u.row_version,
    (SELECT count(*)::int FROM sessions s WHERE s.user_id=u.id AND s.expires_at > now()) AS active_sessions
    FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.is_active DESC, u.name`)).rows);
}));
r.post('/users', requirePerm('users.manage'), wrap(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address');
  const roleId = Number(req.body?.role_id);
  const u = await tx(async (c) => {
    const out = (await c.query('INSERT INTO users (email, name, role_id, created_by) VALUES ($1,$2,$3,$4) RETURNING *', [email, T.text(req.body?.name), roleId, req.user.id])).rows[0];
    await writeAudit(c, [{ user_id: req.user.id, action: 'create', entity: 'user', entity_id: String(out.id), new_value: { email, role_id: roleId } }]);
    return out;
  }).catch((e) => { if (e.code === '23505') throw conflict('That email is already approved'); if (e.code === '23503') throw badRequest('Choose a role'); throw e; });
  res.status(201).json(u);
}));
r.patch('/users/:id', requirePerm('users.manage'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const out = await tx(async (c) => {
    const u = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!u) throw notFound();
    const sets = {};
    if ('role_id' in req.body) sets.role_id = Number(req.body.role_id);
    if ('name' in req.body) sets.name = T.text(req.body.name);
    if ('is_active' in req.body) {
      sets.is_active = T.bool(req.body.is_active);
      sets.deactivated_at = sets.is_active ? null : new Date();
      if (id === req.user.id && !sets.is_active) throw badRequest('You cannot deactivate yourself');
    }
    if (id === req.user.id && sets.role_id && sets.role_id !== u.role_id) {
      const adminRole = (await c.query("SELECT id FROM roles WHERE key='admin'")).rows[0].id;
      if (u.role_id === adminRole) throw badRequest('You cannot remove your own admin role');
    }
    const keys = Object.keys(sets);
    if (!keys.length) return u;
    const row = (await c.query(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, row_version=row_version+1 WHERE id=$1 RETURNING *`, [id, ...keys.map((k) => sets[k])])).rows[0];
    if (sets.is_active === false) await c.query('DELETE FROM sessions WHERE user_id=$1', [id]); // immediate sign-out
    await writeAudit(c, keys.filter((k) => k !== 'deactivated_at').map((k) => ({ user_id: req.user.id, action: 'update', entity: 'user', entity_id: String(id), field: k, old_value: u[k], new_value: row[k] })));
    return row;
  });
  res.json(out);
}));
r.get('/roles', requirePerm('users.manage'), wrap(async (_req, res) => {
  res.json({ roles: (await query('SELECT r.*, (SELECT count(*)::int FROM users u WHERE u.role_id=r.id) AS user_count FROM roles r ORDER BY id')).rows, permissions: PERMISSIONS });
}));
r.post('/roles', requirePerm('users.manage'), wrap(async (req, res) => {
  const key = String(req.body?.key || '').trim();
  if (!keyRe.test(key)) throw badRequest('Role key must be lower_snake_case');
  const perms = (req.body?.permissions || []).filter((p) => PERMISSION_KEYS.has(p));
  const out = await tx(async (c) => {
    const row = (await c.query('INSERT INTO roles (key, name, description, permissions) VALUES ($1,$2,$3,$4) RETURNING *', [key, T.reqText(req.body?.name, 'Name'), T.text(req.body?.description), perms])).rows[0];
    await writeAudit(c, [{ user_id: req.user.id, action: 'create', entity: 'role', entity_id: String(row.id), new_value: row }]);
    return row;
  }).catch((e) => { if (e.code === '23505') throw conflict('Role key already exists'); throw e; });
  res.status(201).json(out);
}));
r.patch('/roles/:id', requirePerm('users.manage'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const out = await tx(async (c) => {
    const role = (await c.query('SELECT * FROM roles WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!role) throw notFound();
    if (role.key === 'admin' && req.body.permissions) throw badRequest('The Admin role always has every permission');
    const perms = req.body.permissions ? req.body.permissions.filter((p) => PERMISSION_KEYS.has(p)) : role.permissions;
    const row = (await c.query('UPDATE roles SET name=$2, description=$3, permissions=$4 WHERE id=$1 RETURNING *', [id, T.text(req.body.name) || role.name, req.body.description !== undefined ? T.text(req.body.description) : role.description, perms])).rows[0];
    await writeAudit(c, [{ user_id: req.user.id, action: 'update', entity: 'role', entity_id: String(id), old_value: role, new_value: row }]);
    return row;
  });
  res.json(out);
}));

// ---------- audit ----------
r.get('/audit', requirePerm('audit.view'), wrap(async (req, res) => {
  const params = [];
  const where = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.entity) add('a.entity = ?', req.query.entity);
  if (req.query.action) add('a.action = ?', req.query.action);
  if (req.query.user_id) add('a.user_id = ?', Number(req.query.user_id));
  if (req.query.project_id) add('a.project_id = ?', Number(req.query.project_id));
  if (req.query.from) add('a.at >= ?', req.query.from);
  if (req.query.to) add("a.at < (?::date + interval '1 day')", req.query.to);
  if (req.query.q) { params.push(`%${req.query.q}%`); const n = params.length; where.push(`(a.field ILIKE $${n} OR a.note ILIKE $${n} OR p.name ILIKE $${n} OR p.public_id ILIKE $${n})`); }
  const page = Math.max(Number(req.query.page) || 1, 1);
  const rows = await query(`SELECT a.*, u.name AS user_name, p.name AS project_name, p.public_id, count(*) OVER()::int AS total
    FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN projects p ON p.id=a.project_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.at DESC, a.id DESC LIMIT 100 OFFSET ${(page - 1) * 100}`, params);
  res.json({ total: rows.rows[0]?.total ?? 0, page, items: rows.rows });
}));

// ---------- data quality ----------
r.get('/data-quality', requirePerm('quality.view'), wrap(async (_req, res) => {
  const meta = await getMeta();
  const staleDays = Number(meta.settings.stale_after_days || 90);
  const live = "p.record_status NOT IN ('archived','inactive')";
  const base = (cond, extra = '') => `SELECT p.id, p.public_id, p.name, p.record_status ${extra} FROM projects p WHERE ${live} AND ${cond} ORDER BY p.name`;
  const checks = [
    ['missing_location', 'Projects missing location / sub-location', 'error', base('(p.location_id IS NULL OR p.sub_location_id IS NULL)')],
    ['missing_coords', 'Projects missing map coordinates', 'error', base('(p.latitude IS NULL OR p.longitude IS NULL)')],
    ['approx_coords', 'Coordinates not yet verified (approximate / unverified)', 'info', base("p.latitude IS NOT NULL AND p.coords_status <> 'verified'")],
    ['missing_configs', 'Projects with no configurations', 'error', base('NOT EXISTS (SELECT 1 FROM project_configurations c WHERE c.project_id=p.id AND c.is_active)')],
    ['missing_prices', 'Configurations missing price (not marked "on request")', 'warning', base("EXISTS (SELECT 1 FROM project_configurations c WHERE c.project_id=p.id AND c.is_active AND c.price_min IS NULL AND NOT c.price_on_request AND NOT (c.field_states ? 'price_from'))", ", (SELECT count(*)::int FROM project_configurations c WHERE c.project_id=p.id AND c.is_active AND c.price_min IS NULL AND NOT c.price_on_request) AS n")],
    ['incomplete_configs', 'Configurations missing carpet area or inventory status', 'warning', base('EXISTS (SELECT 1 FROM project_configurations c WHERE c.project_id=p.id AND c.is_active AND (c.carpet_min IS NULL OR c.inventory_status_id IS NULL))', ', (SELECT count(*)::int FROM project_configurations c WHERE c.project_id=p.id AND c.is_active AND (c.carpet_min IS NULL OR c.inventory_status_id IS NULL)) AS n')],
    ['missing_possession', 'Projects missing possession dates', 'warning', base("p.dev_possession_date IS NULL AND p.rera_possession_date IS NULL AND NOT (p.field_states ? 'rera_possession_date')")],
    ['missing_rera_possession', 'Projects missing RERA possession', 'info', base("p.rera_possession_date IS NULL AND NOT (p.field_states ? 'rera_possession_date')")],
    ['possession_conflict', 'Developer possession later than RERA possession', 'warning', base('p.dev_possession_date > p.rera_possession_date')],
    ['stale', `Not updated for ${staleDays}+ days`, 'warning', base(`p.updated_at < now() - interval '${staleDays} days'`, ', p.updated_at')],
    ['needs_verification', 'Changed since last verification / never verified', 'warning', base("p.record_status IN ('published','needs_update','verified') AND (p.verified_at IS NULL OR p.updated_at > p.verified_at + interval '1 minute')", ', p.updated_at, p.verified_at')],
    ['awaiting_review', 'Waiting for review', 'info', base("p.record_status = 'under_review'")],
    ['invalid_towers', 'Invalid tower information', 'error', base('EXISTS (SELECT 1 FROM towers t WHERE t.project_id=p.id AND t.is_active AND ((t.habitable_from_floor > t.floors_above_ground) OR (t.floors_above_ground > 10 AND t.main_lifts = 0)))')],
    ['tower_count_mismatch', 'Tower rows exceed project tower count', 'warning', base('p.total_towers IS NOT NULL AND (SELECT COALESCE(sum(represents_count),0) FROM towers t WHERE t.project_id=p.id AND t.is_active) > p.total_towers')],
    ['no_towers', 'No tower information', 'info', base('NOT EXISTS (SELECT 1 FROM towers t WHERE t.project_id=p.id AND t.is_active)')],
    ['expired_offers', 'Active offers past their end date (hidden from sales)', 'info', base('EXISTS (SELECT 1 FROM offers o WHERE o.project_id=p.id AND o.is_active AND o.end_date < current_date)')],
    ['undated_offers', 'Offers without an end date', 'info', base('EXISTS (SELECT 1 FROM offers o WHERE o.project_id=p.id AND o.is_active AND o.end_date IS NULL)')],
    ['objections_no_answer', 'Objections without a response', 'info', base('EXISTS (SELECT 1 FROM objections o WHERE o.project_id=p.id AND o.is_active AND o.response IS NULL)')],
    ['eoi_conflict', 'EOI marked N/A but EOI details present', 'warning', base(`p.eoi_type_id IN (SELECT id FROM master_values WHERE list_key='eoi_type' AND code='NA') AND (p.eoi_amount IS NOT NULL OR p.eoi_remarks IS NOT NULL)`)],
  ];
  const results = [];
  for (const [key, label, level, sql] of checks) {
    const rows = (await query(sql)).rows;
    results.push({ key, label, level, count: rows.length, items: rows });
  }
  // Coordinates far from city centre
  const far = [];
  const lim = Number(meta.settings.coordinate_sanity_km || 60);
  const pts = (await query(`SELECT p.id, p.public_id, p.name, p.record_status, p.latitude, p.longitude, p.city_id FROM projects p WHERE ${live} AND p.latitude IS NOT NULL`)).rows;
  for (const p of pts) {
    const c = meta.cities.find((x) => x.id === p.city_id);
    if (c?.latitude) {
      const km = haversineKm(Number(p.latitude), Number(p.longitude), Number(c.latitude), Number(c.longitude));
      if (km > lim) far.push({ id: p.id, public_id: p.public_id, name: p.name, record_status: p.record_status, detail: `${Math.round(km)} km from ${c.name}` });
    }
  }
  results.splice(2, 0, { key: 'suspect_coords', label: `Coordinates more than ${lim} km from the city centre`, level: 'error', count: far.length, items: far });
  // Possible duplicates (pairs)
  const dup = (await query(`SELECT a.id a_id, a.public_id a_pid, a.name a_name, b.id b_id, b.public_id b_pid, b.name b_name, similarity(a.normalized_name, b.normalized_name) s
    FROM projects a JOIN projects b ON a.id < b.id AND a.normalized_name % b.normalized_name
    WHERE a.record_status <> 'archived' AND b.record_status <> 'archived' AND similarity(a.normalized_name, b.normalized_name) > 0.6
      AND (a.developer_id = b.developer_id OR a.location_id = b.location_id) ORDER BY s DESC LIMIT 50`)).rows;
  results.push({ key: 'possible_duplicates', label: 'Possible duplicate projects', level: 'warning', count: dup.length, items: dup.map((d) => ({ id: d.a_id, public_id: d.a_pid, name: d.a_name, other: { id: d.b_id, public_id: d.b_pid, name: d.b_name }, detail: `${Math.round(d.s * 100)}% similar to ${d.b_name} (${d.b_pid})` })) });
  const devDup = (await query(`SELECT a.id a_id, a.name a_name, b.id b_id, b.name b_name FROM developers a JOIN developers b ON a.id < b.id AND similarity(a.normalized_name, b.normalized_name) > 0.6
    WHERE a.merged_into_id IS NULL AND b.merged_into_id IS NULL LIMIT 30`)).rows;
  results.push({ key: 'duplicate_developers', label: 'Possible duplicate developers', level: 'warning', count: devDup.length, items: devDup.map((d) => ({ id: d.a_id, name: d.a_name, detail: `similar to ${d.b_name}`, developer: true, other_id: d.b_id })) });
  const totals = (await query(`SELECT count(*)::int total, count(*) FILTER (WHERE record_status IN ('published','needs_update'))::int live FROM projects WHERE record_status <> 'archived'`)).rows[0];
  res.json({ generated_at: new Date().toISOString(), totals, checks: results });
}));

export default r;
