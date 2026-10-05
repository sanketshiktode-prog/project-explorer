/* utils.js — data loading, local working copy, formatting, small helpers */
const DATA_FILES = ['projects', 'configurations', 'towers', 'developers', 'locations',
  'master-data', 'filters', 'bands', 'fields', 'users', 'audit-log'];
const DB = {};      // raw data, one key per file
const IX = {};      // indexes built from DB

/* ---------- safe browser storage ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

/* ---------- load ---------- */
async function loadData() {
  const local = LS.get('pe_local', {});
  await Promise.all(DATA_FILES.map(async f => {
    const r = await fetch('data/' + f + '.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('Cannot load data/' + f + '.json');
    DB[f] = local[f] !== undefined ? local[f] : await r.json();
  }));
  buildIndex();
}
function localChanges() { return Object.keys(LS.get('pe_local', {})); }
/** Mark data files as changed in this browser (working copy until exported/published). */
function saveLocal(...files) {
  const local = LS.get('pe_local', {});
  files.forEach(f => { local[f] = clean(DB[f]); });
  if (!LS.set('pe_local', local)) alert('Browser storage unavailable — changes will be lost on reload. Export them now.');
  buildIndex();
}
function discardLocal() { LS.del('pe_local'); }
/** Strip computed keys (starting with "_") before saving/exporting. */
function clean(obj) { return JSON.parse(JSON.stringify(obj, (k, v) => k.startsWith('_') ? undefined : v)); }
function fileText(name) { return JSON.stringify(clean(DB[name]), null, 2) + '\n'; }

/* ---------- indexes & derived fields ---------- */
function buildIndex() {
  const M = DB['master-data'];
  IX.dev = byKey(DB.developers, 'developer_id');
  IX.city = byKey(DB.locations.cities, 'city_id');
  IX.loc = byKey(DB.locations.locations, 'location_id');
  IX.project = byKey(DB.projects, 'project_id');
  IX.configs = groupBy(DB.configurations, 'project_id');
  IX.towers = groupBy(DB.towers, 'project_id');
  const cfgOrder = {}; (M.configurations || []).forEach(c => cfgOrder[c.value] = c.order);
  Object.values(IX.configs).forEach(list => list.sort((a, b) =>
    (cfgOrder[a.configuration] ?? 99) - (cfgOrder[b.configuration] ?? 99) || (a.price_from ?? 0) - (b.price_from ?? 0)));
  DB.projects.forEach(p => {
    p._dev_year = yearOf(p.developer_possession);
    p._rera_year = yearOf(p.rera_possession);
    const floors = (IX.towers[p.project_id] || []).map(t => t.floors_above_ground).filter(isNum);
    p._elevation = [...new Set(floors.map(f => bandFor('elevation', f)).filter(Boolean))];
    const loc = IX.loc[p.location_id] || {};
    p._lat = isNum(p.lat) ? p.lat : loc.lat; p._lng = isNum(p.lng) ? p.lng : loc.lng;
    p._approx = !isNum(p.lat) || p.coords_approx;
  });
}
function byKey(arr, k) { const o = {}; (arr || []).forEach(x => o[x[k]] = x); return o; }
function groupBy(arr, k) { const o = {}; (arr || []).forEach(x => (o[x[k]] = o[x[k]] || []).push(x)); return o; }
function isNum(v) { return typeof v === 'number' && !isNaN(v); }
function yearOf(m) { return m ? parseInt(String(m).slice(0, 4), 10) : null; }
function activeSorted(list) { return (list || []).filter(x => x.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
function bandFor(kind, v) {
  const b = activeSorted(DB.bands[kind]).find(b => (b.lower == null || v >= b.lower) && (b.upper == null || v <= b.upper));
  return b ? b.label : null;
}

/** Options for a "source" string used by filters and forms. Returns [{value,label,parent}] */
function sourceOptions(src, field) {
  if (src === 'cities') return activeSorted(DB.locations.cities).map(c => ({ value: c.city_id, label: c.name }));
  if (src === 'locations') return activeSorted(DB.locations.locations).sort((a, b) => a.name.localeCompare(b.name))
    .map(l => ({ value: l.location_id, label: l.name, parent: l.city_id }));
  if (src === 'developers') return activeSorted(DB.developers).sort((a, b) => a.name.localeCompare(b.name))
    .map(d => ({ value: d.developer_id, label: d.name }));
  if (src.startsWith('master:')) return activeSorted(DB['master-data'][src.slice(7)]).map(x => ({ value: x.value, label: x.value }));
  if (src.startsWith('bands:')) return activeSorted(DB.bands[src.slice(6)]).map(x => ({ value: x.label, label: x.label }));
  if (src === 'values') {           // distinct values found in project data
    const seen = {};
    liveProjects().forEach(p => { const v = p[field]; if (v != null && v !== '') seen[v] = p; });
    return Object.keys(seen).sort().map(v => ({ value: v, label: v, project: seen[v] }));
  }
  return [];
}
function liveProjects() { return DB.projects.filter(p => !p.archived); }

/* ---------- display helpers ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
/** Blank is never zero: null/'' -> Not Provided; "N/A" -> Not Applicable; "Unknown"; false -> No */
function val(v, fmt) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '<span class="na">Not Provided</span>';
  if (v === 'N/A') return '<span class="na">Not Applicable</span>';
  if (v === 'Unknown') return '<span class="na">Unknown</span>';
  if (v === false) return 'No';
  return fmt ? fmt(v) : esc(v);
}
function fmtPrice(n) {
  if (!isNum(n)) return '—';
  return n >= 1e7 ? '₹' + +(n / 1e7).toFixed(2) + ' Cr' : '₹' + +(n / 1e5).toFixed(1) + ' L';
}
function fmtNum(n) { return isNum(n) ? Math.round(n).toLocaleString('en-IN') : '—'; }
function fmtRange(a, b, f) { if (!isNum(a) && !isNum(b)) return '—'; if (!isNum(b) || a === b) return f(a); if (!isNum(a)) return f(b); return f(a) + ' – ' + f(b); }
function fmtMonth(m) {
  if (!m) return null;
  const [y, mo] = String(m).split('-'); const d = new Date(+y, (+mo || 1) - 1, 1);
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}
function psf(c) {
  if (isNum(c.psf_developer)) return c.psf_developer;
  return isNum(c.price_from) && isNum(c.carpet_from) && c.carpet_from > 0 ? c.price_from / c.carpet_from : null;
}
function fmtUnit(v, unit) {
  if (!isNum(v)) return '—';
  if (unit === 'INR') return fmtPrice(v);
  if (unit === 'year') return String(v);
  return fmtNum(v) + ' ' + (unit || '');
}
function listHtml(arr) { return Array.isArray(arr) && arr.length ? '<ul class="bul">' + arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : val(null); }
function devName(id) { return IX.dev[id]?.name ?? id; }
function locName(id) { return IX.loc[id]?.name ?? id; }
function cityName(id) { return IX.city[id]?.name ?? id; }
function $(s, r = document) { return r.querySelector(s); }
function $$(s, r = document) { return [...r.querySelectorAll(s)]; }
function today() { return new Date().toISOString().slice(0, 10); }
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
function norm(s) { return String(s || '').toLowerCase().replace(/\[sample\]/g, '').replace(/[^a-z0-9]/g, ''); }

/* ---------- audit (prototype-level, stored in data/audit-log.json) ---------- */
function audit(projectId, action, field, oldV, newV) {
  DB['audit-log'].push({ ts: new Date().toISOString(), user: currentUser()?.user_id || 'unknown',
    project_id: projectId, action, field, old_value: oldV ?? null, new_value: newV ?? null });
}
/** Diff two plain objects and write one audit row per changed field. */
function auditDiff(projectId, entity, before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  keys.forEach(k => {
    if (k.startsWith('_')) return;
    const a = JSON.stringify(before?.[k] ?? null), b = JSON.stringify(after?.[k] ?? null);
    if (a !== b) audit(projectId, before ? 'update ' + entity : 'create ' + entity, k, before?.[k], after?.[k]);
  });
}

/* ---------- prototype password hashing (PBKDF2 / SHA-256, browser Web Crypto) ---------- */
async function hashPassword(pw, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomSalt() { return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); }

/* ---------- generic editable table (used by editor + admin) ----------
   cols: [{key,label,type:'text'|'number'|'select'|'checkbox'|'month', options:[...] , width}] */
function tableEditor(el, rows, cols, opts = {}) {
  const draw = () => {
    el.innerHTML = `<div class="tbl-wrap"><table class="grid edit"><thead><tr>${opts.selectable ? '<th><input type="checkbox" data-all></th>' : ''}
      ${cols.map(c => `<th>${esc(c.label)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr>${opts.selectable ? `<td><input type="checkbox" data-sel="${i}" ${r._sel ? 'checked' : ''}></td>` : ''}
        ${cols.map(c => `<td>${cell(c, r[c.key], i)}</td>`).join('')}
        <td>${opts.noDelete ? '' : `<button class="btn sm ghost" data-del="${i}" title="Remove">✕</button>`}</td></tr>`).join('')}
      </tbody></table></div>${opts.noAdd ? '' : '<button class="btn sm" data-add>+ Add row</button>'}`;
  };
  const cell = (c, v, i) => {
    const a = `data-r="${i}" data-k="${c.key}"`;
    if (c.type === 'checkbox') return `<input type="checkbox" ${a} ${v !== false ? 'checked' : ''}>`;
    if (c.type === 'select') {
      const o = typeof c.options === 'function' ? c.options() : c.options;
      return `<select ${a}><option value=""></option>${o.map(x => { const ov = x.value ?? x, ol = x.label ?? x;
        return `<option value="${esc(ov)}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
    }
    if (c.type === 'readonly') return esc(v ?? '');
    const shown = Array.isArray(v) ? v.join(', ') : (v ?? '');
    return `<input ${a} type="${c.type === 'number' ? 'number' : c.type === 'month' ? 'month' : 'text'}" value="${esc(shown)}" style="width:${c.width || (c.type === 'number' ? 90 : 140)}px">`;
  };
  el.oninput = el.onchange = e => {
    const t = e.target;
    if (t.dataset.all !== undefined) { rows.forEach(r => r._sel = t.checked); draw(); return; }
    if (t.dataset.sel !== undefined) { rows[+t.dataset.sel]._sel = t.checked; return; }
    if (t.dataset.r === undefined) return;
    const c = cols.find(c => c.key === t.dataset.k), r = rows[+t.dataset.r];
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (c.type === 'number') v = v === '' ? null : Number(v);
    else if (c.type === 'array') v = v.split(',').map(s => s.trim()).filter(Boolean);
    else if (v === '') v = null;
    r[c.key] = v;
    opts.onChange && opts.onChange(r, c.key);
  };
  el.onclick = e => {
    const t = e.target;
    if (t.dataset.add !== undefined) { rows.push(opts.newRow ? opts.newRow() : {}); draw(); opts.onChange && opts.onChange(); }
    if (t.dataset.del !== undefined && confirm('Remove this row?')) { rows.splice(+t.dataset.del, 1); draw(); opts.onChange && opts.onChange(); }
  };
  draw();
  return { redraw: draw };
}
