/* editor.js — step-by-step project data entry (Admin + Editor). Steps come from data/fields.json. */
let DRAFT = null, STEP = 0;
const CFG_COLS = () => [
  { key: 'configuration', label: 'Configuration', type: 'select', options: () => sourceOptions('master:configurations') },
  { key: 'carpet_from', label: 'Carpet from', type: 'number' }, { key: 'carpet_to', label: 'Carpet to', type: 'number' },
  { key: 'price_from', label: 'Price from (₹)', type: 'number', width: 120 }, { key: 'price_to', label: 'Price to (₹)', type: 'number', width: 120 },
  { key: 'psf_developer', label: '₹/sq.ft. (dev)', type: 'number' }, { key: 'parking', label: 'Parking', type: 'text', width: 90 },
  { key: 'inventory_status', label: 'Inventory', type: 'select', options: () => sourceOptions('master:inventory_statuses') },
  { key: 'inventory_details', label: 'Inventory details', type: 'text' }, { key: 'remarks', label: 'Remarks', type: 'text' }];
const TOWER_FIELDS = [['total_towers', 'Total towers'], ['floors_above_ground', 'Floors (G+)'], ['habitable_from', 'Habitable from'],
  ['flats_per_floor', 'Flats / floor'], ['main_lifts', 'Main lifts'], ['service_lifts', 'Service lifts']];
const TOWER_COLS = () => [{ key: 'tower_name', label: 'Tower', type: 'text', width: 110 },
  { key: 'scope', label: 'Scope', type: 'select', options: () => sourceOptions('master:information_scopes') },
  ...TOWER_FIELDS.map(([key, label]) => ({ key, label, type: 'number', width: 70 })),
  { key: 'configurations', label: 'Configs (comma sep.)', type: 'array', width: 140 }, { key: 'remarks', label: 'Remarks', type: 'text' }];

function renderEditor(main, pid) {
  const key = 'pe_draft_' + (pid || 'new');
  const saved = LS.get(key, null);
  if (saved && confirm('A saved draft exists for this project. Continue the draft?\n(Cancel = start from current data)')) DRAFT = saved;
  else if (pid) {
    if (!IX.project[pid]) { main.innerHTML = '<p class="empty">Project not found</p>'; return; }
    DRAFT = { pid, project: clean(IX.project[pid]), configurations: clean(IX.configs[pid] || []), towers: clean(IX.towers[pid] || []) };
  } else DRAFT = { pid: null, project: { archived: false, coords_approx: false, last_updated: today() }, configurations: [], towers: [] };
  DRAFT.key = key; STEP = 0;
  drawEditor(main);
}
const autosave = () => LS.set(DRAFT.key, DRAFT);
const steps = () => [...DB.fields, { section: 'review', label: 'Review' }];

function drawEditor(main) {
  const st = steps(), s = st[STEP];
  main.innerHTML = `<div class="page editor">
    <div class="crumbs"><a href="#/dashboard">← Dashboard</a>${DRAFT.pid ? ` · <a href="#/project/${DRAFT.pid}">View project</a>` : ''}</div>
    <h1>${DRAFT.pid ? 'Edit: ' + esc(DRAFT.project.project_name) : 'Add project'}</h1>
    <ol class="steps">${st.map((x, i) => `<li class="${i === STEP ? 'on' : ''}" data-step="${i}">${i + 1}. ${esc(x.label)}</li>`).join('')}</ol>
    <div class="step-body" id="sb"></div>
    <div class="step-nav"><button class="btn ghost" id="prev" ${STEP ? '' : 'disabled'}>← Back</button>
      <span class="muted">Draft auto-saved in this browser</span>
      <button class="btn ghost" id="discard">Discard draft</button>
      ${STEP < st.length - 1 ? '<button class="btn primary" id="next">Next →</button>' : ''}</div></div>`;
  $$('.steps li', main).forEach(li => li.onclick = () => { STEP = +li.dataset.step; drawEditor(main); });
  $('#prev').onclick = () => { STEP--; drawEditor(main); };
  $('#next') && ($('#next').onclick = () => { STEP++; drawEditor(main); });
  $('#discard').onclick = () => { if (confirm('Discard this draft?')) { LS.del(DRAFT.key); location.hash = DRAFT.pid ? '#/project/' + DRAFT.pid : '#/dashboard'; } };
  const sb = $('#sb');
  if (s.special === 'configurations') return stepConfigs(sb);
  if (s.special === 'towers') return stepTowers(sb);
  if (s.section === 'review') return stepReview(sb);
  stepFields(sb, s);
}

