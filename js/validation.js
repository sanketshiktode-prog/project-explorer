/* validation.js — record validation, duplicate detection, data-quality report */
function validateProject(p, configs = [], towers = []) {
  const out = [], E = m => out.push({ level: 'error', msg: m }), W = m => out.push({ level: 'warning', msg: m }), I = m => out.push({ level: 'info', msg: m });
  const blank = v => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  if (blank(p.project_name)) E('Missing project name');
  if (blank(p.developer_id)) E('Missing developer'); else if (!IX.dev[p.developer_id]) E('Developer not in master data: ' + p.developer_id);
  if (blank(p.city_id)) E('Missing city'); else if (!IX.city[p.city_id]) E('City not in master data: ' + p.city_id);
  if (blank(p.location_id)) E('Missing location'); else if (!IX.loc[p.location_id]) E('Location not in master data: ' + p.location_id);
  else if (p.city_id && IX.loc[p.location_id].city_id !== p.city_id) E('Location ' + locName(p.location_id) + ' does not belong to city ' + cityName(p.city_id));
  const cfgNames = new Set(DB['master-data'].configurations.map(c => c.value));
  configs.forEach((c, i) => {
    const n = `Configuration ${i + 1} (${c.configuration || '?'})`;
    if (blank(c.configuration)) E(n + ': missing configuration type');
    else if (!cfgNames.has(c.configuration)) W(n + ': not in master configuration list');
    if (isNum(c.price_from) && isNum(c.price_to) && c.price_from > c.price_to) E(n + ': Price From is greater than Price To');
    if (isNum(c.carpet_from) && isNum(c.carpet_to) && c.carpet_from > c.carpet_to) E(n + ': Carpet From is greater than Carpet To');
    if ([c.price_from, c.price_to, c.carpet_from, c.carpet_to].some(v => isNum(v) && v < 0)) E(n + ': negative number');
    if (!isNum(c.price_from) && !isNum(c.price_to)) W(n + ': missing price');
    if (!isNum(c.carpet_from) && !isNum(c.carpet_to)) W(n + ': missing carpet area');
  });
  towers.forEach((t, i) => {
    const n = `Tower ${t.tower_name || i + 1}`;
    if (isNum(t.habitable_from) && isNum(t.floors_above_ground) && t.habitable_from > t.floors_above_ground) E(n + ': habitable floor is above total floors');
    if (isNum(t.total_towers) && t.total_towers < 1) E(n + ': total towers must be at least 1');
  });
  if (p.launch_date && p.rera_possession && p.rera_possession < p.launch_date) W('RERA possession is earlier than launch date');
  if (p.developer_possession && p.rera_possession && p.developer_possession > p.rera_possession) W('Developer possession is later than RERA possession');
  if (!configs.length) W('No configurations');
  if (!towers.length) W('No tower information');
  if (!p.developer_possession && !p.rera_possession) W('Missing possession dates');
  if (!isNum(p.lat) || !isNum(p.lng)) W('Missing coordinates (map uses location centre)');
  DB.fields.flatMap(s => s.fields || []).filter(f => f.recommended && blank(p[f.key])).forEach(f => I('Missing optional ' + f.label));
  return out;
}

/** Possible duplicates: same developer + location + similar name, or identical normalised name. */
function findDuplicates(p) {
  const n = norm(p.project_name);
  if (!n) return [];
  return DB.projects.filter(x => x.project_id !== p.project_id).filter(x => {
    const m = norm(x.project_name);
    const similar = m === n || (n.length > 3 && (m.includes(n) || n.includes(m)));
    return similar && (m === n || (x.developer_id === p.developer_id && (x.location_id === p.location_id || x.city_id === p.city_id)));
  });
}

function dataQualityReport() {
  const stale = DB['master-data'].settings.stale_after_days || 60, rows = [];
  DB.projects.forEach(p => {
    if (p.archived) return;
    validateProject(p, IX.configs[p.project_id] || [], IX.towers[p.project_id] || []).forEach(r => rows.push({ p, ...r }));
    findDuplicates(p).filter(d => d.project_id > p.project_id)
      .forEach(d => rows.push({ p, level: 'warning', msg: 'Possible duplicate of ' + d.project_id + ' ' + d.project_name }));
    const age = p.last_updated ? (Date.now() - new Date(p.last_updated)) / 864e5 : Infinity;
    if (age > stale) rows.push({ p, level: 'warning', msg: p.last_updated ? `Stale: last updated ${p.last_updated} (> ${stale} days)` : 'Last updated date missing' });
  });
  DB.configurations.filter(c => !IX.project[c.project_id]).forEach(c => rows.push({ p: { project_id: c.project_id, project_name: '?' }, level: 'error', msg: 'Configuration ' + c.configuration_id + ' points to unknown project' }));
  DB.towers.filter(t => !IX.project[t.project_id]).forEach(t => rows.push({ p: { project_id: t.project_id, project_name: '?' }, level: 'error', msg: 'Tower ' + t.tower_id + ' points to unknown project' }));
  const ids = {}; [...DB.configurations.map(c => c.configuration_id), ...DB.towers.map(t => t.tower_id)].forEach(id => ids[id] = (ids[id] || 0) + 1);
  Object.entries(ids).filter(([, n]) => n > 1).forEach(([id]) => rows.push({ p: { project_id: id.split('_')[0], project_name: '' }, level: 'error', msg: 'Duplicate ID ' + id }));
  return rows;
}
