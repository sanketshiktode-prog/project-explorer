import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { ErrorBox, Loading, SearchIcon, StatusBadge, useAsync, useDebounced } from '../../components/ui.jsx';
import { ago } from '../../format.js';

const TABS = [
  ['', 'All active'], ['draft', 'Drafts'], ['under_review', 'Under review'], ['verified', 'Verified'], ['published', 'Published'],
  ['needs_update', 'Needs update'], ['inactive', 'Inactive'], ['archived', 'Archived'],
];

export default function ProjectsList() {
  const { can, ref } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || '';
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [mine, setMine] = useState(false);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q, 250);
  const data = useAsync(() => api.get(`/api/manage/projects?${new URLSearchParams({ ...(status ? { status } : {}), q: dq, city, mine: mine ? '1' : '', page })}`), [status, dq, city, mine, page]);
  const counts = data.data?.counts || {};
  const activeTotal = Object.entries(counts).filter(([k]) => k !== 'archived').reduce((s, [, n]) => s + n, 0);
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Projects</h1><p className="lede">Everything in the database, including drafts and projects waiting for review. Sales only sees published projects.</p></div>
        {can('project.create') && <Link className="btn primary" to="/manage/new">New project</Link>}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={status === k} onClick={() => { setSp(k ? { status: k } : {}); setPage(1); }}>{l}<span className="count">{k ? counts[k] || 0 : activeTotal}</span></button>)}
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="ex-search" style={{ flex: '1 1 280px' }}><SearchIcon /><input type="search" placeholder="Name, developer or project ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search projects" /></div>
        <select value={city} onChange={(e) => { setCity(e.target.value); setPage(1); }} style={{ width: 'auto' }} aria-label="City">
          <option value="">All cities</option>{ref.cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />Created or updated by me</label>
      </div>
      <ErrorBox error={data.error} onRetry={data.reload} />
      {data.loading && !data.data ? <Loading /> : data.data?.items.length === 0 ? (
        <div className="panel empty"><h3>No projects here</h3><p>{q ? 'Try a different search.' : status === 'under_review' ? 'Nothing is waiting for review.' : 'Create a project to get started.'}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Project</th><th>Developer</th><th>Location</th><th>Status</th><th className="num">Configs</th><th className="num">Towers</th><th>Map</th><th>Last updated</th></tr></thead>
            <tbody>
              {data.data?.items.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => nav(`/manage/${p.id}${status === 'under_review' ? '?step=review' : ''}`)}>
                  <td><b>{p.name}</b><div className="small muted">{p.public_id}</div></td>
                  <td>{p.developer || <span className="muted">—</span>}</td>
                  <td>{[p.sub_location, p.location].filter(Boolean).join(', ') || <span className="muted">{p.city}</span>}</td>
                  <td><StatusBadge status={p.record_status} />{p.sales_status && p.sales_status !== 'Active' && <div className="small muted">{p.sales_status}</div>}{p.verified_at && new Date(p.updated_at) > new Date(p.verified_at) && ['published', 'needs_update'].includes(p.record_status) && <div className="small" style={{ color: 'var(--partial)' }}>changed since verified</div>}</td>
                  <td className="num">{p.config_count || <span style={{ color: 'var(--danger)' }}>0</span>}</td>
                  <td className="num">{p.tower_count}</td>
                  <td>{p.has_coords ? '✓' : <span style={{ color: 'var(--danger)' }}>missing</span>}</td>
                  <td className="nowrap">{ago(p.updated_at)}<div className="small muted">{p.updated_by_name}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.data && data.data.total > data.data.page_size && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="small muted">Page {page} of {Math.ceil(data.data.total / data.data.page_size)}</span>
          <button className="btn sm" disabled={page >= Math.ceil(data.data.total / data.data.page_size)} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}
