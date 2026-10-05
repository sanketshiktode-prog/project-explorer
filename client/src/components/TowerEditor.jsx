// Towers: bulk create, "apply these details to selected towers", per-tower overrides.
// Every tower always stores its own final values; shared entry is just a faster way to fill them.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { ErrorBox, Field, NumberInput, TextInput, useToast } from './ui.jsx';

const SHARED = [
  ['floors_above_ground', 'Floors (G+)'], ['habitable_from_floor', 'Habitable from'], ['flats_per_floor', 'Flats / floor'],
  ['main_lifts', 'Main lifts'], ['service_lifts', 'Service lifts'],
];
const COLS = ['name', 'phase', 'represents_count', ...SHARED.map((s) => s[0]), 'remarks'];

function elevationOf(rd, floors) {
  if (floors == null) return '—';
  const b = rd.bands.filter((x) => x.band_set_key === 'elevation' && x.is_active)
    .find((x) => (x.lower_bound == null || floors >= Number(x.lower_bound)) && (x.upper_bound == null || floors < Number(x.upper_bound)));
  return b?.label ?? '—';
}

export default function TowerEditor({ projectId, towers, rd, onChanged, totalTowers }) {
  const toast = useToast();
  const active = towers.filter((t) => t.is_active);
  const [rows, setRows] = useState({});
  const [sel, setSel] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(active.length === 0);
  useEffect(() => { setRows(Object.fromEntries(towers.map((t) => [t.id, Object.fromEntries(COLS.map((k) => [k, t[k] ?? null]))]))); }, [towers]);

  const mode = useMemo(() => {
    const out = {};
    for (const [k] of SHARED) {
      const counts = {};
      for (const t of active) { const v = rows[t.id]?.[k]; if (v != null) counts[v] = (counts[v] || 0) + 1; }
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      out[k] = best && best[1] >= 2 ? Number(best[0]) : null;
    }
    return out;
  }, [rows, active]);

  const dirtyIds = towers.filter((t) => COLS.some((k) => (rows[t.id]?.[k] ?? null) !== (t[k] ?? null))).map((t) => t.id);
  const saveAll = async () => {
    setBusy(true); setErr(null);
    try {
      for (const id of dirtyIds) {
        const t = towers.find((x) => x.id === id);
        const changes = Object.fromEntries(COLS.filter((k) => (rows[id][k] ?? null) !== (t[k] ?? null)).map((k) => [k, { from: t[k] ?? null, to: rows[id][k] }]));
        await api.patch(`/api/manage/projects/${projectId}/towers/${id}`, { changes });
      }
      toast(`${dirtyIds.length} tower${dirtyIds.length > 1 ? 's' : ''} saved`);
      onChanged();
    } catch (e) {
      setErr(e.status === 409 ? new Error(`${e.message} Reload the step to see the latest values.`) : e);
    }
    setBusy(false);
  };
  const remove = async (t) => {
    if (!window.confirm(`Remove ${t.name}? It stays in the change history and can be restored.`)) return;
    await api.del(`/api/manage/projects/${projectId}/towers/${t.id}`);
    toast('Tower removed'); onChanged();
  };
  const restore = async (t) => { await api.patch(`/api/manage/projects/${projectId}/towers/${t.id}`, { changes: { is_active: { to: true } } }); onChanged(); };
  const setCell = (id, k, v) => setRows((r) => ({ ...r, [id]: { ...r[id], [k]: v } }));
  const recorded = active.reduce((s, t) => s + (t.represents_count || 1), 0);

  return (
    <div className="stack">
      <div className="row wrap">
        <span className="small">{recorded} tower{recorded === 1 ? '' : 's'} recorded{totalTowers != null ? ` of ${totalTowers} in the project` : ''}.</span>
        {totalTowers != null && recorded > totalTowers && <span className="badge partial">More towers recorded than the project total</span>}
        <div className="grow" />
        <button className="btn sm" onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Hide' : 'Add towers'}</button>
      </div>
      {showCreate && <BulkCreate projectId={projectId} existing={active.length} onDone={() => { setShowCreate(false); onChanged(); }} />}
      {active.length > 0 && <ApplyPanel projectId={projectId} sel={sel} towers={active} onDone={() => { setSel([]); onChanged(); }} />}
      {towers.length > 0 && (
        <div className="table-wrap">
          <table className="t">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all towers" checked={sel.length === active.length && active.length > 0} onChange={(e) => setSel(e.target.checked ? active.map((t) => t.id) : [])} /></th>
              <th>Tower</th><th>Phase</th><th className="num">Represents</th>{SHARED.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th>Elevation</th><th>Remarks</th><th />
            </tr></thead>
            <tbody>
              {towers.map((t) => {
                const r = rows[t.id] || {};
                const dis = !t.is_active;
                return (
                  <tr key={t.id} className={dis ? 'dim' : ''}>
                    <td><input type="checkbox" disabled={dis} checked={sel.includes(t.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} aria-label={`Select ${t.name}`} /></td>
                    <td style={{ minWidth: 130 }}><TextInput value={r.name} onChange={(v) => setCell(t.id, 'name', v)} disabled={dis} aria-label="Tower name" /></td>
                    <td style={{ minWidth: 110 }}><TextInput value={r.phase} onChange={(v) => setCell(t.id, 'phase', v)} disabled={dis} aria-label="Phase" /></td>
                    <td style={{ width: 80 }}><NumberInput integer value={r.represents_count} onChange={(v) => setCell(t.id, 'represents_count', v ?? 1)} disabled={dis} aria-label="Represents" /></td>
                    {SHARED.map(([k, l]) => {
                      const differs = mode[k] != null && r[k] != null && r[k] !== mode[k] && active.length >= 3;
                      return <td key={k} style={{ width: 84 }} className={differs ? 'override' : ''} title={differs ? `Differs from most towers (${mode[k]})` : undefined}>
                        <NumberInput integer value={r[k]} onChange={(v) => setCell(t.id, k, v)} disabled={dis} aria-label={l} />
                      </td>;
                    })}
                    <td className="small nowrap">{elevationOf(rd, r.floors_above_ground)}{r.habitable_from_floor != null && r.floors_above_ground != null && r.habitable_from_floor > r.floors_above_ground && <div className="field-err">Above top floor</div>}</td>
                    <td style={{ minWidth: 160 }}><TextInput value={r.remarks} onChange={(v) => setCell(t.id, 'remarks', v)} disabled={dis} aria-label="Remarks" /></td>
                    <td className="nowrap">{dis ? <button className="btn sm" onClick={() => restore(t)}>Restore</button> : <button className="btn sm ghost danger" onClick={() => remove(t)}>Remove</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ErrorBox error={err} />
      {dirtyIds.length > 0 && <div className="row"><button className="btn primary" disabled={busy} onClick={saveAll}>Save {dirtyIds.length} changed tower{dirtyIds.length > 1 ? 's' : ''}</button><button className="btn ghost" onClick={() => onChanged()}>Discard</button></div>}
      {active.length >= 3 && <div className="help">Highlighted cells differ from most towers — that is fine for a genuinely different tower; check it is not a typo.</div>}
    </div>
  );
}

function SharedInputs({ v, set }) {
  return (
    <div className="grid c4" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
      {SHARED.map(([k, l]) => <Field key={k} label={l}><NumberInput integer value={v[k]} onChange={(x) => set({ ...v, [k]: x })} /></Field>)}
    </div>
  );
}

function BulkCreate({ projectId, existing, onDone }) {
  const toast = useToast();
  const [count, setCount] = useState(existing ? 1 : 2);
  const [naming, setNaming] = useState('letters');
  const [prefix, setPrefix] = useState('Tower');
  const [v, setV] = useState({});
  const [err, setErr] = useState(null);
  const names = Array.from({ length: Math.min(count || 0, 100) }, (_, i) => (naming === 'numbers' ? `${prefix} ${existing + i + 1}` : `${prefix} ${String.fromCharCode(65 + ((existing + i) % 26))}${existing + i >= 26 ? Math.floor((existing + i) / 26) : ''}`));
  const go = async () => {
    setErr(null);
    try {
      await api.post(`/api/manage/projects/${projectId}/towers/bulk-create`, { names, values: v });
      toast(`${names.length} tower${names.length > 1 ? 's' : ''} created`);
      onDone();
    } catch (e) { setErr(e); }
  };
  return (
    <div className="panel panel-pad stack" style={{ background: 'var(--sunken)' }}>
      <h4>Add towers</h4>
      <div className="grid c4">
        <Field label="How many"><NumberInput integer value={count} onChange={setCount} /></Field>
        <Field label="Name prefix"><TextInput value={prefix} onChange={(x) => setPrefix(x ?? '')} /></Field>
        <Field label="Numbering">
          <div className="seg"><button type="button" aria-pressed={naming === 'letters'} onClick={() => setNaming('letters')}>A, B, C</button><button type="button" aria-pressed={naming === 'numbers'} onClick={() => setNaming('numbers')}>1, 2, 3</button></div>
        </Field>
        <div className="help" style={{ alignSelf: 'end' }}>{names.slice(0, 4).join(', ')}{names.length > 4 ? ` … ${names[names.length - 1]}` : ''}</div>
      </div>
      <div className="small muted">Details shared by all new towers (optional — you can change any tower afterwards):</div>
      <SharedInputs v={v} set={setV} />
      <ErrorBox error={err} />
      <div><button className="btn primary" disabled={!names.length} onClick={go}>Create {names.length} tower{names.length > 1 ? 's' : ''}</button></div>
    </div>
  );
}

function ApplyPanel({ projectId, sel, towers, onDone }) {
  const toast = useToast();
  const [v, setV] = useState({});
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [err, setErr] = useState(null);
  const filled = Object.fromEntries(Object.entries(v).filter(([, x]) => x != null));
  const go = async () => {
    setErr(null);
    try {
      await api.post(`/api/manage/projects/${projectId}/towers/apply`, { tower_ids: sel, values: filled, only_empty: onlyEmpty });
      toast(`Applied to ${sel.length} tower${sel.length > 1 ? 's' : ''}`);
      setV({});
      onDone();
    } catch (e) { setErr(e); }
  };
  return (
    <details className="panel panel-pad" open={sel.length > 0}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Apply the same details to selected towers {sel.length > 0 && <span className="badge brand">{sel.length} selected</span>}</summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="small muted">Tick towers in the table, fill only the values you want to copy, then apply. Each tower keeps its own copy, so you can still change one tower later.</div>
        <SharedInputs v={v} set={setV} />
        <label className="check"><input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} />Only fill towers where the value is empty</label>
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary" disabled={!sel.length || !Object.keys(filled).length} onClick={go}>Apply to {sel.length || 0} tower{sel.length === 1 ? '' : 's'}</button>
          {sel.length < towers.length && <span className="small muted">Tip: use the header checkbox to select all towers.</span>}</div>
      </div>
    </details>
  );
}