function stepFields(el, s) {
  const p = DRAFT.project;
  el.innerHTML = `<div class="form">${s.fields.map(f => {
    const v = p[f.key], req = f.required ? ' <span class="req">*</span>' : '';
    let input;
    if (f.type === 'select') {
      let opts = sourceOptions(f.source);
      if (f.key === 'location_id' && p.city_id) opts = opts.filter(o => o.parent === p.city_id);
      input = `<select name="${f.key}"><option value="">— Not provided —</option>${opts.map(o => `<option value="${esc(o.value)}" ${String(v) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'list') input = `<textarea name="${f.key}" rows="4" placeholder="One point per line">${esc((v || []).join('\n'))}</textarea>`;
    else input = `<input name="${f.key}" type="${{ number: 'number', month: 'month', date: 'date' }[f.type] || 'text'}" step="any" value="${esc(v ?? '')}">`;
    return `<label class="${f.type === 'list' ? 'wide' : ''}">${esc(f.label)}${req}${input}</label>`;
  }).join('')}</div>${s.section === 'identity' ? '<div id="dups"></div>' : ''}`;
  el.oninput = el.onchange = e => {
    const f = s.fields.find(x => x.key === e.target.name); if (!f) return;
    let v = e.target.value;
    if (f.type === 'list') v = v.split('\n').map(x => x.trim()).filter(Boolean);
    else if (f.type === 'number') v = v === '' ? null : Number(v);
    else if (v === '') v = null;
    p[f.key] = v;
    if (f.key === 'lat' || f.key === 'lng') p.coords_approx = false;
    autosave();
    if (f.key === 'city_id' && e.type === 'change') { if (p.location_id && IX.loc[p.location_id]?.city_id !== v) p.location_id = null; stepFields(el, s); }
    if (s.section === 'identity') showDups();
  };
  if (s.section === 'identity') showDups();
}
function showDups() {
  const d = findDuplicates(DRAFT.project), el = $('#dups'); if (!el) return;
  el.innerHTML = d.length ? `<div class="alert warn"><b>Possible duplicate project${d.length > 1 ? 's' : ''}:</b> ${d.map(x => `${esc(x.project_id)} ${esc(x.project_name)} (${esc(devName(x.developer_id))}, ${esc(locName(x.location_id))})`).join('; ')}</div>` : '';
}

function stepConfigs(el) {
  el.innerHTML = `<p class="muted">One row per configuration variant. Use From/To for ranges; for a single value enter the same number in both (or leave "to" blank). Amounts in full rupees (₹1.2 Cr = 12000000).</p><div id="ct"></div>`;
  tableEditor($('#ct'), DRAFT.configurations, CFG_COLS(), { onChange: autosave, newRow: () => ({ inventory_status: 'Active Selling' }) });
}

function stepTowers(el) {
  el.innerHTML = `<div class="box"><h4>Same details across selected towers</h4>
    <p class="muted">Enter common values once, choose how many towers (or tick existing rows), then apply. Override individual towers in the table below.</p>
    <div class="form compact">${TOWER_FIELDS.map(([k, l]) => `<label>${l}<input type="number" data-common="${k}"></label>`).join('')}
    <label>Tower names / count<input id="tnames" placeholder="e.g. 5  or  A,B,C"></label></div>
    <button class="btn" id="gen">Create towers with these details</button>
    <button class="btn ghost" id="apply">Apply to ticked rows (blank fields are skipped)</button></div><div id="tt"></div>`;
  const tbl = tableEditor($('#tt'), DRAFT.towers, TOWER_COLS(), { selectable: true, onChange: autosave, newRow: () => ({ scope: 'Tower Specific', configurations: [] }) });
  const common = () => { const o = {}; $$('[data-common]', el).forEach(i => { if (i.value !== '') o[i.dataset.common] = Number(i.value); }); return o; };
  $('#gen').onclick = () => {
    const raw = $('#tnames').value.trim(); if (!raw) return alert('Enter a tower count or names');
    const names = /^\d+$/.test(raw) ? Array.from({ length: +raw }, (_, i) => 'Tower ' + (i + 1)) : raw.split(',').map(s => s.trim()).filter(Boolean);
    const c = common();
    names.forEach(n => DRAFT.towers.push({ tower_name: n, scope: 'Tower Specific', total_towers: c.total_towers ?? names.length, configurations: [], ...c }));
    tbl.redraw(); autosave();
  };
  $('#apply').onclick = () => {
    const c = common(), sel = DRAFT.towers.filter(t => t._sel);
    if (!sel.length) return alert('Tick the towers to update first');
    sel.forEach(t => Object.assign(t, c)); tbl.redraw(); autosave();
  };
}

function stepReview(el) {
  const p = DRAFT.project, issues = validateProject(p, DRAFT.configurations, DRAFT.towers), dups = findDuplicates(p);
  const errs = issues.filter(i => i.level === 'error');
  el.innerHTML = `<div class="review">
    <h3>Validation</h3>${issues.length ? `<ul class="issues">${issues.map(i => `<li class="${i.level}"><b>${i.level.toUpperCase()}</b> ${esc(i.msg)}</li>`).join('')}</ul>` : '<p class="ok">No issues found.</p>'}
    ${dups.length && !DRAFT.pid ? `<div class="alert warn"><b>Possible duplicates:</b> ${dups.map(d => esc(d.project_id + ' ' + d.project_name)).join(', ')}
      <label class="chk"><input type="checkbox" id="dupok"> This is a different project — create anyway</label></div>` : ''}
    <h3>Summary</h3><p>${esc(p.project_name || '(no name)')} · ${esc(devName(p.developer_id) || '')} · ${esc(locName(p.location_id) || '')} — ${DRAFT.configurations.length} configuration(s), ${DRAFT.towers.length} tower row(s)</p>
    <button class="btn primary" id="save" ${errs.length ? 'disabled' : ''}>${hasRole('Admin') ? 'Save to working copy' : 'Save & prepare submission'}</button>
    ${errs.length ? '<p class="err">Fix the errors above before saving.</p>' : ''}
    <p class="fine">Saving updates the data in this browser. To make it visible to everyone, ${hasRole('Admin') ? 'publish or export it from Admin → Publish.' : 'download the change file on the next screen and send it to the Admin.'}</p></div>`;
  $('#save').onclick = () => {
    if (dups.length && !DRAFT.pid && !$('#dupok')?.checked) return alert('Please confirm this is not a duplicate first.');
    const pid = saveDraft();
    location.hash = hasRole('Admin') ? '#/project/' + pid : '#/changes';
  };
}

/** Writes the draft into DB, with audit rows, and marks files as locally changed. */
function saveDraft() {
  const d = DRAFT, isNew = !d.pid;
  const pid = d.pid || 'P' + String(Math.max(0, ...DB.projects.map(p => +String(p.project_id).replace(/\D/g, '') || 0)) + 1).padStart(3, '0');
  const p = { ...d.project, project_id: pid, last_updated: today() };
  const before = IX.project[pid] ? clean(IX.project[pid]) : null;
  auditDiff(pid, 'project', before, p);
  if (before) DB.projects[DB.projects.indexOf(IX.project[pid])] = p; else DB.projects.push(p);

  const sync = (file, idKey, rows, mkId) => {
    const old = DB[file].filter(r => r.project_id === pid), keep = new Set();
    rows.forEach((r, i) => {
      delete r._sel; r.project_id = pid; if (!r[idKey]) r[idKey] = mkId(r, i);
      while (DB[file].some(x => x[idKey] === r[idKey] && x.project_id !== pid) || rows.some((y, j) => j < i && y[idKey] === r[idKey])) r[idKey] += 'x';
      keep.add(r[idKey]);
      auditDiff(pid, file.replace(/s$/, ''), old.find(o => o[idKey] === r[idKey]) || null, r);
    });
    old.filter(o => !keep.has(o[idKey])).forEach(o => audit(pid, 'delete ' + file.replace(/s$/, ''), idKey, o[idKey], null));
    DB[file] = DB[file].filter(r => r.project_id !== pid).concat(rows.map(r => clean(r)));
  };
  const code = v => DB['master-data'].configurations.find(c => c.value === v)?.code || 'X';
  sync('configurations', 'configuration_id', d.configurations, (r, i) => `${pid}_${code(r.configuration)}_${i + 1}`);
  sync('towers', 'tower_id', d.towers, (r, i) => `${pid}_T${i + 1}`);
  if (isNew) audit(pid, 'create project', 'project_name', null, p.project_name);
  saveLocal('projects', 'configurations', 'towers', 'audit-log');
  LS.del(d.key);
  return pid;
}
