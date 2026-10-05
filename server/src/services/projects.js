// Project read model (detail views) + validation + workflow + duplicate detection.
import { query } from '../db.js';
import { getMeta, masterCode } from './meta.js';
import { presentConfig } from './search.js';
import { badRequest, conflict, forbidden, haversineKm, normalizeProjectName, notFound, today } from '../lib/util.js';
import { writeAudit } from './records.js';

const nameOf = (arr, id) => arr.find((x) => x.id === id)?.name ?? null;

export async function loadProjectRow(id) {
  const isNum = /^\d+$/.test(String(id));
  const r = await query(`SELECT * FROM projects WHERE ${isNum ? 'id = $1' : 'public_id = $1'}`, [isNum ? Number(id) : String(id)]);
  if (!r.rows[0]) throw notFound('Project not found');
  return r.rows[0];
}

export function canViewProject(user, p, meta) {
  if (user.permissions.has('project.view_all')) return true;
  return (meta.settings.sales_visible_statuses || ['published']).includes(p.record_status);
}

/**
 * Full project detail.
 * mode = 'sales'  → what a salesperson sees (no internal notes, no inactive rows, current offers only)
 * mode = 'edit'   → everything, for the data-entry wizard
 */
export async function getProjectDetail(id, user, mode = 'sales') {
  const meta = await getMeta();
  const p = await loadProjectRow(id);
  if (!canViewProject(user, p, meta)) throw notFound('Project not found');
  const edit = mode === 'edit';
  const activeOnly = edit ? '' : 'AND is_active';
  const [cfgs, towers, links, amen, hl, plans, offers, objections, generic, rera, aliases, users, verif, parent, children] = await Promise.all([
    query(`SELECT c.* FROM project_configurations c JOIN configuration_types ct ON ct.id=c.config_type_id WHERE c.project_id=$1 ${activeOnly.replace('is_active', 'c.is_active')} ORDER BY c.is_active DESC, c.sort_order, ct.sort_order, c.price_min NULLS LAST`, [p.id]),
    query(`SELECT * FROM towers WHERE project_id=$1 ${activeOnly} ORDER BY is_active DESC, sort_order, id`, [p.id]),
    query('SELECT ct.* FROM configuration_towers ct JOIN project_configurations c ON c.id = ct.configuration_id WHERE c.project_id=$1', [p.id]),
    query('SELECT pa.amenity_id, pa.remarks FROM project_amenities pa WHERE pa.project_id=$1', [p.id]),
    query(`SELECT * FROM project_highlights WHERE project_id=$1 ${activeOnly} ORDER BY kind, sort_order, id`, [p.id]),
    query(`SELECT * FROM payment_plans WHERE project_id=$1 ${activeOnly} ORDER BY sort_order, id`, [p.id]),
    query(`SELECT * FROM offers WHERE project_id=$1 ${activeOnly} ORDER BY sort_order, id`, [p.id]),
    query(`SELECT * FROM objections WHERE project_id=$1 ${activeOnly} ORDER BY sort_order, id`, [p.id]),
    edit ? { rows: [] } : query('SELECT * FROM objections WHERE project_id IS NULL AND is_active ORDER BY sort_order, id'),
    query(`SELECT * FROM project_rera WHERE project_id=$1 ${activeOnly} ORDER BY sort_order, id`, [p.id]),
    query('SELECT name, kind, created_at FROM project_aliases WHERE project_id=$1 ORDER BY created_at DESC', [p.id]),
    query('SELECT id, name, email FROM users WHERE id = ANY($1::int[])', [[p.created_by, p.updated_by, p.verified_by, p.submitted_by, p.published_by].filter(Boolean)]),
    query('SELECT v.*, u.name AS user_name FROM verifications v LEFT JOIN users u ON u.id=v.user_id WHERE project_id=$1 ORDER BY at DESC LIMIT 20', [p.id]),
    p.parent_project_id ? query('SELECT id, public_id, name, phase_name FROM projects WHERE id=$1', [p.parent_project_id]) : { rows: [] },
    query("SELECT id, public_id, name, phase_name FROM projects WHERE parent_project_id=$1 AND record_status <> 'archived'", [p.id]),
  ]);
  const u = (uid) => users.rows.find((x) => x.id === uid)?.name ?? null;
  const mv = (vid) => (vid ? { id: vid, code: meta.masterById.get(vid)?.code, label: meta.masterById.get(vid)?.label } : null);
  const t = today();
  const offerState = (o) => (!o.is_active ? 'inactive' : o.end_date && o.end_date < t ? 'expired' : o.start_date && o.start_date > t ? 'upcoming' : 'current');
  const towerBands = meta.bands.filter((b) => b.band_set_key === 'elevation' && b.is_active);
  const elevation = (floors) => (floors == null ? null : towerBands.find((b) => (b.lower_bound == null || floors >= Number(b.lower_bound)) && (b.upper_bound == null || floors < Number(b.upper_bound)))?.label ?? null);
  const staleDays = Number(meta.settings.stale_after_days || 90);
  const configs = cfgs.rows.map((c) => ({ ...presentConfig(c, meta), tower_ids: links.rows.filter((l) => l.configuration_id === c.id).map((l) => l.tower_id) }));
  const allOffers = offers.rows.map((o) => ({ ...o, state: offerState(o) }));
  const fields = meta.fields.filter((f) => f.is_active);

  const out = {
    id: p.id, public_id: p.public_id, name: p.name, row_version: p.row_version,
    developer: p.developer_id ? { id: p.developer_id, name: nameOf(meta.developers, p.developer_id), about: meta.developers.find((d) => d.id === p.developer_id)?.about ?? null } : null,
    phase_name: p.phase_name, parent: parent.rows[0] || null, phases: children.rows,
    city: p.city_id ? { id: p.city_id, name: nameOf(meta.cities, p.city_id) } : null,
    location: p.location_id ? { id: p.location_id, name: nameOf(meta.locations, p.location_id) } : null,
    sub_location: p.sub_location_id ? { id: p.sub_location_id, name: nameOf(meta.subLocations, p.sub_location_id) } : null,
    purpose: mv(p.purpose_id), launch_stage: mv(p.launch_stage_id), sales_status: mv(p.sales_status_id), eoi_type: mv(p.eoi_type_id),
    record_status: p.record_status, status_reason: p.status_reason,
    values: (({ attributes, field_states, normalized_name, ...rest }) => rest)(p),
    attributes: p.attributes || {}, field_states: p.field_states || {},
    configurations: configs,
    towers: towers.rows.map((tw) => ({ ...tw, elevation_band: elevation(tw.floors_above_ground) })),
    tower_summary: summarizeTowers(towers.rows.filter((x) => x.is_active), elevation, p.total_towers),
    amenities: amen.rows.map((a) => {
      const am = meta.amenities.find((x) => x.id === a.amenity_id);
      return { id: a.amenity_id, name: am?.name, category: am?.category_label, remarks: a.remarks };
    }),
    highlights: hl.rows,
    payment_plans: plans.rows,
    offers: edit ? allOffers : allOffers.filter((o) => o.state === 'current' || o.state === 'upcoming'),
    expired_offers_hidden: edit ? 0 : allOffers.filter((o) => o.state === 'expired').length,
    objections: objections.rows,
    generic_objections: generic.rows,
    rera: rera.rows,
    aliases: aliases.rows,
    freshness: {
      created_by: u(p.created_by), created_at: p.created_at, updated_by: u(p.updated_by), updated_at: p.updated_at,
      submitted_by: u(p.submitted_by), submitted_at: p.submitted_at, verified_by: u(p.verified_by), verified_at: p.verified_at,
      published_by: u(p.published_by), published_at: p.published_at,
      stale: new Date(p.updated_at) < new Date(Date.now() - staleDays * 86400000), stale_after_days: staleDays,
      unverified_changes: !p.verified_at || new Date(p.updated_at) > new Date(p.verified_at),
    },
    verifications: verif.rows,
    fields: fields.map((f) => ({ entity: f.entity, key: f.key, label: f.label, data_type: f.data_type, storage: f.storage, unit: f.unit, section: f.section, sort_order: f.sort_order, show_in_card: f.show_in_card, show_in_summary: f.show_in_summary, show_in_detail: f.show_in_detail, master_list_key: f.master_list_key })),
  };
  if (!edit) delete out.values.internal_notes;
  if (!user.permissions.has('project.view_all')) { delete out.values.internal_notes; delete out.values.data_source; }
  return out;
}

