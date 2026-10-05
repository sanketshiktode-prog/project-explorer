// Generic inline-editable table for admin resources (masters, bands, filters, fields).
import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { ErrorBox, Loading, NumberInput, Select, TextInput, useAsync, useToast } from '../../components/ui.jsx';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * columns: [{ key, label, type: text|number|int|bool|select|json|tags|readonly, options, width, required, render, editable(row) }]
 */
export default function CrudTable({ resource, columns, filter, defaults = {}, addLabel = 'Add', onChanged, rowActions, sort, emptyText = 'Nothing here yet.', canDelete = true, note }) {
  const data = useAsync(() => api.get(`/api/admin/r/${resource}?usage=1`), [resource]);
  const toast = useToast();
  const [edits, setEdits] = useState({});
  const [adding, setAdding] = useState(null);
  const [err, setErr] = useState(null);
  const rows = useMemo(() => {
    let r = (data.data || []).filter((x) => (filter ? filter(x) : true));
    if (sort) r = [...r].sort(sort);
    return r;
  }, [data.data, filter, sort]);
  const pk = (r) => r.id ?? r.key;
  const val = (r, k) => (edits[pk(r)] && k in edits[pk(r)] ? edits[pk(r)][k] : r[k]);
  const setVal = (r, k, v) => setEdits((e) => ({ ...e, [pk(r)]: { ...(e[pk(r)] || {}), [k]: v } }));
  const dirty = (r) => Object.entries(edits[pk(r)] || {}).some(([k, v]) => !same(v, r[k]));
  const done = async (msg) => { toast(msg); await data.reload(); onChanged?.(); };

  const save = async (r) => {
    setErr(null);
    try {
      const body = Object.fromEntries(Object.entries(edits[pk(r)] || {}).filter(([k, v]) => !same(v, r[k])));
      await api.patch(`/api/admin/r/${resource}/${pk(r)}`, { ...body, row_version: r.row_version });
      setEdits((e) => { const n = { ...e }; delete n[pk(r)]; return n; });
      await done('Saved');
    } catch (e) { setErr(e); }
  };
  const remove = async (r) => {
    if (!window.confirm('Delete this permanently? (Only possible while nothing uses it.)')) return;
    setErr(null);
    try { await api.del(`/api/admin/r/${resource}/${pk(r)}`); await done('Deleted'); } catch (e) { setErr(e); }
  };
  const create = async () => {
    setErr(null);
    try { await api.post(`/api/admin/r/${resource}`, { ...defaults, ...adding }); setAdding(null); await done('Added'); } catch (e) {
      if (e.status === 409 && e.body?.code === 'possible_duplicate') {
        if (window.confirm(`${e.message}: ${e.body.candidates.map((c) => c.name).join(', ')}.\n\nAdd anyway?`)) {
          try { await api.post(`/api/admin/r/${resource}`, { ...defaults, ...adding, confirm_not_duplicate: true }); setAdding(null); await done('Added'); } catch (e2) { setErr(e2); }
        }
      } else setErr(e);
    }
  };

  if (data.loading && !data.data) return <Loading />;
  const cell = (c, r, value, set, isNew) => {
    const editable = c.type !== 'readonly' && (!c.editable || c.editable(r, isNew));
    if (c.render && !editable) return c.render(r);
    if (!editable) return <span>{c.format ? c.format(value, r) : value ?? '—'}</span>;
    switch (c.type) {
      case 'bool': return <input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} aria-label={c.label} />;
      case 'number': return <NumberInput value={value} onChange={set} aria-label={c.label} />;
      case 'int': return <NumberInput integer value={value} onChange={set} aria-label={c.label} />;
      case 'select': return <Select value={value} onChange={set} options={typeof c.options === 'function' ? c.options(r) : c.options} allowEmpty={!c.required} placeholder="—" aria-label={c.label} />;
      case 'json': return <JsonInput value={value} onChange={set} />;
      case 'tags': return <TextInput value={Array.isArray(value) ? value.join(', ') : value} onChange={(x) => set(x ? x.split(',').map((s) => s.trim()).filter(Boolean) : [])} aria-label={c.label} />;
      case 'money': return <NumberInput value={value} onChange={set} aria-label={c.label} />;
      default: return <TextInput value={value} onChange={set} aria-label={c.label} />;
    }
  };
  const showUsage = rows.some((r) => r.usage_count !== undefined);
  const minWidth = columns.reduce((sum, c) => sum + (c.width || 160), 0) + (showUsage ? 70 : 0) + 170;
  return (
    <div className="stack">
      {note && <div className="small muted">{note}</div>}
      <div className="table-wrap">
        <table className="t" style={{ minWidth }}>
          <thead><tr>{columns.map((c) => <th key={c.key} style={{ width: c.width || 160, minWidth: c.width || 160 }} className={c.num ? 'num' : ''}>{c.label}</th>)}{showUsage && <th className="num">Used by</th>}<th style={{ minWidth: 150 }} /></tr></thead>
          <tbody>
            {rows.length === 0 && !adding && <tr><td colSpan={columns.length + 2} className="muted">{emptyText}</td></tr>}
            {rows.map((r) => (
              <tr key={pk(r)} className={r.is_active === false ? 'dim' : ''}>
                {columns.map((c) => <td key={c.key}>{cell(c, r, val(r, c.key), (v) => setVal(r, c.key, v))}</td>)}
                {showUsage && <td className="num small">{r.usage_count ?? '—'}</td>}
                <td className="nowrap">
                  {dirty(r) && <><button className="btn sm primary" onClick={() => save(r)}>Save</button> <button className="btn sm ghost" onClick={() => setEdits((e) => { const n = { ...e }; delete n[pk(r)]; return n; })}>Undo</button></>}
                  {rowActions?.(r, data.reload)}
                  {canDelete && !dirty(r) && (r.usage_count ?? 0) === 0 && !r.is_system && <button className="btn sm ghost danger" onClick={() => remove(r)} title="Delete">Delete</button>}
                </td>
              </tr>
            ))}
            {adding && (
              <tr style={{ background: 'var(--brand-wash)' }}>
                {columns.map((c) => <td key={c.key}>{cell(c, adding, adding[c.key], (v) => setAdding((a) => ({ ...a, [c.key]: v })), true)}</td>)}
                {showUsage && <td />}
                <td className="nowrap"><button className="btn sm primary" onClick={create}>Add</button> <button className="btn sm ghost" onClick={() => setAdding(null)}>Cancel</button></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ErrorBox error={err} />
      {!adding && <div><button className="btn sm" onClick={() => setAdding({ is_active: true, ...defaults })}>{addLabel}</button></div>}
    </div>
  );
}

function JsonInput({ value, onChange }) {
  const [t, setT] = useState(value == null ? '' : JSON.stringify(value));
  const [bad, setBad] = useState(false);
  return <input value={t} aria-invalid={bad} style={bad ? { borderColor: 'var(--danger)' } : null} onChange={(e) => {
    setT(e.target.value);
    if (!e.target.value.trim()) { setBad(false); onChange(null); return; }
    try { onChange(JSON.parse(e.target.value)); setBad(false); } catch { setBad(true); }
  }} />;
}
