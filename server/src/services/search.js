// The matching engine.
//
// Criteria are evaluated at three levels:
//   project-level  (city, developer, launch stage…)  → hard filters (WHERE)
//   tower-level    (elevation band, floors…)         → hard EXISTS over the project's towers
//   config-level   (configuration, price, carpet…)   → graded PER CONFIGURATION ROW:
//        2 = exact, 1 = partial, 0 = no match. A configuration's score is the LOWEST of its
//        criteria (all criteria must hold *for the same configuration*), and a project's
//        score is the BEST of its configurations. This is what stops "project has a 3 BHK and
//        something somewhere priced ₹1–1.3 Cr" from being reported as a 3 BHK at ₹1–1.3 Cr.
import { query } from '../db.js';
import { getMeta } from './meta.js';
import { resolveSource } from './filterSources.js';
import { badRequest, formatINR } from '../lib/util.js';

class Params {
  constructor() { this.values = []; }
  add(v) { this.values.push(v); return `$${this.values.length}`; }
}

export function formatValue(fmt, v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  switch (fmt) {
    case 'inr': return formatINR(n);
    case 'sqft': return `${Math.round(n).toLocaleString('en-IN')} sq.ft.`;
    case 'psf': return `₹${Math.round(n).toLocaleString('en-IN')}/sq.ft.`;
    case 'year': return String(n);
    case 'floors': return `G+${n}`;
    default: return n.toLocaleString('en-IN');
  }
}
const fmtRange = (fmt, lo, hi) => {
  if (lo == null && hi == null) return 'any';
  if (lo == null) return `up to ${formatValue(fmt, hi)}`;
  if (hi == null) return `${formatValue(fmt, lo)}+`;
  if (lo === hi) return formatValue(fmt, lo);
  return `${formatValue(fmt, lo)} – ${formatValue(fmt, hi)}`;
};

/** Convert a filter value ({min,max} or {bands:[ids]}) into a list of ranges. */
function toRanges(def, value, meta) {
  const ranges = [];
  if (Array.isArray(value?.bands) && value.bands.length) {
    const ids = value.bands.map(Number);
    const bands = meta.bands.filter((b) => ids.includes(b.id) && b.band_set_key === def.band_set_key)
      .sort((a, b) => (a.lower_bound ?? -Infinity) - (b.lower_bound ?? -Infinity));
    for (const b of bands) {
      const last = ranges[ranges.length - 1];
      if (last && last.hi !== null && b.lower_bound !== null && Number(b.lower_bound) <= last.hi) {
        last.hi = b.upper_bound === null ? null : Math.max(last.hi, Number(b.upper_bound)); // merge contiguous bands
      } else {
        ranges.push({ lo: b.lower_bound === null ? null : Number(b.lower_bound), hi: b.upper_bound === null ? null : Number(b.upper_bound), hiIncl: false });
      }
    }
  }
  const has = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
  if (!ranges.length && (has(value?.min) || has(value?.max))) {
    const lo = has(value.min) ? Number(value.min) : null;
    const hi = has(value.max) ? Number(value.max) : null;
    if (lo !== null && hi !== null && lo > hi) throw badRequest(`${def.label}: minimum is greater than maximum`);
    // A slider pinned to its own min/max means "no limit" on that side
    ranges.push({ lo: lo !== null && def.min_value !== null && lo <= Number(def.min_value) ? null : lo, hi: hi !== null && def.max_value !== null && hi >= Number(def.max_value) ? null : hi, hiIncl: true });
  }
  if (typeof value === 'number') ranges.push({ lo: value, hi: value, hiIncl: true });
  return ranges.filter((r) => r.lo !== null || r.hi !== null);
}

function rangeSql(P, vmin, vmax, r, mode, tolPct) {
  const conds = [];
  const lt = r.hiIncl ? '<=' : '<';
  if (mode === 'contained') {
    if (r.lo !== null) conds.push(`${vmin} >= ${P.add(r.lo)}::numeric`);
    if (r.hi !== null) conds.push(`${vmax} ${lt} ${P.add(r.hi)}::numeric`);
  } else if (mode === 'overlap') {
    if (r.hi !== null) conds.push(`${vmin} ${lt} ${P.add(r.hi)}::numeric`);
    if (r.lo !== null) conds.push(`${vmax} >= ${P.add(r.lo)}::numeric`);
  } else { // near (within tolerance)
    const t = tolPct / 100;
    if (r.hi !== null) conds.push(`${vmin} <= ${P.add(r.hi * (1 + t))}::numeric`);
    if (r.lo !== null) conds.push(`${vmax} >= ${P.add(r.lo * (1 - t))}::numeric`);
  }
  return conds.length ? `(${conds.join(' AND ')})` : 'TRUE';
}

