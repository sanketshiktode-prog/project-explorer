/* filters.js — builds the filter panel from data/filters.json and applies it.
   Project-level filters test the project; configuration-level filters must ALL be
   satisfied by the SAME configuration row (so "3 BHK + ₹1–1.3 Cr" never matches a
   project whose 3 BHK costs ₹1.5 Cr just because its 2 BHK is ₹1 Cr). */
const FS = { sel: {}, range: {}, bands: {}, q: '' };   // filter state

function activeFilters() { return activeSorted(DB.filters); }

function renderFilters(el, onChange) {
  const html = activeFilters().map(f => {
    if (f.type === 'range') return rangeHtml(f);
    return selectHtml(f);
  }).join('');
  el.innerHTML = `<div class="fhead"><input id="fq" type="search" placeholder="Search project / developer…" value="${esc(FS.q)}">
    <button class="btn sm ghost" id="fclear">Clear all</button></div>${html}`;
  $('#fq', el).oninput = e => { FS.q = e.target.value; onChange(); };
  $('#fclear', el).onclick = () => { clearFilters(); renderFilters(el, onChange); onChange(); };
  $$('[data-f]', el).forEach(inp => inp.onchange = () => {
    const f = DB.filters.find(x => x.key === inp.dataset.f);
    const s = FS.sel[f.key] = FS.sel[f.key] || new Set();
    inp.checked ? s.add(inp.value) : s.delete(inp.value);
    if (!f.multiple && inp.checked) { s.clear(); s.add(inp.value); }
    // dependent filters: drop selections that are no longer valid
    activeFilters().filter(d => d.depends_on === f.key).forEach(d => {
      const ok = new Set(optionsFor(d).map(o => String(o.value)));
      FS.sel[d.key] && [...FS.sel[d.key]].forEach(v => ok.has(v) || FS.sel[d.key].delete(v));
    });
    renderFilters(el, onChange); onChange();
  });
  $$('[data-rg]', el).forEach(inp => inp.oninput = () => {
    const f = DB.filters.find(x => x.key === inp.dataset.rg);
    const [lo, hi] = $$(`[data-rg="${f.key}"]`, el).map(i => +i.value);
    FS.range[f.key] = [Math.min(lo, hi), Math.max(lo, hi)];
    $(`#rv_${f.key}`, el).textContent = rangeLabel(f);
    onChange();
  });
  $$('[data-band]', el).forEach(b => b.onclick = () => {
    const k = b.dataset.band, s = FS.bands[k] = FS.bands[k] || new Set();
    s.has(b.dataset.v) ? s.delete(b.dataset.v) : s.add(b.dataset.v);
    b.classList.toggle('on'); onChange();
  });
  $$('details.fgroup', el).forEach(d => d.ontoggle = () => LS.set('pe_open_' + d.dataset.k, d.open));
}

function optionsFor(f) {
  let opts = sourceOptions(f.source, f.field);
  const parent = f.depends_on && FS.sel[f.depends_on];
  if (parent && parent.size) {
    const pf = DB.filters.find(x => x.key === f.depends_on);
    opts = opts.filter(o => o.parent !== undefined ? parent.has(String(o.parent))
      : o.project ? liveProjects().some(p => String(p[f.field]) === String(o.value) && parent.has(String(p[pf.field]))) : true);
  }
  return opts;
}

function selectHtml(f) {
  const s = FS.sel[f.key] || new Set(), opts = optionsFor(f);
  const open = LS.get('pe_open_' + f.key, s.size > 0 || f.order <= 5);
  return `<details class="fgroup" data-k="${f.key}" ${open ? 'open' : ''}><summary>${esc(f.label)}${s.size ? ` <span class="cnt">${s.size}</span>` : ''}</summary>
    <div class="opts">${opts.length ? opts.map(o => `<label class="chk"><input type="checkbox" data-f="${f.key}" value="${esc(o.value)}" ${s.has(String(o.value)) ? 'checked' : ''}>${esc(o.label)}</label>`).join('')
      : '<span class="na">No options</span>'}</div></details>`;
}

