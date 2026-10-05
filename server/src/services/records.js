// Generic, audited record writes with field-level optimistic locking.
//
// Clients send changes as { field: { from, to } }. For every field we compare the value
// currently in the database with the value the client started from ("from"). If they
// match, the change is applied — even if another user changed *other* fields meanwhile.
// If they differ, someone else changed the same field: the request is rejected with 409
// and the conflicting fields, so nobody silently overwrites anyone else's work.
import { ENTITIES, coerce, coerceAttribute, FIELD_STATES } from './registry.js';
import { getMeta } from './meta.js';
import { badRequest, conflict, notFound, normalizeProjectName, same } from '../lib/util.js';

export async function writeAudit(client, entries) {
  if (!entries.length) return;
  const cols = ['user_id', 'action', 'entity', 'entity_id', 'project_id', 'field', 'old_value', 'new_value', 'batch_id', 'note'];
  const params = [];
  const rows = entries.map((e, i) => {
    cols.forEach((c) => params.push(c === 'old_value' || c === 'new_value' ? (e[c] === undefined ? null : JSON.stringify(e[c])) : e[c] ?? null));
    return `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`;
  });
  await client.query(`INSERT INTO audit_log (${cols.join(',')}) VALUES ${rows.join(',')}`, params);
}

export async function loadRow(client, entity, id, lock = false) {
  const def = ENTITIES[entity];
  const r = await client.query(`SELECT * FROM ${def.table} WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!r.rows[0]) throw notFound(`${def.label} not found`);
  return r.rows[0];
}

function fieldDefsFor(meta, entity) {
  return meta.fields.filter((f) => f.entity === entity);
}

/** Resolve "column", "attributes.key" or "states.key" into a coercer + getter. */
function resolveField(meta, entity, field) {
  const def = ENTITIES[entity];
  if (field.startsWith('attributes.')) {
    const key = field.slice(11);
    const fd = fieldDefsFor(meta, entity).find((f) => f.key === key && f.storage === 'attribute');
    if (!fd) throw badRequest(`Unknown custom field "${key}"`);
    return { kind: 'attr', key, coerce: (v) => coerceAttribute(fd, v), get: (row) => row.attributes?.[key] ?? null };
  }
  if (field.startsWith('states.')) {
    const key = field.slice(7);
    if (!def.columns[key] && !fieldDefsFor(meta, entity).some((f) => f.key === key)) throw badRequest(`Unknown field "${key}"`);
    return {
      kind: 'state', key,
      coerce: (v) => { if (v === null || v === '' || v === undefined) return null; if (!FIELD_STATES.includes(v)) throw badRequest(`Field state must be one of ${FIELD_STATES.join(', ')}`); return v; },
      get: (row) => row.field_states?.[key] ?? null,
    };
  }
  const col = def.columns[field];
  if (!col) throw badRequest(`Field "${field}" cannot be edited`);
  const fd = fieldDefsFor(meta, entity).find((f) => f.key === field);
  return { kind: 'col', key: field, def: col, coerce: (v) => coerce(col, v, fd?.label || field), get: (row) => row[field] };
}

async function checkRefs(client, entity, values) {
  const def = ENTITIES[entity];
  for (const [k, v] of Object.entries(values)) {
    const col = def.columns[k];
    if (!col || col.t !== 'ref' || v === null) continue;
    const r = await client.query(`SELECT ${col.list ? 'list_key' : '1 AS ok'} FROM ${col.table} WHERE id = $1`, [v]);
    if (!r.rows[0]) throw badRequest(`${k}: referenced record ${v} does not exist`);
    if (col.list && r.rows[0].list_key !== col.list) throw badRequest(`${k}: value belongs to the wrong list`);
  }
}

export function computeCalcPsf(row) {
  const mid = (a, b) => (a == null && b == null ? null : ((a ?? b) + (b ?? a)) / 2);
  if (row.price_on_request) return null;
  const price = mid(row.price_from, row.price_to);
  const area = row.psf_basis === 'sbua' ? mid(row.sbua_from, row.sbua_to) : mid(row.carpet_from, row.carpet_to);
  if (!price || !area) return null;
  return Math.round((price / area) * 100) / 100;
}

async function nextPublicId(client, cityId) {
  const meta = await getMeta();
  const fmt = meta.settings.project_id_format || { prefix: 'PRJ', digits: 6 };
  const city = meta.cities.find((c) => c.id === cityId) || (await client.query('SELECT code FROM cities WHERE id=$1', [cityId])).rows[0];
  if (!city) throw badRequest('City is required to generate a project ID');
  const n = (await client.query("SELECT nextval('project_public_seq') AS n")).rows[0].n;
  return `${fmt.prefix}-${city.code}-${String(n).padStart(fmt.digits, '0')}`;
}

async function touchProject(client, projectId, user) {
  await client.query('UPDATE projects SET updated_at = now(), updated_by = $2 WHERE id = $1', [projectId, user?.id ?? null]);
}

/**
 * Create a record.
 * values: plain column values; attributes / states: optional maps.
 */
export async function createRecord(client, { entity, values = {}, attributes = {}, states = {}, user, projectId = null, batchId = null, note = null, extra = {} }) {
  const meta = await getMeta();
  const def = ENTITIES[entity];
  const row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '') continue; // let column defaults apply
    row[k] = resolveField(meta, entity, k).coerce(v);
  }
  for (const [k, col] of Object.entries(def.columns)) {
    if (col.required && (row[k] === null || row[k] === undefined)) throw badRequest(`${k.replace(/_id$/, '').replace(/_/g, ' ')} is required`);
  }
  await checkRefs(client, entity, row);
  const attrs = {};
  for (const [k, v] of Object.entries(attributes || {})) {
    const c = resolveField(meta, entity, `attributes.${k}`).coerce(v);
    if (c !== null) attrs[k] = c;
  }
  const st = {};
  for (const [k, v] of Object.entries(states || {})) {
    const c = resolveField(meta, entity, `states.${k}`).coerce(v);
    if (c) st[k] = c;
  }

  const insert = { ...row, ...extra };
  if (entity in { project: 1, configuration: 1, tower: 1 }) {
    insert.attributes = JSON.stringify(attrs);
    insert.field_states = JSON.stringify(st);
    insert.created_by = user?.id ?? null;
    insert.updated_by = user?.id ?? null;
  }
  if (entity === 'project') {
    insert.public_id = extra.public_id || (await nextPublicId(client, row.city_id));
    insert.normalized_name = normalizeProjectName(row.name);
    insert.record_status = extra.record_status || 'draft';
  } else {
    insert.project_id = projectId;
  }
  if (entity === 'configuration') insert.calc_psf = computeCalcPsf({ psf_basis: 'carpet', ...row });
  if (entity !== 'project' && 'sort_order' in def.columns && insert.sort_order === undefined && projectId) {
    insert.sort_order = (await client.query(`SELECT COALESCE(max(sort_order), 0) + 10 AS n FROM ${def.table} WHERE project_id = $1`, [projectId])).rows[0].n;
  }

  const cols = Object.keys(insert);
  const r = await client.query(
    `INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    cols.map((c) => insert[c]),
  );
  const created = r.rows[0];
  const pid = entity === 'project' ? created.id : projectId;
  await writeAudit(client, [{ user_id: user?.id, action: 'create', entity, entity_id: String(created.id), project_id: pid, new_value: { ...row, ...(Object.keys(attrs).length ? { attributes: attrs } : {}) }, batch_id: batchId, note }]);
  if (entity !== 'project' && projectId) await touchProject(client, projectId, user);
  return created;
}

