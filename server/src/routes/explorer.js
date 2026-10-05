import { Router } from 'express';
import { requirePerm } from '../middleware/auth.js';
import { getMeta, listValues } from '../services/meta.js';
import { resolveSource } from '../services/filterSources.js';
import { search } from '../services/search.js';
import { getProjectDetail } from '../services/projects.js';
import { query } from '../db.js';

const r = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const TRISTATE = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }, { id: 'na', label: 'Not applicable' }, { id: 'unknown', label: 'Unknown' }];

export function optionsFor(src, meta) {
  if (!src?.options) return null;
  const o = src.options;
  if (o === 'cities') return meta.cities.filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.name }));
  if (o === 'locations') return meta.locations.filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.name, parent_id: c.city_id }));
  if (o === 'sub_locations') return meta.subLocations.filter((c) => c.is_active).map((c) => ({ id: c.id, label: c.name, parent_id: c.location_id }));
  if (o === 'developers') return meta.developers.filter((d) => d.is_active).map((d) => ({ id: d.id, label: d.name }));
  if (o === 'config_types') return meta.configTypes.filter((d) => d.is_active).map((d) => ({ id: d.id, label: d.label, group: d.category }));
  if (o === 'tristate') return TRISTATE;
  if (o.startsWith('master:')) return listValues(meta, o.slice(7)).map((v) => ({ id: v.id, label: v.label, code: v.code }));
  return null;
}

/** Everything the explorer UI needs to render itself — driven entirely by metadata. */
r.get('/config', requirePerm('explorer.view'), wrap(async (req, res) => {
  const meta = await getMeta();
  const filters = meta.filters.filter((f) => f.is_active).map((f) => {
    const src = resolveSource(f.source_key, meta);
    if (!src) return null;
    return {
      key: f.key, label: f.label, control: f.control, level: src.level, kind: src.kind, depends_on: f.depends_on,
      match_mode: f.match_mode, min: f.min_value, max: f.max_value, step: f.step, unit: f.unit, display_format: f.display_format,
      is_primary: f.is_primary, help_text: f.help_text, default_value: f.default_value,
      options: optionsFor(src, meta),
      bands: f.band_set_key ? meta.bands.filter((b) => b.band_set_key === f.band_set_key && b.is_active).map((b) => ({ id: b.id, label: b.label, lower: b.lower_bound, upper: b.upper_bound })) : null,
    };
  }).filter(Boolean);
  res.set('Cache-Control', 'private, max-age=30');
  res.json({
    version: meta.version,
    filters,
    settings: {
      matching: meta.settings.matching, map: meta.settings.map, psf_display_rule: meta.settings.psf_display_rule, stale_after_days: meta.settings.stale_after_days,
    },
    fields: meta.fields.filter((f) => f.is_active).map((f) => ({ entity: f.entity, key: f.key, label: f.label, data_type: f.data_type, storage: f.storage, unit: f.unit, section: f.section, show_in_card: f.show_in_card, show_in_summary: f.show_in_summary, show_in_detail: f.show_in_detail, master_list_key: f.master_list_key })),
    sorts: [
      { key: 'relevance', label: 'Best match' }, { key: 'price_asc', label: 'Price: low to high' }, { key: 'price_desc', label: 'Price: high to low' },
      { key: 'possession', label: 'Earliest possession' }, { key: 'updated', label: 'Recently updated' }, { key: 'name', label: 'Name' },
    ],
    master_labels: Object.fromEntries(meta.masterValues.map((v) => [v.id, v.label])),
  });
}));

r.post('/search', requirePerm('explorer.view'), wrap(async (req, res) => {
  const out = await search(req.body || {}, { canSeeAll: req.user.permissions.has('project.view_all') });
  res.json(out);
}));

r.get('/projects/:id', requirePerm('explorer.view'), wrap(async (req, res) => {
  res.json(await getProjectDetail(req.params.id, req.user, 'sales'));
}));

/** Objection-handling search across visible projects + the generic library. */
r.get('/objections', requirePerm('explorer.view'), wrap(async (req, res) => {
  const meta = await getMeta();
  const q = String(req.query.q || '').trim();
  const visible = meta.settings.sales_visible_statuses || ['published'];
  const params = [visible];
  let cond = '';
  if (q) { params.push(`%${q}%`, q); cond = `AND (o.objection ILIKE $2 OR o.response ILIKE $2 OR similarity(o.objection || ' ' || coalesce(o.response,''), $3) > 0.15 OR $3 = ANY(o.tags))`; }
  const rows = await query(`SELECT o.id, o.objection, o.response, o.tags, p.id AS project_id, p.name AS project_name, p.public_id
    FROM objections o LEFT JOIN projects p ON p.id = o.project_id
    WHERE o.is_active AND (o.project_id IS NULL OR p.record_status::text = ANY($1::text[])) AND o.response IS NOT NULL ${cond}
    ORDER BY (o.project_id IS NULL) DESC, p.name NULLS FIRST LIMIT 50`, params);
  res.json(rows.rows);
}));

export default r;
