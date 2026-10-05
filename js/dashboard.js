/* dashboard.js — filters (left), map + matching projects (centre), project card (right) */
let MAP = null, MARKERS = {}, SELECTED = null, RESULTS = [];

function renderDashboard(main) {
  main.innerHTML = `<div class="dash">
    <aside class="filters" id="filters"></aside>
    <section class="centre">
      <div class="map-wrap"><div id="map"></div></div>
      <div class="results-head"><h2>Matching projects <span id="rcount" class="pill"></span></h2><span class="muted" id="fcount"></span></div>
      <div class="tbl-wrap"><table class="grid results" id="results"></table></div>
    </section>
    <aside class="card-panel" id="pcard"></aside></div>`;
  renderFilters($('#filters'), refresh);
  initMap();
  refresh();
}

function refresh() {
  RESULTS = applyFilters();
  const n = RESULTS.length, fc = activeFilterCount();
  $('#rcount').textContent = n;
  $('#fcount').textContent = fc ? fc + ' filter' + (fc > 1 ? 's' : '') + ' applied' : 'No filters applied';
  $('#results').innerHTML = `<thead><tr><th>Project</th><th>Developer</th><th>Location</th><th>Sub-location</th><th>Config.</th>
    <th class="r">Carpet (sq.ft.)</th><th class="r">Price</th><th class="r">₹/sq.ft.</th><th>Dev. Poss.</th></tr></thead>` +
    (n ? RESULTS.map(({ project: p, configs }) => {
      const rows = configs.length ? configs : [null], span = rows.length;
      return `<tbody class="pgroup ${SELECTED === p.project_id ? 'sel' : ''}" data-pid="${p.project_id}">` + rows.map((c, i) => `<tr>
        ${i === 0 ? `<td rowspan="${span}" class="pname">${esc(p.project_name)}${p.is_sample ? ' <span class="tag">sample</span>' : ''}</td>
          <td rowspan="${span}">${esc(devName(p.developer_id))}</td><td rowspan="${span}">${esc(locName(p.location_id))}</td>
          <td rowspan="${span}">${val(p.sub_location)}</td>` : ''}
        ${c ? `<td>${esc(c.configuration)}</td><td class="r">${fmtRange(c.carpet_from, c.carpet_to, fmtNum)}</td>
          <td class="r">${fmtRange(c.price_from, c.price_to, fmtPrice)}</td><td class="r">${fmtNum(psf(c))}</td>`
          : '<td colspan="4" class="na">No configurations provided</td>'}
        ${i === 0 ? `<td rowspan="${span}">${val(fmtMonth(p.developer_possession))}</td>` : ''}</tr>`).join('') + '</tbody>';
    }).join('') : '<tbody><tr><td colspan="9" class="empty">No projects match these filters. Try clearing one.</td></tr></tbody>');
  $$('#results tbody.pgroup').forEach(tb => tb.onclick = () => selectProject(tb.dataset.pid));
  if (SELECTED && !RESULTS.some(r => r.project.project_id === SELECTED)) SELECTED = null;
  if (!SELECTED && n) SELECTED = RESULTS[0].project.project_id;
  renderCard();
  drawMarkers();
}

function selectProject(pid, fromMap) {
  SELECTED = pid;
  $$('#results tbody.pgroup').forEach(tb => tb.classList.toggle('sel', tb.dataset.pid === pid));
  if (!fromMap) $(`#results tbody[data-pid="${pid}"]`)?.scrollIntoView({ block: 'nearest' });
  renderCard(); drawMarkers(pid);
}

/* ---------- compact project card ---------- */
function renderCard() {
  const el = $('#pcard');
  const r = RESULTS.find(r => r.project.project_id === SELECTED);
  if (!r) { el.innerHTML = '<div class="empty">Select a project to see its details.</div>'; return; }
  const p = r.project, all = IX.configs[p.project_id] || [], towers = IX.towers[p.project_id] || [];
  const shown = r.configs.length ? r.configs : all;
  el.innerHTML = `<div class="pc">
    <div class="pc-head"><div><h3>${esc(p.project_name)}</h3><div class="muted">${esc(devName(p.developer_id))}</div></div>
      <a class="btn sm" href="#/project/${p.project_id}">Detailed overview →</a></div>
    <dl class="kv">
      <dt>Location</dt><dd>${esc(locName(p.location_id))}, ${esc(cityName(p.city_id))}</dd>
      <dt>Sub-location</dt><dd>${val(p.sub_location)}</dd>
      <dt>Landmark</dt><dd>${val(p.landmark)}</dd>
      <dt>Dev. Possession</dt><dd>${val(fmtMonth(p.developer_possession))}</dd>
      <dt>RERA Possession</dt><dd>${val(fmtMonth(p.rera_possession))}</dd>
      <dt>Stage / Status</dt><dd>${val(p.launch_stage)} · ${val(p.project_status)}</dd>
    </dl>
    <h4>Configurations ${r.configs.length && r.configs.length < all.length ? `<span class="muted">(${r.configs.length} of ${all.length} match)</span>` : ''}</h4>
    ${configTable(shown, true)}
    <h4>Towers</h4>${towerSummary(towers)}
  </div>`;
}

