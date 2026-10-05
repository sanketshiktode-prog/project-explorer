// Whitelisted filter sources. A filter definition (DB row) points at one of these keys, or at a
// custom field ("project.attr.<key>", "config.attr.<key>", "tower.attr.<key>").
// Administrators choose sources from this list; they never type SQL.
//
// level:  project | config | tower   → where the criterion is evaluated
// kind:   ref (id list) | number (single value) | range (min/max columns) | enum | refarray | bool
export const SOURCES = {
  'project.city': { level: 'project', kind: 'ref', expr: 'p.city_id', options: 'cities', label: 'City' },
  'project.location': { level: 'project', kind: 'ref', expr: 'p.location_id', options: 'locations', parent: 'city_id', label: 'Location' },
  'project.sub_location': { level: 'project', kind: 'ref', expr: 'p.sub_location_id', options: 'sub_locations', parent: 'location_id', label: 'Sub-location' },
  'project.developer': { level: 'project', kind: 'ref', expr: 'p.developer_id', options: 'developers', label: 'Developer' },
  'project.purpose': { level: 'project', kind: 'ref', expr: 'p.purpose_id', options: 'master:purpose', label: 'Purpose' },
  'project.launch_stage': { level: 'project', kind: 'ref', expr: 'p.launch_stage_id', options: 'master:launch_stage', label: 'Launch stage' },
  'project.sales_status': { level: 'project', kind: 'ref', expr: 'p.sales_status_id', options: 'master:sales_status', label: 'Project status' },
  'project.eoi_type': { level: 'project', kind: 'ref', expr: 'p.eoi_type_id', options: 'master:eoi_type', label: 'EOI type' },
  'project.dev_possession_year': { level: 'project', kind: 'number', expr: 'p.dev_possession_year', label: 'Developer possession year' },
  'project.rera_possession_year': { level: 'project', kind: 'number', expr: 'p.rera_possession_year', label: 'RERA possession year' },
  'project.land_parcel_acres': { level: 'project', kind: 'number', expr: 'p.land_parcel_acres', label: 'Land parcel (acres)' },
  'project.open_space_pct': { level: 'project', kind: 'number', expr: 'p.open_space_pct', label: 'Open space %' },
  'project.total_towers': { level: 'project', kind: 'number', expr: 'p.total_towers', label: 'Total towers' },
  'project.has_parking': { level: 'project', kind: 'enum', expr: 'p.has_parking::text', options: 'tristate', label: 'Parking available' },
  'config.type': { level: 'config', kind: 'ref', expr: 'c.config_type_id', options: 'config_types', label: 'Configuration type' },
  'config.price': { level: 'config', kind: 'range', min: 'c.price_min', max: 'c.price_max', label: 'Price' },
  'config.carpet': { level: 'config', kind: 'range', min: 'c.carpet_min', max: 'c.carpet_max', label: 'Carpet area' },
  'config.psf': { level: 'config', kind: 'number', expr: '__PSF__', label: '₹ per sq.ft. (display rule)' },
  'config.inventory_status': { level: 'config', kind: 'ref', expr: 'c.inventory_status_id', options: 'master:inventory_status', label: 'Inventory status' },
  'config.parking_count': { level: 'config', kind: 'number', expr: 'c.parking_count', label: 'Parking per unit' },
  'tower.floors': { level: 'tower', kind: 'number', expr: 't.floors_above_ground', label: 'Tower floors (G+)' },
  'tower.flats_per_floor': { level: 'tower', kind: 'number', expr: 't.flats_per_floor', label: 'Flats per floor' },
  'tower.main_lifts': { level: 'tower', kind: 'number', expr: 't.main_lifts', label: 'Main lifts' },
};

export function psfExpr(rule) {
  switch (rule) {
    case 'calculated_first': return 'COALESCE(c.calc_psf, c.dev_psf)';
    case 'developer_only': return 'c.dev_psf';
    case 'calculated_only': return 'c.calc_psf';
    case 'developer_first': default: return 'COALESCE(c.dev_psf, c.calc_psf)';
  }
}

const ALIAS = { project: 'p', config: 'c', tower: 't' };
const ENTITY_OF = { project: 'project', config: 'configuration', tower: 'tower' };

/** Resolve a source key (static or custom-field based) into a descriptor. Returns null if invalid. */
export function resolveSource(sourceKey, meta) {
  if (SOURCES[sourceKey]) {
    const s = { ...SOURCES[sourceKey], key: sourceKey };
    if (s.expr === '__PSF__') s.expr = psfExpr(meta.settings.psf_display_rule);
    return s;
  }
  const m = /^(project|config|tower)\.attr\.([a-z][a-z0-9_]*)$/.exec(sourceKey || '');
  if (!m) return null;
  const [, level, key] = m;
  const fd = meta.fields.find((f) => f.entity === ENTITY_OF[level] && f.key === key && f.storage === 'attribute');
  if (!fd) return null;
  const a = ALIAS[level];
  // key is validated by regex above and exists in field_definitions, so it is safe to inline.
  switch (fd.data_type) {
    case 'number': case 'integer': case 'money': case 'area':
      return { key: sourceKey, level, kind: 'number', expr: `NULLIF(${a}.attributes->>'${key}','')::numeric`, label: fd.label, field: fd };
    case 'select':
      return { key: sourceKey, level, kind: 'ref', expr: `NULLIF(${a}.attributes->>'${key}','')::int`, options: `master:${fd.master_list_key}`, label: fd.label, field: fd };
    case 'multiselect':
      return { key: sourceKey, level, kind: 'refarray', expr: `${a}.attributes->'${key}'`, options: `master:${fd.master_list_key}`, label: fd.label, field: fd };
    case 'tristate':
      return { key: sourceKey, level, kind: 'enum', expr: `${a}.attributes->>'${key}'`, options: 'tristate', label: fd.label, field: fd };
    case 'boolean':
      return { key: sourceKey, level, kind: 'bool', expr: `(${a}.attributes->>'${key}')::boolean`, label: fd.label, field: fd };
    default:
      return null; // free text is not filterable
  }
}

/** All sources an admin can pick from (static + filterable custom fields). */
export function availableSources(meta) {
  const out = Object.entries(SOURCES).map(([key, s]) => ({ key, label: s.label, level: s.level, kind: s.kind }));
  for (const f of meta.fields.filter((x) => x.storage === 'attribute' && x.is_active)) {
    const level = { project: 'project', configuration: 'config', tower: 'tower' }[f.entity];
    const r = resolveSource(`${level}.attr.${f.key}`, meta);
    if (r) out.push({ key: r.key, label: `${f.label} (custom ${f.entity} field)`, level, kind: r.kind });
  }
  return out;
}
