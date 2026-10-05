// Data-entry / review API for projects and their child records.
import { Router } from 'express';
import { requirePerm } from '../middleware/auth.js';
import { query, tx } from '../db.js';
import { getMeta, invalidate } from '../services/meta.js';
import { createRecord, updateRecord, deleteRecord, loadRow, writeAudit } from '../services/records.js';
import { CHILD_ROUTES, ENTITIES } from '../services/registry.js';
import { getProjectDetail, validateProject, runWorkflow, findDuplicates, loadProjectRow, WORKFLOW_ACTIONS } from '../services/projects.js';
import { presentConfig } from '../services/search.js';
import { badRequest, conflict, forbidden, notFound, normalizeName } from '../lib/util.js';

const r = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const LOCKED = ['archived', 'inactive'];

async function editableProject(id, user) {
  const p = await loadProjectRow(id);
  if (LOCKED.includes(p.record_status)) throw conflict(`This project is ${p.record_status}. Restore it before editing.`);
  if (p.record_status === 'under_review' && !user.permissions.has('project.verify') && !user.permissions.has('project.edit')) throw forbidden();
  return p;
}

// ---------------- list ----------------
r.get('/', requirePerm('project.view_all'), wrap(async (req, res) => {
  const meta = await getMeta();
  const { status, q, city, mine, issue } = req.query;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const size = Math.min(Number(req.query.page_size) || 50, 200);
  const params = [];
  const where = [];
  if (status && status !== 'all') { params.push(String(status).split(',')); where.push(`p.record_status::text = ANY($${params.length}::text[])`); }
  else if (!status) where.push("p.record_status <> 'archived'");
  if (city) { params.push(Number(city)); where.push(`p.city_id = $${params.length}`); }
  if (mine === '1') { params.push(req.user.id); where.push(`(p.created_by = $${params.length} OR p.updated_by = $${params.length})`); }
  if (q) { params.push(`%${String(q).toLowerCase()}%`); where.push(`(p.normalized_name ILIKE $${params.length} OR lower(p.name) ILIKE $${params.length} OR p.public_id ILIKE $${params.length} OR EXISTS (SELECT 1 FROM developers d WHERE d.id=p.developer_id AND lower(d.name) ILIKE $${params.length}))`); }
  if (issue === 'unverified') where.push('(p.verified_at IS NULL OR p.updated_at > p.verified_at)');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, counts] = await Promise.all([
    query(`SELECT p.id, p.public_id, p.name, p.developer_id, p.city_id, p.location_id, p.sub_location_id, p.record_status, p.sales_status_id,
        p.updated_at, p.verified_at, p.latitude IS NOT NULL AS has_coords, u.name AS updated_by_name,
        (SELECT count(*)::int FROM project_configurations c WHERE c.project_id=p.id AND c.is_active) AS config_count,
        (SELECT count(*)::int FROM towers t WHERE t.project_id=p.id AND t.is_active) AS tower_count,
        count(*) OVER()::int AS total
      FROM projects p LEFT JOIN users u ON u.id = p.updated_by ${w}
      ORDER BY p.updated_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params),
    query('SELECT record_status, count(*)::int n FROM projects GROUP BY record_status'),
  ]);
  const nm = (a, id) => a.find((x) => x.id === id)?.name ?? null;
  res.json({
    total: rows.rows[0]?.total ?? 0, page, page_size: size,
    counts: Object.fromEntries(counts.rows.map((c) => [c.record_status, c.n])),
    items: rows.rows.map((p) => ({
      ...p, total: undefined, developer: nm(meta.developers, p.developer_id), city: nm(meta.cities, p.city_id), location: nm(meta.locations, p.location_id), sub_location: nm(meta.subLocations, p.sub_location_id),
      sales_status: meta.masterById.get(p.sales_status_id)?.label ?? null,
    })),
  });
}));

// ---------------- duplicates & create ----------------
r.post('/check-duplicates', requirePerm('project.create'), wrap(async (req, res) => {
  res.json({ candidates: await findDuplicates(req.body || {}) });
}));

r.post('/', requirePerm('project.create'), wrap(async (req, res) => {
  const { values = {}, attributes = {}, states = {}, confirm_not_duplicate, duplicate_reason } = req.body || {};
  if (!values.name || !values.city_id) throw badRequest('Project name and city are required to start a project');
  const dups = await findDuplicates({ ...values });
  if (dups.length && !confirm_not_duplicate) {
    return res.status(409).json({ error: 'Possible existing project found', code: 'possible_duplicate', candidates: dups });
  }
  if (dups.length && !String(duplicate_reason || '').trim()) throw badRequest('Please say why this is a different project');
  const created = await tx(async (c) => {
    const p = await createRecord(c, {
      entity: 'project', values, attributes, states, user: req.user,
      note: dups.length ? `Created despite possible duplicate(s) ${dups.map((d) => d.public_id).join(', ')}: ${duplicate_reason}` : null,
    });
    return p;
  });
  res.status(201).json({ id: created.id, public_id: created.public_id });
}));

// ---------------- inline developer creation for data editors ----------------
r.post('/developers', requirePerm('project.create'), wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw badRequest('Developer name is required');
  const norm = normalizeName(name);
  const sim = (await query(`SELECT id, name, round(similarity(normalized_name, $1)::numeric, 2) AS s FROM developers
    WHERE merged_into_id IS NULL AND (normalized_name = $1 OR similarity(normalized_name, $1) > 0.45 OR $2 ILIKE ANY(aliases)) ORDER BY s DESC LIMIT 5`, [norm, name])).rows;
  const exact = sim.find((s) => Number(s.s) >= 0.999 || s.name.toLowerCase() === name.toLowerCase());
  if (exact) return res.status(409).json({ error: `"${exact.name}" already exists`, code: 'exists', candidates: sim });
  if (sim.length && !req.body.confirm_not_duplicate) return res.status(409).json({ error: 'Similar developers already exist', code: 'possible_duplicate', candidates: sim });
  const row = await tx(async (c) => {
    const d = (await c.query('INSERT INTO developers (name, normalized_name, about) VALUES ($1,$2,$3) RETURNING *', [name, norm, req.body.about || null])).rows[0];
    await writeAudit(c, [{ user_id: req.user.id, action: 'create', entity: 'developers', entity_id: String(d.id), new_value: d }]);
    return d;
  });
  invalidate();
  res.status(201).json(row);
}));

// ---------------- read ----------------
r.get('/:id', requirePerm('project.view_all'), wrap(async (req, res) => {
  const detail = await getProjectDetail(req.params.id, req.user, 'edit');
  const validation = await validateProject(detail.id, 'save');
  res.json({ ...detail, validation });
}));

r.get('/:id/validation', requirePerm('project.view_all'), wrap(async (req, res) => {
  const p = await loadProjectRow(req.params.id);
  res.json(await validateProject(p.id, req.query.phase === 'save' ? 'save' : 'submit'));
}));

r.get('/:id/history', requirePerm('audit.view'), wrap(async (req, res) => {
  const p = await loadProjectRow(req.params.id);
  const rows = await query(`SELECT a.*, u.name AS user_name, u.email AS user_email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.project_id = $1 ORDER BY a.at DESC, a.id DESC LIMIT $2`, [p.id, Math.min(Number(req.query.limit) || 300, 2000)]);
  res.json(rows.rows);
}));

// ---------------- update project fields ----------------
r.patch('/:id', requirePerm('project.edit'), wrap(async (req, res) => {
  const p = await editableProject(req.params.id, req.user);
  const { changes } = req.body || {};
  if (!changes || typeof changes !== 'object') throw badRequest('No changes sent');
  const out = await tx((c) => updateRecord(c, { entity: 'project', id: p.id, changes, user: req.user, note: req.body.note }));
  res.json({ row: out.row, changed: out.changed, validation: await validateProject(p.id, 'save') });
}));

// ---------------- workflow ----------------
r.post('/:id/workflow', requirePerm('project.view_all'), wrap(async (req, res) => {
  const { action, remarks } = req.body || {};
  if (!WORKFLOW_ACTIONS.includes(action)) throw badRequest('Unknown action');
  const p = await loadProjectRow(req.params.id);
  const row = await tx((c) => runWorkflow(c, p, action, req.user, remarks));
  res.json({ record_status: row.record_status });
}));

// ---------------- permanent delete (admin, drafts/archived only) ----------------
r.delete('/:id', requirePerm('project.delete'), wrap(async (req, res) => {
  const p = await loadProjectRow(req.params.id);
  if (!['draft', 'archived'].includes(p.record_status)) throw conflict('Only draft or archived projects can be permanently deleted. Archive it first.');
  if (p.published_at) throw conflict('This project has been published before; archive it instead of deleting so its history is preserved.');
  if (String(req.body?.confirm_name || '').trim() !== p.name) throw badRequest('Type the exact project name to confirm deletion');
  await tx(async (c) => {
    const snapshot = await getProjectDetail(p.id, req.user, 'edit');
    for (const t of ['configuration_towers WHERE configuration_id IN (SELECT id FROM project_configurations WHERE project_id=$1)', 'project_configurations WHERE project_id=$1', 'towers WHERE project_id=$1',
      'project_amenities WHERE project_id=$1', 'project_highlights WHERE project_id=$1', 'payment_plans WHERE project_id=$1', 'offers WHERE project_id=$1',
      'objections WHERE project_id=$1', 'project_rera WHERE project_id=$1', 'project_aliases WHERE project_id=$1', 'verifications WHERE project_id=$1']) {
      await c.query(`DELETE FROM ${t}`, [p.id]);
    }
    await c.query('UPDATE audit_log SET project_id = NULL WHERE project_id = $1', [p.id]);
    await c.query('DELETE FROM projects WHERE id=$1', [p.id]);
    await writeAudit(c, [{ user_id: req.user.id, action: 'delete', entity: 'project', entity_id: String(p.id), old_value: snapshot, note: `Permanently deleted ${p.public_id} ${p.name}` }]);
  });
  res.json({ ok: true });
}));

// ---------------- amenities ----------------
r.put('/:id/amenities', requirePerm('project.edit'), wrap(async (req, res) => {
  const p = await editableProject(req.params.id, req.user);
  const items = (req.body?.items || []).map((i) => ({ amenity_id: Number(i.amenity_id), remarks: i.remarks ? String(i.remarks).slice(0, 500) : null }));
  await tx(async (c) => {
    const before = (await c.query('SELECT amenity_id, remarks FROM project_amenities WHERE project_id=$1', [p.id])).rows;
    const beforeIds = new Set(before.map((b) => b.amenity_id));
    const afterIds = new Set(items.map((i) => i.amenity_id));
    await c.query('DELETE FROM project_amenities WHERE project_id=$1', [p.id]);
    for (const i of items) await c.query('INSERT INTO project_amenities (project_id, amenity_id, remarks) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [p.id, i.amenity_id, i.remarks]);
    const added = [...afterIds].filter((x) => !beforeIds.has(x));
    const removed = [...beforeIds].filter((x) => !afterIds.has(x));
    if (added.length || removed.length) {
      const meta = await getMeta();
      const nm = (ids) => ids.map((id) => meta.amenities.find((a) => a.id === id)?.name ?? id);
      await writeAudit(c, [{ user_id: req.user.id, action: 'update', entity: 'project', entity_id: String(p.id), project_id: p.id, field: 'amenities', old_value: nm(removed), new_value: nm(added), note: 'old = removed, new = added' }]);
      await c.query('UPDATE projects SET updated_at=now(), updated_by=$2 WHERE id=$1', [p.id, req.user.id]);
    }
  });
  res.json({ ok: true });
}));

// ---------------- towers: bulk create & shared-information apply ----------------
const TOWER_SHARED = ['phase', 'flats_per_floor', 'floors_above_ground', 'habitable_from_floor', 'main_lifts', 'service_lifts', 'parking_remarks', 'remarks'];

r.post('/:id/towers/bulk-create', requirePerm('project.edit'), wrap(async (req, res) => {
  const p = await editableProject(req.params.id, req.user);
  const { count, naming = 'letters', prefix = 'Tower', names, values = {} } = req.body || {};
  const list = Array.isArray(names) && names.length ? names.map(String) : Array.from({ length: Math.min(Number(count) || 0, 100) }, (_, i) => (naming === 'numbers' ? `${prefix} ${i + 1}` : `${prefix} ${i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + i - 26)}`}`));
  if (!list.length) throw badRequest('How many towers?');
  const shared = Object.fromEntries(Object.entries(values).filter(([k]) => TOWER_SHARED.includes(k)));
  const created = await tx(async (c) => {
    const existing = (await c.query('SELECT lower(name) n, max(sort_order) OVER () mx FROM towers WHERE project_id=$1 AND is_active', [p.id])).rows;
    const taken = new Set(existing.map((e) => e.n));
    const dupe = list.find((n) => taken.has(n.toLowerCase()));
    if (dupe) throw conflict(`A tower called "${dupe}" already exists`);
    let so = (existing[0]?.mx || 0) + 10;
    const out = [];
    for (const name of list) { out.push(await createRecord(c, { entity: 'tower', projectId: p.id, user: req.user, values: { ...shared, name, sort_order: so } })); so += 10; }
    return out;
  });
  res.status(201).json(created);
}));