/** Build the SQL fragments for every active filter that has a value. */
async function buildCriteria(filtersInput, meta, P, configOnly = false) {
  const matching = meta.settings.matching || {};
  const tol = Number(matching.tolerance_pct ?? 10);
  const exactRule = matching.range_exact_rule === 'overlap' ? 'overlap' : 'contained';
  const missingScore = matching.missing_value === 'exclude' ? 0 : 1;
  const project = [];
  const tower = [];
  const config = []; // { def, src, scoreSql, hard, ranges, ids }
  for (const def of meta.filters.filter((f) => f.is_active)) {
    const value = filtersInput?.[def.key];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
    const src = resolveSource(def.source_key, meta);
    if (!src) continue; // misconfigured filter: ignore rather than break search
    if (configOnly && src.level !== 'config') continue;
    let cond = null; // boolean SQL for hard evaluation
    let score = null; // graded SQL for config level
    let ranges = null;
    let ids = null;
    if (src.kind === 'ref' || src.kind === 'enum' || src.kind === 'refarray') {
      const list = (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== '');
      if (!list.length) continue;
      if (src.kind === 'ref') { ids = list.map(Number).filter(Number.isInteger); cond = `${src.expr} = ANY(${P.add(ids)}::int[])`; }
      else if (src.kind === 'enum') { ids = list.map(String); cond = `${src.expr} = ANY(${P.add(ids)}::text[])`; }
      else { ids = list.map(String); cond = `(${src.expr} ?| ${P.add(ids)}::text[])`; }
      score = `CASE WHEN ${cond} THEN 2 ELSE 0 END`;
    } else if (src.kind === 'bool') {
      if (value !== true && value !== 'true') continue;
      cond = `${src.expr} IS TRUE`;
      score = `CASE WHEN ${cond} THEN 2 ELSE 0 END`;
    } else {
      ranges = toRanges(def, value, meta);
      if (!ranges.length) continue;
      const vmin = src.kind === 'range' ? src.min : src.expr;
      const vmax = src.kind === 'range' ? src.max : src.expr;
      if (src.level === 'config') {
        const exact = ranges.map((r) => rangeSql(P, vmin, vmax, r, exactRule, tol)).join(' OR ');
        const partial = ranges.map((r) => `(${rangeSql(P, vmin, vmax, r, 'overlap', tol)} OR ${rangeSql(P, vmin, vmax, r, 'near', tol)})`).join(' OR ');
        score = `CASE WHEN ${vmin} IS NULL THEN ${missingScore} WHEN (${exact}) THEN 2 WHEN (${partial}) THEN 1 ELSE 0 END`;
      } else {
        // non-config numeric criteria are hard: a value inside the requested range(s)
        cond = `(${ranges.map((r) => rangeSql(P, vmin, vmax, r, 'contained', 0)).join(' OR ')})`;
      }
    }
    if (src.level === 'project') project.push(cond);
    else if (src.level === 'tower') tower.push(cond);
    else config.push({ def, src, score, hard: def.match_mode === 'hard', ranges, ids });
  }
  return { project, tower, config, missingScore, tol, exactRule };
}

function textSearch(q, P) {
  if (!q || !String(q).trim()) return null;
  const s = String(q).trim().toLowerCase();
  const like = P.add(`%${s.replace(/[%_]/g, '')}%`);
  const raw = P.add(s);
  return `(p.normalized_name ILIKE ${like} OR p.public_id ILIKE ${like} OR similarity(p.normalized_name, ${raw}) > 0.35
    OR EXISTS (SELECT 1 FROM project_aliases a WHERE a.project_id = p.id AND (a.normalized ILIKE ${like} OR similarity(a.normalized, ${raw}) > 0.35))
    OR EXISTS (SELECT 1 FROM developers d WHERE d.id = p.developer_id AND d.name ILIKE ${like})
    OR EXISTS (SELECT 1 FROM locations l WHERE l.id = p.location_id AND l.name ILIKE ${like})
    OR EXISTS (SELECT 1 FROM sub_locations sl WHERE sl.id = p.sub_location_id AND sl.name ILIKE ${like})
    OR p.locality ILIKE ${like} OR p.landmark ILIKE ${like})`;
}

