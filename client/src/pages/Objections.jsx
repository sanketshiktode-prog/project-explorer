import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, Loading, SearchIcon, useAsync, useDebounced } from '../components/ui.jsx';

export default function Objections() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const r = useAsync(() => api.get(`/api/explorer/objections?q=${encodeURIComponent(dq)}`), [dq]);
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head"><div><h1>Objection handling</h1><p className="lede">Agreed answers to what customers push back on — general answers first, then project-specific ones.</p></div></div>
      <div className="ex-search" style={{ marginBottom: 16 }}>
        <SearchIcon />
        <input type="search" placeholder="Try “price”, “possession”, “too far”…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search objections" />
      </div>
      <ErrorBox error={r.error} />
      {r.loading && !r.data ? <Loading /> : r.data?.length === 0 ? <div className="empty"><h3>No answers found</h3><p>Try a shorter word, or ask your team lead to add an answer for this objection.</p></div> : (
        r.data?.map((o) => (
          <div key={o.id} className={`qa ${o.project_id ? '' : 'generic'}`} style={{ background: o.project_id ? 'var(--surface)' : undefined }}>
            <div className="q">“{o.objection}”</div>
            <div>{o.response}</div>
            <div className="small muted" style={{ marginTop: 4 }}>{o.project_id ? <Link to={`/p/${o.public_id}`}>{o.project_name}</Link> : 'General answer'}</div>
          </div>
        ))
      )}
    </div>
  );
}
