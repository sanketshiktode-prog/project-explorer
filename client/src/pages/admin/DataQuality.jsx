import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorBox, Loading, StatusBadge, useAsync } from '../../components/ui.jsx';
import { date } from '../../format.js';
import { Head } from './Admin.jsx';

export default function DataQuality() {
  const d = useAsync(() => api.get('/api/admin/data-quality'), []);
  const [open, setOpen] = useState(null);
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  const checks = d.data.checks;
  const sel = checks.find((c) => c.key === open);
  const order = { error: 0, warning: 1, info: 2 };
  return (
    <div>
      <Head title="Data quality">{d.data.totals.total} projects in the database, {d.data.totals.live} visible to sales. Click a check to see the projects behind it.</Head>
      <div className="dq-grid">
        {[...checks].sort((a, b) => (b.count > 0) - (a.count > 0) || order[a.level] - order[b.level]).map((c) => (
          <button key={c.key} className={`panel dq ${c.count ? c.level : 'zero'}`} aria-pressed={open === c.key} onClick={() => setOpen(open === c.key ? null : c.key)}>
            <div className="n">{c.count}</div>
            <div className="small" style={{ marginTop: 6 }}>{c.label}</div>
          </button>
        ))}
      </div>
      {sel && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ marginBottom: 8 }}>{sel.label}</h3>
          {sel.items.length === 0 ? <div className="small muted">Nothing to fix.</div> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Project</th><th>Status</th><th>Detail</th><th /></tr></thead><tbody>
              {sel.items.map((x, i) => (
                <tr key={`${x.id}-${i}`}>
                  <td><b>{x.name}</b>{x.public_id && <div className="small muted">{x.public_id}</div>}</td>
                  <td>{x.record_status && <StatusBadge status={x.record_status} />}</td>
                  <td className="small">{x.detail || (x.n != null ? `${x.n} configuration(s)` : x.updated_at ? `updated ${date(x.updated_at, 'day')}${x.verified_at ? `, verified ${date(x.verified_at, 'day')}` : ''}` : '')}</td>
                  <td className="nowrap">{x.developer ? <Link className="btn sm" to="/admin/masters/developers">Review developers</Link> : <>
                    <Link className="btn sm" to={`/manage/${x.id}`}>Fix</Link>{x.other && <> <Link className="btn sm ghost" to={`/manage/${x.other.id}`}>Open other</Link></>}</>}</td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>
      )}
      <div className="help" style={{ marginTop: 14 }}>Generated {date(d.data.generated_at, 'time')}. Stale threshold, coordinate radius and duplicate sensitivity are set in Business rules.</div>
    </div>
  );
}
