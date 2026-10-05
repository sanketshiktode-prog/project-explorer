/* project-details.js — Detailed Overview page, driven by data/fields.json sections */
function renderProjectDetails(main, pid) {
  const p = IX.project[pid];
  if (!p) { main.innerHTML = `<div class="page"><p class="empty">Project ${esc(pid)} not found.</p><a href="#/dashboard">← Back</a></div>`; return; }
  const configs = IX.configs[pid] || [], towers = IX.towers[pid] || [];
  const canEdit = hasRole('Admin', 'Editor');
  const prices = configs.flatMap(c => [c.price_from, c.price_to]).filter(isNum);
  const carpets = configs.flatMap(c => [c.carpet_from, c.carpet_to]).filter(isNum);
  const types = [...new Set(configs.map(c => c.configuration))];

  const section = s => {
    if (s.special === 'configurations') return block(s, configTable(configs, false));
    if (s.special === 'towers') return block(s, towerSummary(towers, true));
    if (s.section === 'identity') return '';
    const fields = s.fields.filter(f => !f.hide_in_overview && (!f.internal || canEdit));
    const lists = fields.filter(f => f.type === 'list'), simple = fields.filter(f => f.type !== 'list');
    const body = (simple.length ? `<dl class="kv grid2">${simple.map(f => `<dt>${esc(f.label)}</dt><dd>${fieldVal(f, p[f.key])}</dd>`).join('')}</dl>` : '') +
      lists.map(f => `<div class="sub"><h4>${esc(f.label)}</h4>${listHtml(p[f.key])}</div>`).join('');
    return block(s, body);
  };
  const block = (s, body) => `<details class="sec" open><summary>${esc(s.label)}</summary><div class="sec-body">${body}</div></details>`;

  main.innerHTML = `<div class="page details">
    <div class="crumbs"><a href="#/dashboard">← Dashboard</a>${canEdit ? ` · <a href="#/edit/${pid}">Edit project</a>` : ''}</div>
    <header class="dhead">
      <div><h1>${esc(p.project_name)} ${p.archived ? '<span class="tag warn">archived</span>' : ''}${p.is_sample ? '<span class="tag">sample</span>' : ''}</h1>
      <div class="muted">${esc(devName(p.developer_id))} · ${esc(locName(p.location_id))}${p.sub_location ? ', ' + esc(p.sub_location) : ''} · ${esc(cityName(p.city_id))}</div></div>
      <div class="id muted">${esc(pid)}</div>
    </header>
    <div class="facts">
      ${fact('Configurations', types.length ? esc(types.join(', ')) : val(null))}
      ${fact('Price', prices.length ? fmtRange(Math.min(...prices), Math.max(...prices), fmtPrice) : val(null))}
      ${fact('Carpet', carpets.length ? fmtRange(Math.min(...carpets), Math.max(...carpets), fmtNum) + ' sq.ft.' : val(null))}
      ${fact('Dev. Possession', val(fmtMonth(p.developer_possession)))}
      ${fact('RERA Possession', val(fmtMonth(p.rera_possession)))}
      ${fact('Stage · Status', val(p.launch_stage) + ' · ' + val(p.project_status))}
      ${fact('Land Parcel', val(p.land_parcel))}
      ${fact('Purpose', val(p.purpose))}
    </div>
    <div class="secs">${DB.fields.map(section).join('')}</div>
  </div>`;
}
function fact(label, v) { return `<div class="fact"><span>${label}</span><b>${v}</b></div>`; }
function fieldVal(f, v) {
  if (f.type === 'month') return val(fmtMonth(v));
  if (f.type === 'select' && f.source === 'developers') return val(v && devName(v));
  if (f.type === 'number') return val(v, fmtNum);
  return val(v);
}
