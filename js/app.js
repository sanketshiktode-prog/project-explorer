/* app.js — boot + hash router.  Routes:
   #/login  #/dashboard  #/project/ID  #/new  #/edit/ID  #/changes  #/admin/<tab> */
const ROUTES = [
  { re: /^#\/login$/, roles: null, fn: m => renderLogin(m) },
  { re: /^#\/dashboard$/, roles: ['Admin', 'Editor', 'Sales'], fn: m => renderDashboard(m) },
  { re: /^#\/project\/(.+)$/, roles: ['Admin', 'Editor', 'Sales'], fn: (m, id) => renderProjectDetails(m, decodeURIComponent(id)) },
  { re: /^#\/new$/, roles: ['Admin', 'Editor'], fn: m => renderEditor(m, null) },
  { re: /^#\/edit\/(.+)$/, roles: ['Admin', 'Editor'], fn: (m, id) => renderEditor(m, decodeURIComponent(id)) },
  { re: /^#\/changes$/, roles: ['Admin', 'Editor'], fn: m => { m.innerHTML = '<div class="page"><h1>My changes</h1><div id="at"></div></div>'; renderPublish($('#at')); } },
  { re: /^#\/admin(?:\/(\w+))?$/, roles: ['Admin'], fn: (m, tab) => renderAdmin(m, tab) }
];

function route() {
  const h = location.hash || '#/dashboard', main = $('#main');
  const r = ROUTES.find(r => r.re.test(h));
  const u = currentUser();
  if (!r) { location.hash = '#/dashboard'; return; }
  if (r.roles && !u) { location.hash = '#/login'; return; }
  if (r.roles && !r.roles.includes(u.role)) { main.innerHTML = '<div class="page"><p class="empty">You do not have access to this page.</p><a href="#/dashboard">← Dashboard</a></div>'; header(); return; }
  header();
  window.scrollTo(0, 0);
  r.fn(main, ...h.match(r.re).slice(1));
}

function header() {
  const u = currentUser(), s = DB['master-data'].settings, n = localChanges().length;
  $('#hdr').innerHTML = `<a class="brand" href="#/dashboard"><b>${esc(s.app_title)}</b><span>${esc(s.region_label || '')}</span></a>
    ${u ? `<nav><a href="#/dashboard">Dashboard</a>${hasRole('Admin', 'Editor') ? '<a href="#/new">Add project</a>' : ''}
      ${hasRole('Editor') ? '<a href="#/changes">Submit changes</a>' : ''}${hasRole('Admin') ? '<a href="#/admin">Admin</a>' : ''}</nav>
      <div class="who">${esc(u.display_name)} <span class="tag">${esc(u.role)}</span> <button class="btn sm ghost" id="lo">Logout</button></div>` : ''}`;
  $('#lo') && ($('#lo').onclick = logout);
  $('#banner').innerHTML = u && n && hasRole('Admin', 'Editor') ? `<div class="banner">This browser has unpublished changes to ${n} data file${n > 1 ? 's' : ''} — other users cannot see them yet.
    <a href="${hasRole('Admin') ? '#/admin/publish' : '#/changes'}">${hasRole('Admin') ? 'Publish / export' : 'Submit changes'} →</a></div>` : '';
}

window.addEventListener('hashchange', route);
loadData().then(route).catch(e => {
  $('#main').innerHTML = `<div class="page"><p class="err">Could not load data: ${esc(e.message)}</p>
    <p>Open the site through a web server (GitHub Pages, or <code>python -m http.server</code> locally) — not by double-clicking index.html.</p></div>`;
});
