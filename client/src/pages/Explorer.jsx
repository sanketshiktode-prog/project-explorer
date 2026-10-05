import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import Filters, { describeValue, isEmptyValue } from '../components/Filters.jsx';
import MapView, { esc } from '../components/MapView.jsx';
import ProjectDetail, { DetailHeader, renderAttr } from '../components/ProjectDetail.jsx';
import { ErrorBox, Loading, MatchBadge, SearchIcon, Spinner, useAsync, useDebounced } from '../components/ui.jsx';
import { date, inr, inrRange, num, psf, sqft } from '../format.js';

function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [q]);
  return m;
}

function readState(sp) {
  try { return JSON.parse(sp.get('s') || '{}'); } catch { return {}; }
}

export default function Explorer() {
  const [sp, setSp] = useSearchParams();
  const init = useMemo(() => readState(sp), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [filters, setFilters] = useState(init.f || {});
  const [q, setQ] = useState(init.q || '');
  const [sort, setSort] = useState(init.sort || 'relevance');
  const [match, setMatch] = useState(init.m || 'all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(init.sel || null);
  const [mobile, setMobile] = useState('list');
  const cfg = useAsync(() => api.get('/api/explorer/config'), []);
  const dq = useDebounced(q, 220);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const reqId = useRef(0);
  const listRef = useRef(null);
  const narrow = useMedia('(max-width: 1100px)');

  const cleanFilters = useMemo(() => Object.fromEntries(Object.entries(filters).filter(([, v]) => !isEmptyValue(v))), [filters]);
  const key = JSON.stringify({ cleanFilters, dq, sort, match, page });

  useEffect(() => {
    setSp((prev) => {
      const s = JSON.stringify({ f: cleanFilters, q: dq || undefined, sort: sort !== 'relevance' ? sort : undefined, m: match !== 'all' ? match : undefined, sel: selected || undefined });
      const n = new URLSearchParams(prev);
      if (s === '{"f":{}}') n.delete('s'); else n.set('s', s);
      return n;
    }, { replace: true });
  }, [cleanFilters, dq, sort, match, selected, setSp]);

  useEffect(() => {
    const id = ++reqId.current;
    setBusy(true);
    api.post('/api/explorer/search', { filters: cleanFilters, q: dq, sort, match, page, page_size: 30 })
      .then((r) => { if (id === reqId.current) { setRes(r); setErr(null); } })
      .catch((e) => { if (id === reqId.current) setErr(e); })
      .finally(() => { if (id === reqId.current) setBusy(false); });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(1); }, [JSON.stringify(cleanFilters), dq, sort, match]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = useCallback((id, from) => {
    setSelected(id);
    if (from === 'details' || from === 'list') setMobile((m) => (m === 'filters' ? 'list' : m));
    if (from === 'map') {
      const el = listRef.current?.querySelector(`[data-pid="${id}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, []);
  const [drawer, setDrawer] = useState(init.sel ? init.sel : null);
  const openDetails = useCallback((id) => { setSelected(id); setDrawer(id); }, []);

  const cardCache = useRef(new Map());
  const cardFor = useCallback(async (id) => {
    let d = cardCache.current.get(id);
    if (!d) { d = await api.get(`/api/explorer/projects/${id}`); cardCache.current.set(id, d); }
    return popupHtml(d, res?.results.find((r) => r.id === id));
  }, [res]);

  if (cfg.loading) return <Loading />;
  if (cfg.error) return <div className="page"><ErrorBox error={cfg.error} onRetry={cfg.reload} /></div>;
  const defs = cfg.data.filters;
  const activeChips = defs.filter((d) => !isEmptyValue(cleanFilters[d.key]));
  const mapPoints = res?.map || [];

  return (
    <div className={`explorer show-${mobile}`}>
      <aside className="ex-filters" aria-label="Filters">
        <div className="fhead">
          <div className="ex-search">
            <SearchIcon />
            <input type="search" placeholder="Project, developer, area or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
          </div>
          <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
            <span className="small muted">{activeChips.length ? `${activeChips.length} filter${activeChips.length > 1 ? 's' : ''} on` : 'No filters'}</span>
            {(activeChips.length > 0 || q) && <button className="linkbtn small" onClick={() => { setFilters({}); setQ(''); }}>Reset all</button>}
          </div>
        </div>
        <Filters defs={defs} value={filters} onChange={setFilters} />
      </aside>

      <section className="ex-results" aria-label="Matching projects">
        <div className="ex-rhead">
          <div className="ex-count">
            {res ? res.total : '—'} project{res?.total === 1 ? '' : 's'}
            {res && res.partial > 0 && match === 'all' && <small>{res.exact} exact · {res.partial} partial</small>}
          </div>
          {busy && <Spinner />}
          <div className="grow" />
          <div className="seg" role="radiogroup" aria-label="Match type">
            <button aria-pressed={match === 'all'} onClick={() => setMatch('all')}>Exact + partial</button>
            <button aria-pressed={match === 'exact'} onClick={() => setMatch('exact')}>Exact only</button>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ width: 'auto', height: 30, minHeight: 30, padding: '2px 6px', fontSize: 'var(--step--1)' }} aria-label="Sort">
            {cfg.data.sorts.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {activeChips.length > 0 && (
            <div className="ex-active">
              {activeChips.map((d) => <button key={d.key} className="chip" onClick={() => setFilters((f) => ({ ...f, [d.key]: undefined }))} title="Remove filter">{d.label}: {describeValue(d, cleanFilters[d.key])} ✕</button>)}
            </div>
          )}
        </div>
        <ErrorBox error={err} />
        <div className="ex-list" ref={listRef}>
          {!res ? <Loading /> : res.results.length === 0 ? (
            <div className="empty">
              <h3>No projects match</h3>
              <p>Try widening the budget, removing a location, or switch to "Exact + partial" to see near matches.</p>
              {activeChips.length > 0 && <button className="btn" onClick={() => setFilters({})}>Clear filters</button>}
            </div>
          ) : res.results.map((r) => (
            <ResultCard key={r.id} r={r} fields={cfg.data.fields} labels={cfg.data.master_labels} selected={r.id === selected}
              onClick={() => { onSelect(r.id, 'list'); openDetails(r.id); }} />
          ))}
          {res && res.total > res.page_size && (
            <div className="row" style={{ justifyContent: 'center', padding: 8 }}>
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span className="small muted">Page {page} of {Math.ceil(res.total / res.page_size)}</span>
              <button className="btn sm" disabled={page >= Math.ceil(res.total / res.page_size)} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </div>
      </section>

      <section className="ex-map" aria-label="Map">
        <button className="btn map-close" onClick={() => setMobile('list')}>Back to list</button>
        <MapView points={mapPoints} selectedId={selected} onSelect={(id, from) => (from === 'details' ? openDetails(id) : onSelect(id, 'map'))} settings={cfg.data.settings.map} cardFor={cardFor} />
        <div className="map-legend"><span><i className="dot exact" />Exact</span><span><i className="dot partial" />Partial</span></div>
        {res && res.total > mapPoints.length && <div className="map-note">{res.total - mapPoints.length} matching project{res.total - mapPoints.length > 1 ? 's have' : ' has'} no map location</div>}
        {drawer && !narrow && <Drawer id={drawer} result={res?.results.find((r) => r.id === drawer)} labels={cfg.data.master_labels} onClose={() => setDrawer(null)} />}
      </section>


      <nav className="ex-mtabs" role="tablist" aria-label="View">
        {[['filters', `Filters${activeChips.length ? ` (${activeChips.length})` : ''}`], ['list', `List${res ? ` (${res.total})` : ''}`], ['map', 'Map']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={mobile === k} onClick={() => setMobile(k)}>{l}</button>
        ))}
      </nav>
      {drawer && narrow && <Drawer fixed id={drawer} result={res?.results.find((r) => r.id === drawer)} labels={cfg.data.master_labels} onClose={() => setDrawer(null)} />}
    </div>
  );
}

function ResultCard({ r, fields, labels, selected, onClick }) {
  const filtered = r.match.filtered;
  const lines = filtered ? r.configs.filter((c) => c.match !== 'none') : r.configs;
  const groups = groupByType(lines);
  const shown = groups.slice(0, 4);
  const best = lines.filter((c) => c.price_from || c.price_to);
  const from = best.length ? Math.min(...best.map((c) => c.price_from ?? c.price_to)) : null;
  const card = new Map(fields.filter((f) => f.entity === 'project').map((f) => [f.key, f]));
  const showF = (k) => card.get(k)?.show_in_card;
  const firstPartial = filtered && r.match.status === 'partial' ? r.configs.flatMap((c) => c.reasons || []).find((x) => x.status === 'partial') : null;
  const psfs = lines.map((c) => c.psf?.value).filter(Boolean);
  const customCard = fields.filter((f) => f.entity === 'project' && f.storage === 'attribute' && f.show_in_card);
  return (
    <button type="button" data-pid={r.id} className={`rcard ${filtered ? r.match.status : ''} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="r-top">
        <div className="grow">
          <div className="r-name">{r.name}</div>
          <div className="r-sub">
            {[showF('developer_id') && r.developer?.name, [showF('sub_location_id') && r.sub_location, showF('location_id') && r.location].filter(Boolean).join(', ')].filter(Boolean).join(' — ')}
          </div>
        </div>
        <div className="r-price">
          <div className="p">{from ? inr(from) : r.configs.some((c) => c.price_on_request) ? 'On request' : '—'}</div>
          <div className="pl">{from ? (filtered ? 'from (matching)' : 'starting') : 'price'}</div>
        </div>
      </div>
      {groups.length > 0 && (
        <div className="r-configs">
          {shown.map((g) => (
            <div key={g.type} className="cfgline" title={g.reasons.join('\n')}>
              <span className={`dot ${filtered ? g.match : 'none'}`} style={filtered ? {} : { background: 'var(--line-2)' }} />
              <span className="t">{g.type}{g.n > 1 ? <span className="muted" style={{ fontWeight: 400 }}> ×{g.n}</span> : ''}</span>
              <span className="a">{g.amin != null ? sqft(g.amin, g.amax) : ''}</span>
              <span className="v">{g.pmin != null ? inrRange(g.pmin, g.pmax) : g.por ? 'On request' : '—'}</span>
            </div>
          ))}
          {groups.length > shown.length && <div className="small muted" style={{ paddingLeft: 18 }}>+{groups.length - shown.length} more types</div>}
        </div>
      )}
      {r.configs.length === 0 && <div className="small muted" style={{ marginTop: 8 }}>{r.match.notes?.[0] || 'No configurations yet'}</div>}
      <div className="r-meta">
        {filtered && <MatchBadge status={r.match.status} />}
        {psfs.length > 0 && <span>₹/sq.ft. <b>{psf(Math.min(...psfs))}{Math.max(...psfs) !== Math.min(...psfs) ? `–${num(Math.round(Math.max(...psfs)))}` : ''}</b></span>}
        {showF('dev_possession_date') && r.dev_possession_date && <span>Dev. poss. <b>{date(r.dev_possession_date)}</b></span>}
        {showF('rera_possession_date') && r.rera_possession_date && <span>RERA <b>{date(r.rera_possession_date)}</b></span>}
        {showF('land_parcel_acres') && r.land_parcel_acres != null && <span><b>{num(r.land_parcel_acres)}</b> acres</span>}
        {customCard.map((f) => r.attributes?.[f.key] != null && <span key={f.key}>{f.label} <b>{renderAttr(f, r.attributes[f.key], labels)}</b></span>)}
        {r.launch_stage && <span>{r.launch_stage}</span>}
        {r.stale && <span className="badge partial">Needs re-check</span>}
      </div>
      {firstPartial && <div className="reason">{firstPartial.text}</div>}
    </button>
  );
}

/** Collapse configuration rows into one line per type: area span, price span, best match state. */
function groupByType(cfgs) {
  const m = new Map();
  const rank = { exact: 2, partial: 1, none: 0 };
  for (const c of cfgs) {
    const g = m.get(c.type) || { type: c.type, n: 0, amin: null, amax: null, pmin: null, pmax: null, por: false, match: 'none', reasons: [] };
    g.n += 1;
    const a1 = c.carpet_from ?? c.carpet_to; const a2 = c.carpet_to ?? c.carpet_from;
    if (a1 != null) { g.amin = g.amin == null ? a1 : Math.min(g.amin, a1); g.amax = g.amax == null ? a2 : Math.max(g.amax, a2); }
    const p1 = c.price_from ?? c.price_to; const p2 = c.price_to ?? c.price_from;
    if (p1 != null && !c.price_on_request) { g.pmin = g.pmin == null ? p1 : Math.min(g.pmin, p1); g.pmax = g.pmax == null ? p2 : Math.max(g.pmax, p2); }
    if (c.price_on_request) g.por = true;
    if (c.match && rank[c.match] > rank[g.match]) g.match = c.match;
    for (const r of c.reasons || []) if (!g.reasons.includes(r.text)) g.reasons.push(r.text);
    m.set(c.type, g);
  }
  return [...m.values()];
}

function Drawer({ id, result, labels, onClose, fixed }) {
  const { can } = useSession();
  const d = useAsync(() => api.get(`/api/explorer/projects/${id}`), [id]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <aside className={`drawer ${fixed ? 'fixed' : ''}`} aria-label="Project details">
      {d.loading ? <Loading /> : d.error ? <div style={{ padding: 16 }}><ErrorBox error={d.error} /></div> : (
        <>
          <div className="drawer-head">
            <DetailHeader d={d.data} match={result?.match.filtered ? result.match.status : null}>
              <div className="row wrap" style={{ marginTop: 8 }}>
                <Link className="btn sm primary" to={`/p/${d.data.public_id}`}>Detailed overview</Link>
                {can('project.edit') && <Link className="btn sm" to={`/manage/${d.data.id}`}>Edit</Link>}
              </div>
            </DetailHeader>
            <button className="btn ghost icon" onClick={onClose} aria-label="Close details">✕</button>
          </div>
          <div className="drawer-body">
            <ProjectDetail d={d.data} masterLabels={labels} matchConfigs={result?.match.filtered ? mergeMatch(d.data.configurations, result.configs) : null} />
          </div>
        </>
      )}
    </aside>
  );
}

const mergeMatch = (all, matched) => all.map((c) => { const m = matched.find((x) => x.id === c.id); return m ? { ...c, match: m.match, reasons: m.reasons } : { ...c, match: 'none' }; })
  .sort((a, b) => ({ exact: 0, partial: 1, none: 2 }[a.match] - { exact: 0, partial: 1, none: 2 }[b.match]));

function popupHtml(d, r) {
  const cfgs = r?.match.filtered ? r.configs.filter((c) => c.match !== 'none') : d.configurations;
  const priced = cfgs.filter((c) => c.price_from || c.price_to);
  const carp = cfgs.filter((c) => c.carpet_from || c.carpet_to);
  const ps = cfgs.map((c) => c.psf?.value).filter(Boolean);
  const types = [...new Set(cfgs.map((c) => c.type))].join(', ') || '—';
  const row = (k, v) => `<dt>${k}</dt><dd>${esc(v)}</dd>`;
  return `<div class="popcard">
    <h4>${esc(d.name)}</h4><div class="muted">${esc([d.developer?.name, d.sub_location?.name, d.location?.name].filter(Boolean).join(' · '))}</div>
    <dl class="kv">
      ${row('Configuration', types)}
      ${row('Carpet', carp.length ? sqft(Math.min(...carp.map((c) => c.carpet_from ?? c.carpet_to)), Math.max(...carp.map((c) => c.carpet_to ?? c.carpet_from))) : '—')}
      ${row('Price', priced.length ? inrRange(Math.min(...priced.map((c) => c.price_from ?? c.price_to)), Math.max(...priced.map((c) => c.price_to ?? c.price_from))) : '—')}
      ${row('₹/sq.ft.', ps.length ? `${psf(Math.min(...ps))}${Math.max(...ps) !== Math.min(...ps) ? `–${num(Math.round(Math.max(...ps)))}` : ''}` : '—')}
      ${row('Dev. possession', date(d.values.dev_possession_date))}
      ${row('RERA possession', date(d.values.rera_possession_date))}
    </dl>
    <button class="btn sm primary" data-open style="margin-top:10px;width:100%">Open details</button>
  </div>`;
}