const SORTS = {
  relevance: 'a.score DESC, a.exact_n DESC, a.partial_n DESC, p.name',
  price_asc: 'a.score DESC, a.match_price_min ASC NULLS LAST, p.name',
  price_desc: 'a.score DESC, a.match_price_max DESC NULLS LAST, p.name',
  possession: 'a.score DESC, p.dev_possession_date ASC NULLS LAST, p.name',
  updated: 'a.score DESC, p.updated_at DESC',
  name: 'p.name',
};

/**
 * Run a search.
 * opts: { filters, q, sort, page, page_size, match: 'all'|'exact', statuses (override), mapOnly }
 */
export async function search(opts = {}, { canSeeAll = false } = {}) {
  const meta = await getMeta();
  const P = new Params();
  const crit = await buildCriteria(opts.filters || {}, meta, P);
  const visible = canSeeAll && Array.isArray(opts.statuses) && opts.statuses.length ? opts.statuses : meta.settings.sales_visible_statuses || ['published'];
  const where = [`p.record_status::text = ANY(${P.add(visible)}::text[])`, ...crit.project];
  if (crit.tower.length) where.push(`EXISTS (SELECT 1 FROM towers t WHERE t.project_id = p.id AND t.is_active AND ${crit.tower.join(' AND ')})`);
  const ts = textSearch(opts.q, P);
  if (ts) where.push(ts);
  const hasCfg = crit.config.length > 0;
  const soldOut = meta.masterValues.filter((v) => v.list_key === 'inventory_status' && v.meta?.excludes_from_match).map((v) => v.id);
  const scoreParts = crit.config.filter((c) => !c.hard).map((c) => c.score);
  let cfgScore = scoreParts.length ? `LEAST(${scoreParts.join(', ')})` : '2';
  if (hasCfg && soldOut.length) cfgScore = `CASE WHEN c.inventory_status_id = ANY(${P.add(soldOut)}::int[]) THEN 0 ELSE ${cfgScore} END`;
  const cfgHard = crit.config.filter((c) => c.hard).map((c) => `(${c.score}) = 2`);
  const minScore = opts.match === 'exact' ? 2 : 1;

  const base = `
    WITH proj AS (SELECT p.id FROM projects p WHERE ${where.join(' AND ')}),
    cfg AS (
      SELECT c.id, c.project_id, ${cfgScore} AS score, c.price_min, c.price_max
      FROM project_configurations c JOIN proj ON proj.id = c.project_id
      WHERE c.is_active ${cfgHard.length ? `AND ${cfgHard.join(' AND ')}` : ''}
    ),
    agg AS (
      SELECT proj.id,
        CASE WHEN ${hasCfg ? 'TRUE' : 'FALSE'} THEN
          COALESCE(MAX(cfg.score), CASE WHEN EXISTS (SELECT 1 FROM project_configurations x WHERE x.project_id = proj.id) THEN 0 ELSE ${crit.missingScore} END)
        ELSE 2 END AS score,
        COUNT(cfg.id) FILTER (WHERE cfg.score = 2) AS exact_n,
        COUNT(cfg.id) FILTER (WHERE cfg.score = 1) AS partial_n,
        MIN(cfg.price_min) FILTER (WHERE cfg.score >= 1) AS match_price_min,
        MAX(cfg.price_max) FILTER (WHERE cfg.score >= 1) AS match_price_max
      FROM proj LEFT JOIN cfg ON cfg.project_id = proj.id
      GROUP BY proj.id
    )`;

  const minP = `${P.add(minScore)}::int`;
  const sort = !hasCfg && (!opts.sort || opts.sort === 'relevance') ? SORTS.name : SORTS[opts.sort] || SORTS.relevance;
  const pageSize = Math.min(Math.max(Number(opts.page_size) || 25, 1), 100);
  const page = Math.max(Number(opts.page) || 1, 1);
  const t0 = Date.now();

  const [listRes, mapRes, countsRes] = await Promise.all([
    query(`${base} SELECT a.*, p.* , a.score AS match_score FROM agg a JOIN projects p ON p.id = a.id WHERE a.score >= ${minP}
           ORDER BY ${sort} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, P.values),
    query(`${base} SELECT p.id, p.public_id, p.name, p.latitude, p.longitude, p.developer_id, a.score, a.match_price_min
           FROM agg a JOIN projects p ON p.id = a.id WHERE a.score >= ${minP} AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL LIMIT 3000`, P.values),
    query(`${base} SELECT COUNT(*) FILTER (WHERE score = 2)::int AS exact, COUNT(*) FILTER (WHERE score = 1)::int AS partial,
           COUNT(*) FILTER (WHERE score >= ${minP})::int AS total FROM agg`, P.values),
  ]);

  const rows = listRes.rows;
  const ids = rows.map((r) => r.id);
  // configuration rows for the page, with per-criterion scores so we can explain the match
  let cfgRows = [];
  if (ids.length) {
    const P2 = new Params();
    const crit2 = await buildCriteria(opts.filters || {}, meta, P2, true);
    const idsP = P2.add(ids);
    const critCols = crit2.config.map((c, i) => `${c.score} AS crit_${i}`).join(', ');
    const scoreParts2 = crit2.config.filter((c) => !c.hard).map((c) => c.score);
    let s2 = scoreParts2.length ? `LEAST(${scoreParts2.join(', ')})` : '2';
    const hard2 = crit2.config.filter((c) => c.hard).map((c) => `(${c.score}) = 2`);
    if (hard2.length) s2 = `CASE WHEN ${hard2.join(' AND ')} THEN ${s2} ELSE 0 END`;
    if (crit2.config.length && soldOut.length) s2 = `CASE WHEN c.inventory_status_id = ANY(${P2.add(soldOut)}::int[]) THEN 0 ELSE ${s2} END`;
    const r = await query(`SELECT c.*, ${s2} AS score ${critCols ? `, ${critCols}` : ''}
      FROM project_configurations c JOIN configuration_types ct ON ct.id = c.config_type_id
      WHERE c.project_id = ANY(${idsP}::int[]) AND c.is_active
      ORDER BY c.project_id, ct.sort_order, c.price_min NULLS LAST, c.carpet_min NULLS LAST`, P2.values);
    cfgRows = r.rows.map((c) => ({ ...c, reasons: explain(c, crit2, meta) }));
  }

  const results = rows.map((r) => present(r, cfgRows.filter((c) => c.project_id === r.id), meta, hasCfg));
  return {
    total: countsRes.rows[0].total,
    exact: countsRes.rows[0].exact,
    partial: countsRes.rows[0].partial,
    page, page_size: pageSize,
    results,
    map: mapRes.rows.map((m) => ({ id: m.id, public_id: m.public_id, name: m.name, lat: Number(m.latitude), lng: Number(m.longitude), status: statusOf(m.score), developer: devName(meta, m.developer_id), price_from: m.match_price_min })),
    criteria: crit.config.map((c) => ({ key: c.def.key, label: c.def.label, hard: c.hard })),
    took_ms: Date.now() - t0,
  };
}

const statusOf = (s) => (s >= 2 ? 'exact' : s >= 1 ? 'partial' : 'none');
const devName = (meta, id) => meta.developers.find((d) => d.id === id)?.name ?? null;

function explain(c, crit, meta) {
  const out = [];
  crit.config.forEach((k, i) => {
    const s = Number(c[`crit_${i}`]);
    const fmt = k.def.display_format;
        if (k.src.kind === 'ref' || k.src.kind === 'enum' || k.src.kind === 'refarray' || k.src.kind === 'bool') {
      if (s < 2) out.push({ status: "none", text: `${k.def.label} does not match` });
      return;
    }
    let vmin; let vmax;
    if (k.src.key === 'config.price') { vmin = c.price_min; vmax = c.price_max; }
    else if (k.src.key === 'config.carpet') { vmin = c.carpet_min; vmax = c.carpet_max; }
    else if (k.src.key === 'config.psf') { const rule = meta.settings.psf_display_rule; vmin = vmax = rule?.startsWith('calc') ? c.calc_psf ?? c.dev_psf : c.dev_psf ?? c.calc_psf; }
    const req = k.ranges.map((r) => fmtRange(fmt, r.lo, r.hi)).join(' or ');
    if (vmin === null || vmin === undefined) {
      out.push({ status: s === 1 ? 'partial' : 'none', text: k.src.key === 'config.price' && c.price_on_request ? 'Price on request' : `${k.src.label} not available` });
      return;
    }
    const val = fmtRange(fmt, vmin, vmax);
    const what = k.src.label;
    if (s === 2) out.push({ status: 'exact', text: `${what} ${val} — within ${req}` });
    else if (s === 1) {
      const r = k.ranges[0];
      let detail = 'partly overlaps';
      if (r.hi !== null && vmin > r.hi) detail = `is ${Math.round(((vmin - r.hi) / r.hi) * 100)}% above`;
      else if (r.lo !== null && vmax < r.lo) detail = `is ${Math.round(((r.lo - vmax) / r.lo) * 100)}% below`;
      out.push({ status: 'partial', text: `${what} ${val} — ${detail} ${req}` });
    } else out.push({ status: 'none', text: `${what} ${val} — outside ${req}` });
  });
  return out;
}

export function displayPsf(c, rule) {
  const dev = c.dev_psf ?? null;
  const calc = c.calc_psf ?? null;
  switch (rule) {
    case 'calculated_first': return calc != null ? { value: calc, source: 'calculated' } : dev != null ? { value: dev, source: 'developer' } : null;
    case 'developer_only': return dev != null ? { value: dev, source: 'developer' } : null;
    case 'calculated_only': return calc != null ? { value: calc, source: 'calculated' } : null;
    default: return dev != null ? { value: dev, source: 'developer' } : calc != null ? { value: calc, source: 'calculated' } : null;
  }
}

export function presentConfig(c, meta) {
  const t = meta.configTypes.find((x) => x.id === c.config_type_id);
  const inv = meta.masterById.get(c.inventory_status_id);
  return {
    id: c.id, type_id: c.config_type_id, config_type_id: c.config_type_id, type: t?.label ?? '?', area_label: t?.area_label ?? 'Carpet', variant: c.variant,
    carpet_from: c.carpet_from, carpet_to: c.carpet_to, sbua_from: c.sbua_from, sbua_to: c.sbua_to,
    price_from: c.price_from, price_to: c.price_to, price_on_request: c.price_on_request,
    dev_psf: c.dev_psf, calc_psf: c.calc_psf, psf_basis: c.psf_basis, psf: displayPsf(c, meta.settings.psf_display_rule),
    parking_count: c.parking_count, parking_remarks: c.parking_remarks,
    inventory_status: inv?.label ?? null, inventory_status_id: c.inventory_status_id, inventory_details: c.inventory_details, inventory_remarks: c.inventory_remarks,
    remarks: c.remarks, attributes: c.attributes, field_states: c.field_states, is_active: c.is_active, sort_order: c.sort_order, row_version: c.row_version,
    score: c.score === undefined ? undefined : Number(c.score), match: c.score === undefined ? undefined : statusOf(Number(c.score)), reasons: c.reasons,
  };
}

function present(r, cfgs, meta, hasCfg) {
  const name = (arr, id) => arr.find((x) => x.id === id)?.name ?? null;
  const mv = (id) => meta.masterById.get(id)?.label ?? null;
  const configs = cfgs.map((c) => presentConfig(c, meta)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const notes = [];
  if (!cfgs.length) notes.push(hasCfg ? 'No configuration data yet — shown as a possible match' : 'No configuration data yet');
  const priced = cfgs.filter((c) => c.price_min != null);
  const carpets = cfgs.filter((c) => c.carpet_min != null);
  const staleDays = Number(meta.settings.stale_after_days || 90);
  const cardAttrs = {};
  for (const f of meta.fields.filter((x) => x.entity === 'project' && x.storage === 'attribute' && x.show_in_card && x.is_active)) {
    if (r.attributes?.[f.key] !== undefined) cardAttrs[f.key] = r.attributes[f.key];
  }
  return {
    id: r.id, public_id: r.public_id, name: r.name,
    developer: { id: r.developer_id, name: devName(meta, r.developer_id) },
    city: name(meta.cities, r.city_id), location: name(meta.locations, r.location_id), sub_location: name(meta.subLocations, r.sub_location_id),
    locality: r.locality, landmark: r.landmark,
    lat: r.latitude === null ? null : Number(r.latitude), lng: r.longitude === null ? null : Number(r.longitude), coords_status: r.coords_status,
    purpose: mv(r.purpose_id), launch_stage: mv(r.launch_stage_id), sales_status: mv(r.sales_status_id), record_status: r.record_status,
    dev_possession_date: r.dev_possession_date, rera_possession_date: r.rera_possession_date,
    land_parcel_acres: r.land_parcel_acres, field_states: r.field_states, attributes: cardAttrs,
    match: { status: statusOf(Number(r.match_score)), exact_n: Number(r.exact_n), partial_n: Number(r.partial_n), filtered: hasCfg, notes },
    configs,
    summary: {
      types: [...new Set(configs.map((c) => c.type))],
      price_min: priced.length ? Math.min(...priced.map((c) => c.price_min)) : null,
      price_max: priced.length ? Math.max(...priced.map((c) => c.price_max)) : null,
      carpet_min: carpets.length ? Math.min(...carpets.map((c) => c.carpet_min)) : null,
      carpet_max: carpets.length ? Math.max(...carpets.map((c) => c.carpet_max)) : null,
    },
    updated_at: r.updated_at, verified_at: r.verified_at,
    stale: new Date(r.updated_at) < new Date(Date.now() - staleDays * 86400000),
    unverified_changes: !r.verified_at || new Date(r.updated_at) > new Date(r.verified_at),
  };
}