function configTable(list, compact) {
  if (!list.length) return '<p class="na">No configurations provided</p>';
  return `<div class="tbl-wrap"><table class="grid"><thead><tr>${compact ? '' : '<th>Status</th>'}<th>Config.</th><th class="r">Carpet</th><th class="r">Price</th><th class="r">₹/sq.ft.</th>
    ${compact ? '' : '<th>Parking</th><th>Inventory details</th><th>Remarks</th>'}</tr></thead><tbody>
    ${list.map(c => `<tr>${compact ? '' : `<td>${val(c.inventory_status)}</td>`}<td>${esc(c.configuration)}</td>
      <td class="r">${fmtRange(c.carpet_from, c.carpet_to, fmtNum)}</td><td class="r">${fmtRange(c.price_from, c.price_to, fmtPrice)}</td>
      <td class="r">${fmtNum(psf(c))}</td>${compact ? '' : `<td>${val(c.parking)}</td><td>${val(c.inventory_details)}</td><td>${val(c.remarks)}</td>`}</tr>`).join('')}
    </tbody></table></div>`;
}

function towerSummary(towers, full) {
  if (!towers.length) return '<p class="na">No tower information provided</p>';
  const total = towers.find(t => isNum(t.total_towers))?.total_towers;
  const elev = [...new Set(towers.map(t => bandFor('elevation', t.floors_above_ground)).filter(Boolean))].join(', ');
  return `<p class="muted">${total ? total + ' tower' + (total > 1 ? 's' : '') + ' in project' : 'Tower count not provided'}${elev ? ' · ' + esc(elev) : ''}</p>
    <div class="tbl-wrap"><table class="grid"><thead><tr><th>Tower</th><th>Scope</th><th class="r">Floors (G+)</th><th class="r">Habitable from</th><th class="r">Flats/floor</th>
    <th class="r">Lifts</th>${full ? '<th>Configurations</th><th>Remarks</th>' : ''}</tr></thead><tbody>
    ${towers.map(t => `<tr><td>${val(t.tower_name ?? (t.scope === 'Project Level' ? 'All towers' : null))}</td><td>${val(t.scope)}</td>
      <td class="r">${val(t.floors_above_ground)}</td><td class="r">${val(t.habitable_from)}</td><td class="r">${val(t.flats_per_floor)}</td>
      <td class="r">${isNum(t.main_lifts) || isNum(t.service_lifts) ? `${t.main_lifts ?? '—'} main${isNum(t.service_lifts) ? ' + ' + t.service_lifts + ' service' : ''}` : val(null)}</td>
      ${full ? `<td>${val(t.configurations?.join(', '))}</td><td>${val(t.remarks)}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}

/* ---------- map (Leaflet + OpenStreetMap, no API key) ---------- */
function initMap() {
  MAP = null; MARKERS = {};
  if (typeof L === 'undefined') { $('#map').innerHTML = '<div class="empty">Map library could not load (offline?). Everything else works.</div>'; return; }
  const s = DB['master-data'].settings;
  MAP = L.map('map', { scrollWheelZoom: false }).setView(s.map_center || [19.0, 73.07], s.map_zoom || 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(MAP);
}
function drawMarkers(focus) {
  if (!MAP) return;
  Object.values(MARKERS).forEach(m => m.remove()); MARKERS = {};
  const pts = [];
  RESULTS.forEach(({ project: p }) => {
    if (!isNum(p._lat) || !isNum(p._lng)) return;
    const sel = p.project_id === SELECTED;
    const m = L.circleMarker([p._lat, p._lng], { radius: sel ? 11 : 7, weight: 2, color: '#fff',
      fillColor: sel ? '#e8590c' : '#1c3d6e', fillOpacity: 0.95 }).addTo(MAP);
    m.bindTooltip(esc(p.project_name) + (p._approx ? ' <i>(approx.)</i>' : ''), { direction: 'top' });
    m.on('click', () => selectProject(p.project_id, true));
    MARKERS[p.project_id] = m; pts.push([p._lat, p._lng]);
    if (sel) m.bringToFront();
  });
  if (focus && MARKERS[focus]) MAP.panTo(MARKERS[focus].getLatLng());
  else if (pts.length) MAP.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
}