/**
 * Update a record with field-level conflict detection.
 * changes: { field: { from, to } } — "from" omitted means "don't check" (bulk/system updates).
 */
export async function updateRecord(client, { entity, id, changes, user, projectId = null, batchId = null, note = null, expectProjectId = null }) {
  const meta = await getMeta();
  const def = ENTITIES[entity];
  const current = await loadRow(client, entity, id, true);
  if (expectProjectId && current.project_id !== expectProjectId) throw notFound(`${def.label} not found in this project`);

  const conflicts = [];
  const cols = {};
  const attrs = { ...(current.attributes || {}) };
  const states = { ...(current.field_states || {}) };
  const auditRows = [];
  for (const [field, ch] of Object.entries(changes || {})) {
    const f = resolveField(meta, entity, field);
    const to = f.coerce(ch?.to);
    const now = f.get(current);
    if (ch && Object.prototype.hasOwnProperty.call(ch, 'from')) {
      let from;
      try { from = f.coerce(ch.from); } catch { from = ch.from; }
      if (!same(now, from) && !same(now, to)) conflicts.push({ field, base: from, theirs: now, yours: to });
    }
    if (same(now, to)) continue;
    if (f.kind === 'col') cols[field] = to;
    else if (f.kind === 'attr') { if (to === null) delete attrs[f.key]; else attrs[f.key] = to; }
    else if (to === null) delete states[f.key]; else states[f.key] = to;
    auditRows.push({ field, old: now, new: to });
  }
  if (conflicts.length) {
    throw conflict('Someone else changed the same information while you were editing. Review the differences and try again.', { conflicts, current });
  }
  if (!auditRows.length) return { row: current, changed: [] };

  await checkRefs(client, entity, cols);
  const set = { ...cols };
  if (auditRows.some((a) => a.field.startsWith('attributes.'))) set.attributes = JSON.stringify(attrs);
  if (auditRows.some((a) => a.field.startsWith('states.'))) set.field_states = JSON.stringify(states);
  // Entering a value clears any "N/A / Unknown" marker for that field
  for (const a of auditRows) {
    if (!a.field.includes('.') && a.new !== null && states[a.field]) { delete states[a.field]; set.field_states = JSON.stringify(states); }
  }
  if (entity === 'project' && 'name' in cols) set.normalized_name = normalizeProjectName(cols.name);
  if (entity === 'configuration') {
    const merged = { ...current, ...cols };
    const calc = computeCalcPsf(merged);
    if (!same(calc, current.calc_psf)) set.calc_psf = calc;
    if ('is_active' in cols) set.discontinued_at = cols.is_active ? null : new Date().toISOString();
  }
  const hasMeta = ['project', 'configuration', 'tower'].includes(entity);
  const keys = Object.keys(set);
  const sql = `UPDATE ${def.table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}
    , row_version = row_version + 1 ${hasMeta ? `, updated_at = now(), updated_by = $${keys.length + 2}` : ''}
    WHERE id = $1 RETURNING *`;
  const params = [id, ...keys.map((k) => set[k])];
  if (hasMeta) params.push(user?.id ?? null);
  const r = await client.query(sql, params);
  const row = r.rows[0];

  const pid = entity === 'project' ? row.id : row.project_id ?? projectId;
  if (entity === 'project' && 'name' in cols && current.name) {
    await client.query('INSERT INTO project_aliases (project_id, name, normalized, kind, created_by) VALUES ($1,$2,$3,$4,$5)',
      [row.id, current.name, normalizeProjectName(current.name), 'previous_name', user?.id ?? null]);
  }
  await writeAudit(client, auditRows.map((a) => ({
    user_id: user?.id, action: 'update', entity, entity_id: String(id), project_id: pid, field: a.field, old_value: a.old, new_value: a.new, batch_id: batchId, note,
  })));
  if (entity !== 'project' && pid) await touchProject(client, pid, user);
  return { row, changed: auditRows.map((a) => a.field) };
}

/** Hard delete for light child rows (highlights etc.) — the full row is kept in the audit log. */
export async function deleteRecord(client, { entity, id, user, projectId, note = null }) {
  const def = ENTITIES[entity];
  const current = await loadRow(client, entity, id, true);
  if (projectId && current.project_id !== projectId) throw notFound();
  await client.query(`DELETE FROM ${def.table} WHERE id = $1`, [id]);
  await writeAudit(client, [{ user_id: user?.id, action: 'delete', entity, entity_id: String(id), project_id: current.project_id, old_value: current, note }]);
  if (current.project_id) await touchProject(client, current.project_id, user);
  return current;
}