/** Apply the same values to several towers. Each tower still stores its own final values. */
r.post('/:id/towers/apply', requirePerm('project.edit'), wrap(async (req, res) => {
  const p = await editableProject(req.params.id, req.user);
  const { tower_ids = [], values = {}, only_empty = false } = req.body || {};
  const fields = Object.keys(values).filter((k) => TOWER_SHARED.includes(k));
  if (!tower_ids.length || !fields.length) throw badRequest('Select towers and at least one value to apply');
  const out = await tx(async (c) => {
    const rows = [];
    for (const tid of tower_ids.map(Number)) {
      const cur = await loadRow(c, 'tower', tid);
      if (cur.project_id !== p.id) throw notFound('Tower not found in this project');
      const changes = {};
      for (const f of fields) if (!only_empty || cur[f] === null) changes[f] = { to: values[f] };
      rows.push((await updateRecord(c, { entity: 'tower', id: tid, changes, user: req.user, note: `Shared tower details applied to ${tower_ids.length} towers` })).row);
    }
    return rows;
  });
  res.json(out);
}));

r.put('/:id/configurations/:cid/towers', requirePerm('project.edit'), wrap(async (req, res) => {
  const p = await editableProject(req.params.id, req.user);
  const cid = Number(req.params.cid);
  const ids = (req.body?.tower_ids || []).map(Number);
  await tx(async (c) => {
    const cfg = await loadRow(c, 'configuration', cid);
    if (cfg.project_id !== p.id) throw notFound();
    const valid = (await c.query('SELECT id FROM towers WHERE project_id=$1 AND id = ANY($2::int[])', [p.id, ids])).rows.map((x) => x.id);
    const before = (await c.query('SELECT tower_id FROM configuration_towers WHERE configuration_id=$1 ORDER BY tower_id', [cid])).rows.map((x) => x.tower_id);
    await c.query('DELETE FROM configuration_towers WHERE configuration_id=$1', [cid]);
    for (const t of valid) await c.query('INSERT INTO configuration_towers VALUES ($1,$2)', [cid, t]);
    await writeAudit(c, [{ user_id: req.user.id, action: 'update', entity: 'configuration', entity_id: String(cid), project_id: p.id, field: 'tower_ids', old_value: before, new_value: valid.sort((a, b) => a - b) }]);
  });
  res.json({ ok: true });
}));

