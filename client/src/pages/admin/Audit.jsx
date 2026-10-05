import { useState } from 'react';
import { api } from '../../api.js';
import { ErrorBox, Loading, useAsync, useDebounced } from '../../components/ui.jsx';
import { HistoryTable } from '../manage/Wizard.jsx';
import { Head } from './Admin.jsx';

export default function Audit() {
  const [f, setF] = useState({ q: '', entity: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(JSON.stringify(f), 300);
  const data = useAsync(() => api.get(`/api/admin/audit?${new URLSearchParams({ ...JSON.parse(dq), page })}`), [dq, page]);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  return (
    <div className="stack">
      <Head title="Audit log">Every change: who, when, which record and field, the old and the new value. Nothing is overwritten without a trace.</Head>
      <div className="row wrap">
        <input style={{ flex: '1 1 220px' }} placeholder="Search project, field or note" value={f.q} onChange={set('q')} aria-label="Search" />
        <select style={{ width: 'auto' }} value={f.entity} onChange={set('entity')} aria-label="Record type"><option value="">All records</option>{['project', 'configuration', 'tower', 'offer', 'payment_plan', 'objection', 'highlight', 'rera', 'developers', 'cities', 'locations', 'master-values', 'filters', 'bands', 'fields', 'setting', 'user', 'role', 'projects'].map((x) => <option key={x}>{x}</option>)}</select>
        <select style={{ width: 'auto' }} value={f.action} onChange={set('action')} aria-label="Action"><option value="">All actions</option>{['create', 'update', 'delete', 'status', 'merge', 'import', 'login'].map((x) => <option key={x}>{x}</option>)}</select>
        <input type="date" style={{ width: 'auto' }} value={f.from} onChange={set('from')} aria-label="From" />
        <input type="date" style={{ width: 'auto' }} value={f.to} onChange={set('to')} aria-label="To" />
      </div>
      <ErrorBox error={data.error} />
      {data.loading && !data.data ? <Loading /> : <HistoryTable rows={data.data?.items || []} showProject />}
      {data.data && data.data.total > 100 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
          <span className="small muted">{data.data.total} entries · page {page}</span>
          <button className="btn sm" disabled={page * 100 >= data.data.total} onClick={() => setPage(page + 1)}>Older</button>
        </div>
      )}
    </div>
  );
}