function rangeHtml(f) {
  const [lo, hi] = FS.range[f.key] || [f.min, f.max];
  const bands = f.bands ? activeSorted(DB.bands[f.bands]) : [];
  const bs = FS.bands[f.key] || new Set();
  const open = LS.get('pe_open_' + f.key, true);
  return `<details class="fgroup" data-k="${f.key}" ${open ? 'open' : ''}><summary>${esc(f.label)} <span class="rv" id="rv_${f.key}">${rangeLabel(f)}</span></summary>
    <div class="range"><input type="range" data-rg="${f.key}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${lo}">
    <input type="range" data-rg="${f.key}" min="${f.min}" max="${f.max}" step="${f.step || 1}" value="${hi}"></div>
    ${bands.length ? `<div class="bands">${bands.map(b => `<button class="chip ${bs.has(b.label) ? 'on' : ''}" data-band="${f.key}" data-v="${esc(b.label)}">${esc(b.label)}</button>`).join('')}</div>` : ''}
  </details>`;
}
function rangeLabel(f) {
  const [lo, hi] = FS.range[f.key] || [f.min, f.max];
  if (lo <= f.min && hi >= f.max) return 'Any';
  return (lo <= f.min ? 'Up to ' : fmtUnit(lo, f.unit) + ' – ') + (hi >= f.max ? '' : fmtUnit(hi, f.unit)) + (hi >= f.max ? ' & above' : '');
}
/** Returns [lo, hi] as an effective numeric interval or null if the slider is at full extent. */
function rangeBounds(f) {
  const r = FS.range[f.key]; if (!r) return null;
  const lo = r[0] <= f.min ? -Infinity : r[0], hi = r[1] >= f.max ? Infinity : r[1];
  return lo === -Infinity && hi === Infinity ? null : [lo, hi];
}
function clearFilters() { FS.sel = {}; FS.range = {}; FS.bands = {}; FS.q = ''; }
function activeFilterCount() {
  return activeFilters().filter(f => (FS.sel[f.key]?.size) || rangeBounds(f) || FS.bands[f.key]?.size).length + (FS.q ? 1 : 0);
}

/* ---------- matching ---------- */
const overlaps = (a, b, lo, hi) => a <= hi && b >= lo;

function testValue(f, v) {                // project-level or config-level single test
  if (f.type === 'select') {
    const s = FS.sel[f.key]; if (!s || !s.size) return true;
    const want = new Set(s);
    s.forEach(x => (f.also_matches?.[x] || []).forEach(y => want.add(y)));
    const vals = Array.isArray(v) ? v : [v];
    return vals.some(x => x != null && want.has(String(x)));
  }
  return true;
}
function testRange(f, a, b) {              // a..b is the record's interval
  const r = rangeBounds(f), bs = FS.bands[f.key];
  if (!r && !(bs && bs.size)) return true;
  if (!isNum(a) && !isNum(b)) return false;          // unknown never matches a narrowed range
  a = isNum(a) ? a : b; b = isNum(b) ? b : a;
  if (r && !overlaps(a, b, r[0], r[1])) return false;
  if (bs && bs.size) {
    return activeSorted(DB.bands[f.bands]).filter(x => bs.has(x.label))
      .some(x => overlaps(a, b, x.lower ?? -Infinity, x.upper ?? Infinity));
  }
  return true;
}

/** Returns [{project, configs:[matching configs]}] */
function applyFilters() {
  const fl = activeFilters(), pf = fl.filter(f => f.level !== 'configuration'), cf = fl.filter(f => f.level === 'configuration');
  const cfActive = cf.some(f => FS.sel[f.key]?.size || rangeBounds(f) || FS.bands[f.key]?.size);
  const q = norm(FS.q);
  const out = [];
  liveProjects().forEach(p => {
    if (q && !norm(p.project_name + devName(p.developer_id) + locName(p.location_id) + (p.sub_location || '')).includes(q)) return;
    for (const f of pf) {
      if (f.type === 'range' ? !testRange(f, p[f.field], p[f.field]) : !testValue(f, p[f.field])) return;
    }
    const all = IX.configs[p.project_id] || [];
    const configs = all.filter(c => cf.every(f => f.type === 'range' ? testRange(f, c[f.field], c[f.field_to || f.field]) : testValue(f, c[f.field])));
    if (cfActive && !configs.length) return;
    out.push({ project: p, configs });
  });
  return out.sort((a, b) => (a.project.is_sample - b.project.is_sample) || a.project.project_name.localeCompare(b.project.project_name));
}