// ---------------- generic child collections ----------------
const childEntity = (seg) => {
  const e = CHILD_ROUTES[seg];
  if (!e) throw notFound();
  return e;
};
async function presentChild(entity, row) {
  if (entity === 'configuration') return presentConfig(row, await getMeta());
  return row;
}

r.post('/:id/:child', requirePerm('project.edit'), wrap(async (req, res) => {
  const entity = childEntity(req.params.child);
  const p = await editableProject(req.params.id, req.user);
  const { values = {}, attributes = {}, states = {} } = req.body || {};
  const row = await tx((c) => createRecord(c, { entity, projectId: p.id, values, attributes, states, user: req.user }));
  res.status(201).json({ row: await presentChild(entity, row), validation: await validateProject(p.id, 'save') });
}));

r.patch('/:id/:child/:childId', requirePerm('project.edit'), wrap(async (req, res) => {
  const entity = childEntity(req.params.child);
  const p = await editableProject(req.params.id, req.user);
  const { changes } = req.body || {};
  if (!changes) throw badRequest('No changes sent');
  const out = await tx((c) => updateRecord(c, { entity, id: Number(req.params.childId), changes, user: req.user, expectProjectId: p.id }));
  res.json({ row: await presentChild(entity, out.row), changed: out.changed, validation: await validateProject(p.id, 'save') });
}));

/** Configurations & towers are soft-deleted (discontinued); light rows are deleted with an audit snapshot. */
r.delete('/:id/:child/:childId', requirePerm('project.edit'), wrap(async (req, res) => {
  const entity = childEntity(req.params.child);
  const p = await editableProject(req.params.id, req.user);
  const id = Number(req.params.childId);
  const soft = ['configuration', 'tower', 'offer', 'payment_plan', 'rera'].includes(entity) && req.query.hard !== '1';
  const out = await tx(async (c) => {
    if (soft) {
      const cur = await loadRow(c, entity, id);
      if (cur.project_id !== p.id) throw notFound();
      return (await updateRecord(c, { entity, id, changes: { is_active: { to: false } }, user: req.user, note: req.body?.reason || `${ENTITIES[entity].label} discontinued` })).row;
    }
    return deleteRecord(c, { entity, id, user: req.user, projectId: p.id, note: req.body?.reason });
  });
  res.json({ ok: true, soft, row: out });
}));

export default r;