function summarizeTowers(towers, elevation, totalTowers) {
  if (!towers.length) return null;
  const count = towers.reduce((s, t) => s + (t.represents_count || 1), 0);
  const floors = towers.map((t) => t.floors_above_ground).filter((x) => x != null);
  const lifts = towers.map((t) => t.main_lifts).filter((x) => x != null);
  const uniq = (a) => [...new Set(a)];
  return {
    towers_recorded: count,
    total_towers: totalTowers,
    floors: uniq(floors).sort((a, b) => a - b),
    elevation_bands: uniq(floors.map(elevation).filter(Boolean)),
    flats_per_floor: uniq(towers.map((t) => t.flats_per_floor).filter((x) => x != null)).sort((a, b) => a - b),
    main_lifts: uniq(lifts).sort((a, b) => a - b),
    service_lifts: uniq(towers.map((t) => t.service_lifts).filter((x) => x != null)).sort((a, b) => a - b),
    uniform: uniq(towers.map((t) => `${t.floors_above_ground}|${t.flats_per_floor}|${t.main_lifts}|${t.service_lifts}|${t.habitable_from_floor}`)).length === 1,
  };
}

// ---------------------------------------------------------------------------------------------
// Validation: errors (must fix), warnings (unusual), info (missing but not wrong).
// phase 'save' = while drafting; 'submit' = before review (required fields become errors).
// ---------------------------------------------------------------------------------------------
export async function validateProject(projectId, phase = 'submit') {
  const meta = await getMeta();
  const p = (await query('SELECT * FROM projects WHERE id=$1', [projectId])).rows[0];
  if (!p) throw notFound();
  const [cfgs, towers, offers, hl, locs, subs] = await Promise.all([
    query('SELECT * FROM project_configurations WHERE project_id=$1 AND is_active', [p.id]),
    query('SELECT * FROM towers WHERE project_id=$1 AND is_active', [p.id]),
    query('SELECT * FROM offers WHERE project_id=$1 AND is_active', [p.id]),
    query('SELECT kind, count(*)::int n FROM project_highlights WHERE project_id=$1 AND is_active GROUP BY kind', [p.id]),
    p.location_id ? query('SELECT city_id FROM locations WHERE id=$1', [p.location_id]) : { rows: [] },
    p.sub_location_id ? query('SELECT location_id FROM sub_locations WHERE id=$1', [p.sub_location_id]) : { rows: [] },
  ]);
  const out = [];
  const add = (level, message, x = {}) => out.push({ level, message, ...x });
  const states = p.field_states || {};
  const missing = (k) => (p[k] === null || p[k] === undefined || p[k] === '') && !states[k];

  // Required fields (metadata-driven)
  for (const f of meta.fields.filter((x) => x.entity === 'project' && x.is_required && x.is_active)) {
    const empty = f.storage === 'attribute' ? p.attributes?.[f.key] == null : missing(f.key);
    if (empty) add(phase === 'submit' ? 'error' : 'info', `${f.label} is required`, { field: f.key, step: f.section });
  }
  // Hierarchy integrity
  if (p.location_id && locs.rows[0] && locs.rows[0].city_id !== p.city_id) add('error', 'Location does not belong to the selected city', { field: 'location_id', step: 'location' });
  if (p.sub_location_id && subs.rows[0] && subs.rows[0].location_id !== p.location_id) add('error', 'Sub-location does not belong to the selected location', { field: 'sub_location_id', step: 'location' });
  // Coordinates
  if (p.latitude == null || p.longitude == null) add(phase === 'submit' ? 'warning' : 'info', 'Map coordinates missing — project will not appear on the map', { field: 'latitude', step: 'location' });
  else {
    const city = meta.cities.find((c) => c.id === p.city_id);
    const lim = Number(meta.settings.coordinate_sanity_km || 60);
    if (city?.latitude && haversineKm(Number(p.latitude), Number(p.longitude), Number(city.latitude), Number(city.longitude)) > lim) {
      add('warning', `Coordinates are more than ${lim} km from ${city.name} — please check them`, { field: 'latitude', step: 'location' });
    }
  }
  // Possession
  if (missing('dev_possession_date') && missing('rera_possession_date')) add(phase === 'submit' ? 'warning' : 'info', 'No possession date (developer or RERA)', { field: 'dev_possession_date', step: 'status' });
  if (missing('rera_possession_date')) add('info', 'RERA possession date not provided', { field: 'rera_possession_date', step: 'status' });
  if (p.dev_possession_date && p.rera_possession_date && p.dev_possession_date > p.rera_possession_date) {
    add('warning', 'Developer possession is later than RERA possession — the developer is promising a date beyond the RERA commitment', { field: 'dev_possession_date', step: 'status' });
  }
  const completedCode = masterCode(meta, p.sales_status_id);
  if (p.rera_possession_date && p.rera_possession_date < today() && !['COMPLETED', 'SOLD_OUT', 'CANCELLED'].includes(completedCode) && masterCode(meta, p.launch_stage_id) !== 'RTM') {
    add('warning', 'RERA possession date has passed — is the project completed or delayed?', { field: 'rera_possession_date', step: 'status' });
  }
  // EOI
  const eoi = masterCode(meta, p.eoi_type_id);
  if (eoi === 'NA' && (p.eoi_amount || p.eoi_date || p.eoi_valid_until)) add('warning', 'EOI is marked N/A but EOI amount/dates are filled in', { field: 'eoi_type_id', step: 'eoi' });
  if (eoi === 'NA' && p.eoi_remarks) add('warning', 'EOI is marked N/A but EOI remarks are present — check the EOI type', { field: 'eoi_type_id', step: 'eoi' });
  if (p.eoi_date && p.eoi_valid_until && p.eoi_valid_until < p.eoi_date) add('error', 'EOI valid-until date is before the EOI start date', { field: 'eoi_valid_until', step: 'eoi' });
  if (!p.eoi_type_id && !states.eoi_type_id) add('info', 'EOI type not provided (choose N/A if there is no EOI)', { field: 'eoi_type_id', step: 'eoi' });
  // Parking
  const hp = p.has_parking;
  if (hp === 'no' && (p.basement_levels || p.stilt_levels || p.podium_levels)) add('warning', 'Parking marked "No" but parking levels are entered', { field: 'has_parking', step: 'parking' });
  // Purpose-dependent content
  const pm = meta.masterById.get(p.purpose_id)?.meta || {};
  const hlc = Object.fromEntries(hl.rows.map((r) => [r.kind, r.n]));
  if (pm.shows_residential_usp && !hlc.usp_residential) add('info', 'Residential USP not provided', { step: 'amenities' });
  if (pm.shows_investment_usp && !hlc.usp_investment) add('info', 'Investment USP not provided', { step: 'amenities' });
  if (!hlc.connectivity) add('info', 'Connectivity not provided', { step: 'location' });
  // Configurations
  if (!cfgs.rows.length) add(phase === 'submit' ? 'warning' : 'info', 'No configurations entered — the project cannot match budget/configuration searches', { step: 'configurations' });
  const sanity = meta.settings.psf_sanity || { min: 2500, max: 150000 };
  for (const c of cfgs.rows) {
    const t = meta.configTypes.find((x) => x.id === c.config_type_id)?.label || 'Configuration';
    const label = `${t}${c.variant ? ` (${c.variant})` : ''}`;
    const x = { entity: 'configuration', entity_id: c.id, step: 'configurations' };
    if (c.price_from && c.price_to && c.price_from > c.price_to) add('error', `${label}: Price From is greater than Price To`, x);
    if (c.carpet_from && c.carpet_to && c.carpet_from > c.carpet_to) add('error', `${label}: Carpet From is greater than Carpet To`, x);
    if (!c.price_min && !c.price_on_request && !c.field_states?.price_from) add('warning', `${label}: price missing (tick "Price on request" if applicable)`, x);
    if (!c.carpet_min && !c.field_states?.carpet_from) add('warning', `${label}: carpet area missing`, x);
    if (c.sbua_from && c.carpet_from && c.sbua_from < c.carpet_from) add('warning', `${label}: super built-up is smaller than carpet`, x);
    if (c.calc_psf && (c.calc_psf < sanity.min || c.calc_psf > sanity.max)) add('warning', `${label}: calculated ₹/sq.ft. ₹${Math.round(c.calc_psf).toLocaleString('en-IN')} looks unusual`, x);
    if (c.calc_psf && c.dev_psf && Math.abs(c.calc_psf - c.dev_psf) / c.dev_psf > 0.25) add('warning', `${label}: developer ₹/sq.ft. differs from calculated by more than 25%`, x);
    if (!c.inventory_status_id) add('info', `${label}: inventory status not set`, x);
  }
  // Towers
  const towerCount = towers.rows.reduce((s, t) => s + (t.represents_count || 1), 0);
  for (const tw of towers.rows) {
    const x = { entity: 'tower', entity_id: tw.id, step: 'towers' };
    if (tw.habitable_from_floor != null && tw.floors_above_ground != null && tw.habitable_from_floor > tw.floors_above_ground) add('error', `${tw.name}: habitable floor starts above the top floor`, x);
    if (tw.floors_above_ground == null) add('info', `${tw.name}: number of floors not provided`, x);
    if (tw.floors_above_ground > 10 && tw.main_lifts === 0) add('warning', `${tw.name}: ${tw.floors_above_ground} floors but 0 main lifts`, x);
  }
  if (p.total_towers != null && towerCount > p.total_towers) add('warning', `Tower rows represent ${towerCount} towers but the project total is ${p.total_towers}`, { step: 'towers', field: 'total_towers' });
  // Offers
  for (const o of offers.rows) {
    const x = { entity: 'offer', entity_id: o.id, step: 'eoi' };
    if (o.start_date && o.end_date && o.end_date < o.start_date) add('error', `Offer "${o.name}": end date before start date`, x);
    if (o.end_date && o.end_date < today()) add('info', `Offer "${o.name}" has expired and is hidden from sales`, x);
    if (!o.end_date) add('info', `Offer "${o.name}" has no end date`, x);
  }
  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// ---------------------------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------------------------
const TRANSITIONS = {
  submit: { from: ['draft', 'needs_update', 'verified'], to: 'under_review', perm: 'project.submit' },
  send_back: { from: ['under_review', 'verified'], to: 'draft', perm: 'project.verify', needsRemarks: true },
  verify: { from: ['under_review'], to: 'verified', perm: 'project.verify' },
  publish: { from: ['verified', 'needs_update', 'under_review'], to: 'published', perm: 'project.publish' },
  reverify: { from: ['published', 'needs_update'], to: 'published', perm: 'project.verify' }, // confirm a live project is still accurate
  mark_needs_update: { from: ['published'], to: 'needs_update', perm: 'project.edit', needsRemarks: true },
  unpublish: { from: ['published', 'needs_update'], to: 'verified', perm: 'project.publish', needsRemarks: true },
  deactivate: { from: ['draft', 'under_review', 'verified', 'published', 'needs_update'], to: 'inactive', perm: 'project.archive', needsRemarks: true },
  archive: { from: ['draft', 'under_review', 'verified', 'published', 'needs_update', 'inactive'], to: 'archived', perm: 'project.archive', needsRemarks: true },
  restore: { from: ['inactive', 'archived'], to: 'draft', perm: 'project.archive' },
};
export const WORKFLOW_ACTIONS = Object.keys(TRANSITIONS);

export async function runWorkflow(client, project, action, user, remarks) {
  const t = TRANSITIONS[action];
  if (!t) throw badRequest('Unknown action');
  if (!user.permissions.has(t.perm)) throw forbidden();
  if (!t.from.includes(project.record_status)) throw conflict(`Cannot ${action.replace('_', ' ')} a project that is ${project.record_status.replace('_', ' ')}`);
  if (t.needsRemarks && !String(remarks || '').trim()) throw badRequest('Please give a reason');
  if (['submit', 'verify', 'publish', 'reverify'].includes(action)) {
    const v = await validateProject(project.id, 'submit');
    const errors = v.filter((x) => x.level === 'error');
    if (errors.length) throw badRequest(`Fix ${errors.length} error(s) before you ${action}`, { validation: v });
  }
  const sets = ['record_status = $2', 'row_version = row_version + 1', 'status_reason = $4', 'updated_by = $3', 'updated_at = now()'];
  if (action === 'submit') sets.push('submitted_at = now()', 'submitted_by = $3');
  if (action === 'verify' || action === 'reverify') sets.push('verified_at = now()', 'verified_by = $3');
  if (action === 'publish') {
    sets.push('published_at = now()', 'published_by = $3');
    if (project.record_status === 'under_review') sets.push('verified_at = now()', 'verified_by = $3'); // reviewer publishing directly verifies too
    if (!user.permissions.has('project.verify') && project.record_status === 'under_review') throw forbidden('Only reviewers can publish without a separate verification step');
  }
  if (action === 'archive') sets.push('archived_at = now()');
  if (action === 'restore') sets.push('archived_at = NULL');
  const r = await client.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [project.id, t.to, user.id, remarks || null]);
  await client.query('INSERT INTO verifications (project_id, user_id, action, remarks) VALUES ($1,$2,$3,$4)', [project.id, user.id, action, remarks || null]);
  await writeAudit(client, [{ user_id: user.id, action: 'status', entity: 'project', entity_id: String(project.id), project_id: project.id, field: 'record_status', old_value: project.record_status, new_value: t.to, note: remarks || action }]);
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------------------------
export async function findDuplicates({ name, developer_id, city_id, location_id, sub_location_id, latitude, longitude, exclude_id }) {
  const meta = await getMeta();
  const cfg = meta.settings.duplicate_detection || { threshold: 0.45, radius_m: 400 };
  const norm = normalizeProjectName(name);
  if (!norm && (latitude == null || longitude == null)) return [];
  const r = await query(`
    SELECT p.id, p.public_id, p.name, p.developer_id, p.city_id, p.location_id, p.sub_location_id, p.latitude, p.longitude, p.record_status,
      GREATEST(similarity(p.normalized_name, $1), COALESCE((SELECT MAX(similarity(a.normalized, $1)) FROM project_aliases a WHERE a.project_id = p.id), 0)) AS name_sim
    FROM projects p
    WHERE ($2::int IS NULL OR p.id <> $2)
      AND ( similarity(p.normalized_name, $1) > 0.25
         OR EXISTS (SELECT 1 FROM project_aliases a WHERE a.project_id = p.id AND similarity(a.normalized, $1) > 0.25)
         OR ($3::numeric IS NOT NULL AND p.latitude IS NOT NULL AND abs(p.latitude - $3) < 0.01 AND abs(p.longitude - $4) < 0.01) )
    LIMIT 50`, [norm, exclude_id ?? null, latitude ?? null, longitude ?? null]);
  const out = [];
  for (const c of r.rows) {
    const reasons = [];
    let score = Number(c.name_sim) * 0.55;
    if (Number(c.name_sim) > 0.25) reasons.push(`Similar name (${Math.round(c.name_sim * 100)}%)`);
    if (developer_id && c.developer_id === Number(developer_id)) { score += 0.2; reasons.push('Same developer'); }
    if (sub_location_id && c.sub_location_id === Number(sub_location_id)) { score += 0.15; reasons.push('Same sub-location'); }
    else if (location_id && c.location_id === Number(location_id)) { score += 0.1; reasons.push('Same location'); }
    else if (city_id && c.city_id === Number(city_id)) score += 0.03;
    if (latitude != null && c.latitude != null) {
      const m = haversineKm(Number(latitude), Number(longitude), Number(c.latitude), Number(c.longitude)) * 1000;
      if (m <= cfg.radius_m) { score += 0.25; reasons.push(`${Math.round(m)} m away`); }
    }
    if (score >= cfg.threshold) {
      out.push({
        id: c.id, public_id: c.public_id, name: c.name, record_status: c.record_status, score: Math.min(1, Math.round(score * 100) / 100), reasons,
        developer: nameOf(meta.developers, c.developer_id), location: nameOf(meta.locations, c.location_id), sub_location: nameOf(meta.subLocations, c.sub_location_id),
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}
