/* admin.js — users, projects, master data, filters, bands, data quality, audit, publish */
const ADMIN_TABS = { users: 'Users', projects: 'Projects', master: 'Master Data', filters: 'Filters', bands: 'Bands',
  quality: 'Data Quality', audit: 'Audit Log', publish: 'Publish / Export' };

function renderAdmin(main, tab = 'users') {
  main.innerHTML = `<div class="page admin"><h1>Admin</h1>
    <nav class="tabs">${Object.entries(ADMIN_TABS).map(([k, l]) => `<a href="#/admin/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div id="at"></div></div>`;
  ({ users: adminUsers, projects: adminProjects, master: adminMaster, filters: adminFilters, bands: adminBands,
     quality: adminQuality, audit: adminAudit, publish: renderPublish })[tab]?.($('#at'));
}
function saveBar(el, files, label = 'Save changes') {
  const b = document.createElement('div'); b.className = 'savebar';
  b.innerHTML = `<button class="btn primary">${label}</button> <span class="muted">Saves to this browser's working copy → publish/export from "Publish / Export".</span>`;
  b.querySelector('button').onclick = () => { saveLocal(...files); toast('Saved to working copy'); };
  el.appendChild(b);
}
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2500); }

/* ---------- users ---------- */
function adminUsers(el) {
  const roles = ['Admin', 'Editor', 'Sales'];
  el.innerHTML = `<div class="tbl-wrap"><table class="grid"><thead><tr><th>User ID</th><th>Display name</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>
    ${DB.users.map((u, i) => `<tr><td>${esc(u.user_id)}</td><td><input data-i="${i}" data-k="display_name" value="${esc(u.display_name)}"></td>
      <td><select data-i="${i}" data-k="role">${roles.map(r => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td><input type="checkbox" data-i="${i}" data-k="active" ${u.active !== false ? 'checked' : ''}></td>
      <td><button class="btn sm" data-pw="${i}">Reset password</button></td></tr>`).join('')}</tbody></table></div>
    <h3>Create user</h3><form id="nu" class="form compact">
      <label>User ID<input name="id" required pattern="[A-Za-z0-9._-]+"></label><label>Display name<input name="name" required></label>
      <label>Role<select name="role">${roles.map(r => `<option ${r === 'Sales' ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Password<input name="pw" type="text" required minlength="6"></label><button class="btn">Create user</button></form>`;
  el.onchange = e => {
    const t = e.target; if (t.dataset.i === undefined) return;
    const u = DB.users[+t.dataset.i], v = t.type === 'checkbox' ? t.checked : t.value;
    if (u.user_id === currentUser().user_id && (t.dataset.k === 'active' && !v || t.dataset.k === 'role' && v !== 'Admin')) { alert('You cannot disable or demote yourself.'); return adminUsers(el); }
    audit('-', 'update user', u.user_id + '.' + t.dataset.k, u[t.dataset.k], v); u[t.dataset.k] = v; saveLocal('users', 'audit-log'); toast('User updated');
  };
  $$('[data-pw]', el).forEach(b => b.onclick = async () => {
    const u = DB.users[+b.dataset.pw], pw = prompt('New password for ' + u.user_id + ' (min 6 chars):');
    if (!pw || pw.length < 6) return;
    u.salt = randomSalt(); u.hash = await hashPassword(pw, u.salt);
    audit('-', 'reset password', u.user_id, null, '(changed)'); saveLocal('users', 'audit-log'); toast('Password reset');
  });
  $('#nu').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    if (DB.users.some(u => u.user_id.toLowerCase() === f.id.value.toLowerCase())) return alert('User ID already exists');
    const salt = randomSalt();
    DB.users.push({ user_id: f.id.value, display_name: f.name.value, role: f.role.value, active: true, salt, hash: await hashPassword(f.pw.value, salt) });
    audit('-', 'create user', f.id.value, null, f.role.value); saveLocal('users', 'audit-log'); adminUsers(el); toast('User created');
  };
}

/* ---------- projects ---------- */
function adminProjects(el) {
  el.innerHTML = `<p><a class="btn primary" href="#/new">+ Add project</a></p><div class="tbl-wrap"><table class="grid"><thead><tr><th>ID</th><th>Project</th><th>Developer</th><th>Location</th>
    <th class="r">Configs</th><th class="r">Towers</th><th>Updated</th><th>Status</th><th></th></tr></thead><tbody>
    ${DB.projects.map(p => `<tr class="${p.archived ? 'dim' : ''}"><td>${esc(p.project_id)}</td><td><a href="#/project/${p.project_id}">${esc(p.project_name)}</a></td>
      <td>${esc(devName(p.developer_id))}</td><td>${esc(locName(p.location_id))}</td><td class="r">${(IX.configs[p.project_id] || []).length}</td>
      <td class="r">${(IX.towers[p.project_id] || []).length}</td><td>${val(p.last_updated)}</td><td>${p.archived ? 'Archived' : 'Live'}</td>
      <td><a class="btn sm" href="#/edit/${p.project_id}">Edit</a> <button class="btn sm ghost" data-arc="${p.project_id}">${p.archived ? 'Restore' : 'Archive'}</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $$('[data-arc]', el).forEach(b => b.onclick = () => {
    const p = IX.project[b.dataset.arc];
    audit(p.project_id, p.archived ? 'restore project' : 'archive project', 'archived', !!p.archived, !p.archived);
    p.archived = !p.archived; saveLocal('projects', 'audit-log'); adminProjects(el);
  });
}

/* ---------- master data (generic tables) ---------- */
function adminMaster(el) {
  const M = DB['master-data'];
  const lists = Object.keys(M).filter(k => Array.isArray(M[k]));
  el.innerHTML = `<h3>Settings</h3><div id="m_settings"></div>
    <h3>Developers</h3><div id="m_dev"></div><h3>Cities</h3><div id="m_city"></div><h3>Locations</h3><div id="m_loc"></div>
    ${lists.map(k => `<h3>${esc(k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()))}</h3><div id="m_${k}"></div>`).join('')}`;
  const sRows = Object.entries(M.settings).map(([k, v]) => ({ key: k, value: Array.isArray(v) ? v.join(',') : v }));
  tableEditor($('#m_settings'), sRows, [{ key: 'key', label: 'Setting', type: 'readonly' }, { key: 'value', label: 'Value', type: 'text', width: 220 }],
    { noAdd: true, noDelete: true, onChange: () => sRows.forEach(r => { const o = M.settings[r.key];
      M.settings[r.key] = Array.isArray(o) ? String(r.value).split(',').map(Number) : typeof o === 'number' ? Number(r.value) : r.value; }) });
  tableEditor($('#m_dev'), DB.developers, [{ key: 'developer_id', label: 'ID', type: 'text', width: 80 }, { key: 'name', label: 'Name', type: 'text', width: 200 }, { key: 'active', label: 'Active', type: 'checkbox' }],
    { newRow: () => ({ developer_id: 'DEV' + String(DB.developers.length + 1).padStart(3, '0'), name: '', active: true }) });
  tableEditor($('#m_city'), DB.locations.cities, [{ key: 'city_id', label: 'ID', type: 'text' }, { key: 'name', label: 'Name', type: 'text', width: 180 }, { key: 'active', label: 'Active', type: 'checkbox' }],
    { newRow: () => ({ city_id: '', name: '', active: true }) });
  tableEditor($('#m_loc'), DB.locations.locations, [{ key: 'location_id', label: 'ID', type: 'text' }, { key: 'name', label: 'Name', type: 'text' },
    { key: 'city_id', label: 'City', type: 'select', options: () => sourceOptions('cities') }, { key: 'lat', label: 'Lat', type: 'number' }, { key: 'lng', label: 'Lng', type: 'number' }, { key: 'active', label: 'Active', type: 'checkbox' }],
    { newRow: () => ({ location_id: '', name: '', city_id: null, lat: null, lng: null, active: true }) });
  lists.forEach(k => {
    const extra = Object.keys(M[k][0] || { value: 1 }).filter(c => !['value', 'active'].includes(c));
    tableEditor($('#m_' + k), M[k], [{ key: 'value', label: 'Value', type: 'text', width: 180 }, ...extra.map(c => ({ key: c, label: c, type: typeof M[k][0][c] === 'number' ? 'number' : 'text' })),
      { key: 'active', label: 'Active', type: 'checkbox' }], { newRow: () => ({ value: '', active: true, ...(extra.includes('order') ? { order: M[k].length + 1 } : {}) }) });
  });
  saveBar(el, ['master-data', 'developers', 'locations']);
}

/* ---------- filters ---------- */
function adminFilters(el) {
  DB.filters.sort((a, b) => a.order - b.order);
  el.innerHTML = `<p class="muted">Order, enable/disable and edit dashboard filters. <b>level</b> = project or configuration. <b>source</b>: cities, locations, developers, values, master:&lt;list&gt;, bands:&lt;kind&gt;.</p><div id="ft"></div>`;
  tableEditor($('#ft'), DB.filters, [
    { key: 'order', label: 'Order', type: 'number', width: 55 }, { key: 'active', label: 'Active', type: 'checkbox' },
    { key: 'key', label: 'Key', type: 'text', width: 110 }, { key: 'label', label: 'Display name', type: 'text' },
    { key: 'type', label: 'Type', type: 'select', options: ['select', 'range'] }, { key: 'level', label: 'Level', type: 'select', options: ['project', 'configuration'] },
    { key: 'field', label: 'Field', type: 'text', width: 120 }, { key: 'field_to', label: 'Field to', type: 'text', width: 90 },
    { key: 'source', label: 'Source', type: 'text', width: 150 }, { key: 'depends_on', label: 'Depends on', type: 'text', width: 90 },
    { key: 'multiple', label: 'Multi', type: 'checkbox' }, { key: 'min', label: 'Min', type: 'number', width: 90 }, { key: 'max', label: 'Max', type: 'number', width: 100 },
    { key: 'step', label: 'Step', type: 'number', width: 80 }, { key: 'unit', label: 'Unit', type: 'text', width: 60 },
    { key: 'bands', label: 'Bands', type: 'select', options: () => Object.keys(DB.bands) }],
    { newRow: () => ({ key: '', label: '', type: 'select', level: 'project', field: '', source: 'values', order: DB.filters.length + 1, active: true, multiple: true }) });
  saveBar(el, ['filters']);
}

/* ---------- bands ---------- */
function adminBands(el) {
  el.innerHTML = Object.keys(DB.bands).map(k => `<h3>${esc(k)} bands</h3><div id="b_${k}"></div>`).join('') +
    '<p class="muted">Leave Lower or Upper blank for an open-ended band. Prices in rupees, carpet in sq.ft., elevation in floors.</p>';
  Object.keys(DB.bands).forEach(k => tableEditor($('#b_' + k), DB.bands[k], [{ key: 'order', label: 'Order', type: 'number', width: 55 },
    { key: 'label', label: 'Band name', type: 'text', width: 180 }, { key: 'lower', label: 'Lower bound', type: 'number', width: 120 },
    { key: 'upper', label: 'Upper bound', type: 'number', width: 120 }, { key: 'active', label: 'Active', type: 'checkbox' }],
    { newRow: () => ({ label: '', lower: null, upper: null, order: DB.bands[k].length + 1, active: true }) }));
  saveBar(el, ['bands']);
}

/* ---------- data quality ---------- */
function adminQuality(el) {
  const rows = dataQualityReport(), c = l => rows.filter(r => r.level === l).length;
  el.innerHTML = `<div class="facts">${fact('Errors', c('error'))}${fact('Warnings', c('warning'))}${fact('Info', c('info'))}${fact('Projects checked', liveProjects().length)}</div>
    <div class="tbl-wrap"><table class="grid"><thead><tr><th>Level</th><th>Project</th><th>Issue</th><th></th></tr></thead><tbody>
    ${rows.sort((a, b) => ['error', 'warning', 'info'].indexOf(a.level) - ['error', 'warning', 'info'].indexOf(b.level)).map(r => `<tr class="${r.level}"><td><b>${r.level}</b></td>
      <td>${esc(r.p.project_id)} ${esc(r.p.project_name)}</td><td>${esc(r.msg)}</td><td>${IX.project[r.p.project_id] ? `<a href="#/edit/${r.p.project_id}">Fix</a>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

/* ---------- audit ---------- */
function adminAudit(el) {
  const log = [...DB['audit-log']].reverse();
  el.innerHTML = `<p class="fine">Prototype-level audit: records are written by the browser and stored in data/audit-log.json when published. It is not a tamper-proof, server-side audit log.</p>
    <input id="aq" placeholder="Filter by user / project / field…"><div class="tbl-wrap"><table class="grid" id="atbl"></table></div>`;
  const draw = q => { $('#atbl').innerHTML = `<thead><tr><th>Date / time</th><th>User</th><th>Project</th><th>Action</th><th>Field</th><th>Old value</th><th>New value</th></tr></thead><tbody>
    ${log.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q)).slice(0, 500).map(r => `<tr><td>${esc(new Date(r.ts).toLocaleString('en-IN'))}</td><td>${esc(r.user)}</td>
      <td>${esc(r.project_id)}</td><td>${esc(r.action)}</td><td>${esc(r.field)}</td><td class="trunc">${esc(JSON.stringify(r.old_value))}</td><td class="trunc">${esc(JSON.stringify(r.new_value))}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">No audit entries yet</td></tr>'}</tbody>`; };
  $('#aq').oninput = e => draw(e.target.value.toLowerCase()); draw('');
}

/* ---------- publish / export (Admin) and submit changes (Editor) ---------- */
function renderPublish(el) {
  const files = localChanges(), admin = hasRole('Admin');
  el.innerHTML = `<div class="page-narrow">
    <h3>${admin ? 'Unpublished changes in this browser' : 'Submit your changes'}</h3>
    ${files.length ? `<p>Changed files: ${files.map(f => `<code>data/${f}.json</code>`).join(', ')}</p>` : '<p class="muted">No local changes.</p>'}
    <div class="btnrow"><button class="btn primary" id="bundle" ${files.length ? '' : 'disabled'}>Download change file (.json)</button>
    ${admin ? files.map(f => `<button class="btn sm" data-dl="${f}">${f}.json</button>`).join('') : ''}</div>
    ${admin ? `<h3>Import a change file</h3><p class="muted">Apply a change file submitted by an Editor (replaces those data files in your working copy).</p><input type="file" id="imp" accept=".json">
    <h3>Publish straight to GitHub (optional)</h3>
    <p class="muted">Commits the changed files to your repo with the GitHub API. Needs a fine-grained personal access token with <i>Contents: Read and write</i> on this repo only. The token is kept in this tab only and never saved.</p>
    <form id="gh" class="form compact"><label>Owner<input name="owner" value="${esc(LS.get('pe_gh', {}).owner || '')}" required></label>
      <label>Repository<input name="repo" value="${esc(LS.get('pe_gh', {}).repo || '')}" required></label>
      <label>Branch<input name="branch" value="${esc(LS.get('pe_gh', {}).branch || 'main')}" required></label>
      <label>Token<input name="token" type="password" required></label><button class="btn primary" ${files.length ? '' : 'disabled'}>Commit to GitHub</button></form><div id="ghlog"></div>
    <h3>Discard</h3><button class="btn ghost" id="disc" ${files.length ? '' : 'disabled'}>Discard all local changes</button>` :
    `<p class="muted">Send the downloaded file to the Admin. They import it and publish it to GitHub.</p>`}</div>`;
  $('#bundle').onclick = () => {
    const out = { type: 'project-explorer-changes', by: currentUser().user_id, at: new Date().toISOString(), files: {} };
    files.forEach(f => out.files[f] = clean(DB[f]));
    download(`changes-${currentUser().user_id}-${today()}.json`, JSON.stringify(out, null, 2));
  };
  if (!admin) return;
  $$('[data-dl]', el).forEach(b => b.onclick = () => download(b.dataset.dl + '.json', fileText(b.dataset.dl)));
  $('#disc').onclick = () => { if (confirm('Discard all unpublished changes in this browser?')) { discardLocal(); location.reload(); } };
  $('#imp').onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      if (j.type !== 'project-explorer-changes') throw new Error('Not a change file');
      Object.entries(j.files).forEach(([f, v]) => { if (DATA_FILES.includes(f)) DB[f] = v; });
      saveLocal(...Object.keys(j.files).filter(f => DATA_FILES.includes(f)));
      toast('Imported changes from ' + j.by); renderPublish(el);
    } catch (x) { alert('Import failed: ' + x.message); }
  };
  $('#gh').onsubmit = async e => {
    e.preventDefault(); const f = e.target, log = $('#ghlog');
    LS.set('pe_gh', { owner: f.owner.value, repo: f.repo.value, branch: f.branch.value });
    const api = `https://api.github.com/repos/${f.owner.value}/${f.repo.value}/contents/data/`;
    const hd = { Authorization: 'Bearer ' + f.token.value, Accept: 'application/vnd.github+json' };
    log.innerHTML = '';
    for (const name of files) {
      try {
        const cur = await fetch(api + name + '.json?ref=' + encodeURIComponent(f.branch.value), { headers: hd });
        const sha = cur.ok ? (await cur.json()).sha : undefined;
        const body = { message: `Update ${name}.json via Project Explorer admin (${currentUser().user_id})`, branch: f.branch.value,
          content: btoa(unescape(encodeURIComponent(fileText(name)))), sha };
        const r = await fetch(api + name + '.json', { method: 'PUT', headers: hd, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).message || r.status);
        log.innerHTML += `<p class="ok">✓ ${name}.json committed</p>`;
        const local = LS.get('pe_local', {}); delete local[name]; LS.set('pe_local', local);
      } catch (x) { log.innerHTML += `<p class="err">✕ ${name}.json — ${esc(x.message)}</p>`; }
    }
    log.innerHTML += '<p class="muted">GitHub Pages usually updates within 1–2 minutes.</p>';
  };
}
