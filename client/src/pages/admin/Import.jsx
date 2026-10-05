import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { ErrorBox, Loading, Select, useAsync, useToast } from '../../components/ui.jsx';
import { ago } from '../../format.js';
import { Head } from './Admin.jsx';

const STAGES = ['Upload', 'Map columns', 'Check', 'Import'];

export default function Import() {
  const { reloadRef } = useSession();
  const toast = useToast();
  const [entity, setEntity] = useState('projects');
  const [batch, setBatch] = useState(null);
  const [mapping, setMapping] = useState({});
  const [createDevs, setCreateDevs] = useState(false);
  const [report, setReport] = useState(null);
  const [allowDup, setAllowDup] = useState([]);
  const [result, setResult] = useState(null);
  const [show, setShow] = useState('problems');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const recent = useAsync(() => api.get('/api/import'), [result]);
  const stage = result ? 3 : report ? 2 : batch ? 1 : 0;

  const upload = async (file) => {
    setErr(null); setBusy(true);
    try {
      const fd = new FormData(); fd.append('entity', entity); fd.append('file', file);
      const b = await api.upload('/api/import/upload', fd);
      setBatch(b); setMapping(b.mapping); setReport(null); setResult(null);
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  const validate = async () => {
    setErr(null); setBusy(true);
    try { setReport(await api.post(`/api/import/${batch.id}/validate`, { mapping, options: { create_missing_developers: createDevs } })); setAllowDup([]); } catch (e) { setErr(e); }
    setBusy(false);
  };
  const commit = async () => {
    setErr(null); setBusy(true);
    try { const r = await api.post(`/api/import/${batch.id}/commit`, { include_duplicate_rows: allowDup }); setResult(r); toast(`${r.created.length} record(s) imported as drafts`); reloadRef(); } catch (e) { setErr(e); }
    setBusy(false);
  };
  const reset = () => { setBatch(null); setReport(null); setResult(null); setErr(null); };
  const importable = report ? report.rows.filter((r) => r.status === 'ok' || r.status === 'warning' || (r.status === 'duplicate' && allowDup.includes(r.row))).length : 0;

  return (
    <div className="stack">
      <Head title="Bulk import">Load projects, configurations or towers from CSV or Excel. Nothing is written until you confirm, and imported projects arrive as drafts that still go through review.</Head>
      <div className="row wrap">{STAGES.map((s, i) => <span key={s} className={`badge ${i === stage ? 'brand' : i < stage ? 'exact' : ''}`}>{i + 1}. {s}</span>)}</div>
      <ErrorBox error={err} />

      {stage === 0 && (
        <div className="panel panel-pad stack">
          <div className="row wrap">
            <span className="lbl">What are you importing?</span>
            {['projects', 'configurations', 'towers'].map((e) => <button key={e} className="chip" aria-pressed={entity === e} onClick={() => setEntity(e)}>{e}</button>)}
          </div>
          <div className="small muted">{entity === 'projects' ? 'One row per project. Developer, city, location and sub-location must match master data (names are matched case-insensitively).' : 'One row per ' + entity.slice(0, -1) + '. Identify the project by its ID (PRJ-…) or exact name.'} Prices accept 13500000, “1.35 Cr” or “85 L”; dates accept 2030-06-01, 06/2030, Jun 2030.</div>
          <div className="row wrap">
            <label className="btn primary" style={{ cursor: 'pointer' }}>{busy ? 'Reading file…' : 'Choose CSV or Excel file'}<input type="file" accept=".csv,.xlsx,.xlsm" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && upload(e.target.files[0])} /></label>
            <a className="btn" href={`/api/import/template/${entity}`}>Download template</a>
          </div>
        </div>
      )}

      {stage === 1 && batch && (
        <div className="panel panel-pad stack">
          <div className="row"><b>{batch.file_name}</b><span className="small muted">{batch.row_count} rows{batch.sheet ? ` · sheet “${batch.sheet}”` : ''}</span><div className="grow" /><button className="btn sm ghost" onClick={reset}>Start over</button></div>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Column in your file</th><th>Example values</th><th style={{ width: 280 }}>Import into</th></tr></thead>
            <tbody>{batch.headers.map((h) => (
              <tr key={h}><td><b>{h}</b></td><td className="small muted">{batch.preview.slice(0, 3).map((r) => String(r[h] ?? '')).filter(Boolean).map((s) => s.slice(0, 40)).join(' · ')}</td>
                <td><Select value={mapping[h]} placeholder="— ignore this column —" onChange={(v) => setMapping({ ...mapping, [h]: v })} options={batch.targets.map((t) => ({ value: t.key, label: t.label, disabled: Object.values(mapping).includes(t.key) && mapping[h] !== t.key }))} /></td></tr>
            ))}</tbody>
          </table></div>
          {entity === 'projects' && <label className="check"><input type="checkbox" checked={createDevs} onChange={(e) => setCreateDevs(e.target.checked)} />Create developers that are not in master data yet (otherwise those rows are rejected)</label>}
          <div><button className="btn primary" disabled={busy} onClick={validate}>{busy ? 'Checking…' : 'Check all rows'}</button></div>
        </div>
      )}

      {stage === 2 && report && (
        <div className="panel panel-pad stack">
          <div className="row wrap">
            <span className="badge exact">{report.summary.ok} ready</span><span className="badge partial">{report.summary.warning} with warnings</span>
            <span className="badge info">{report.summary.duplicate} possible duplicates</span><span className="badge danger">{report.summary.error} with errors</span>
            <div className="grow" />
            <a className="btn sm" href={`/api/import/${batch.id}/report.csv`}>Download error report</a>
            <button className="btn sm ghost" onClick={() => setReport(null)}>Back to mapping</button>
          </div>
          <div className="seg"><button aria-pressed={show === 'problems'} onClick={() => setShow('problems')}>Problems only</button><button aria-pressed={show === 'all'} onClick={() => setShow('all')}>All rows</button></div>
          <div className="table-wrap" style={{ maxHeight: 460 }}><table className="t">
            <thead><tr><th>Row</th><th>Record</th><th>Result</th><th>Details</th></tr></thead>
            <tbody>{report.rows.filter((r) => show === 'all' || r.status !== 'ok').map((r) => (
              <tr key={r.row}>
                <td>{r.row}</td><td>{r.label || '—'}</td>
                <td><span className={`badge ${{ ok: 'exact', warning: 'partial', duplicate: 'info', error: 'danger' }[r.status]}`}>{r.status}</span></td>
                <td className="small">
                  {r.messages.map((m, i) => <div key={i} style={{ color: m.level === 'error' ? 'var(--danger)' : 'var(--partial)' }}>{m.message}</div>)}
                  {r.duplicates?.length > 0 && <div>
                    Possibly already exists: {r.duplicates.map((d) => <Link key={d.id} to={`/manage/${d.id}`} target="_blank">{d.name} ({d.public_id})</Link>).reduce((a, b) => [a, ', ', b])}
                    <label className="check" style={{ marginTop: 4 }}><input type="checkbox" checked={allowDup.includes(r.row)} onChange={(e) => setAllowDup(e.target.checked ? [...allowDup, r.row] : allowDup.filter((x) => x !== r.row))} />Genuinely different — import anyway</label>
                  </div>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row"><button className="btn primary" disabled={busy || !importable} onClick={commit}>{busy ? 'Importing…' : `Import ${importable} row${importable === 1 ? '' : 's'}`}</button>
            <span className="small muted">Rows with errors and unconfirmed duplicates are skipped.</span></div>
        </div>
      )}

      {stage === 3 && result && (
        <div className="panel panel-pad stack">
          <div className="notice ok"><div>{result.created.length} record(s) created{entity === 'projects' ? ' as drafts — open Projects → Drafts to complete and submit them' : ''}. {result.skipped.length} skipped.</div></div>
          {result.skipped.length > 0 && <ul className="bul">{result.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul>}
          {entity === 'projects' && result.created.length > 0 && <ul className="bul">{result.created.slice(0, 20).map((c) => <li key={c.id}><Link to={`/manage/${c.id}`}>{c.name}</Link> — {c.public_id}</li>)}</ul>}
          <div><button className="btn" onClick={reset}>Import another file</button></div>
        </div>
      )}

      <h3 style={{ marginTop: 10 }}>Recent imports</h3>
      {recent.loading ? <Loading /> : (recent.data || []).length === 0 ? <div className="small muted">No imports yet.</div> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>File</th><th>Type</th><th>Status</th><th className="num">Rows</th><th>By</th><th>When</th></tr></thead>
          <tbody>{recent.data.map((b) => <tr key={b.id}><td>{b.file_name}</td><td>{b.entity}</td><td>{b.status}</td><td className="num">{b.row_count}</td><td>{b.user_name}</td><td>{ago(b.created_at)}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}
