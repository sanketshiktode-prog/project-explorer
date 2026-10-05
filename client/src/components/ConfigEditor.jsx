import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { CustomFields, FieldInput, coreField, flatten, useConflictSave, useDraft } from './FormKit.jsx';
import { ErrorBox, Field, useToast } from './ui.jsx';
import { inr, inrRange, psf, sqft } from '../format.js';

const KEYS = ['config_type_id', 'variant', 'carpet_from', 'carpet_to', 'sbua_from', 'sbua_to', 'price_from', 'price_to', 'price_on_request', 'dev_psf', 'psf_basis', 'parking_count', 'parking_remarks', 'inventory_status_id', 'inventory_details', 'inventory_remarks', 'remarks', 'sort_order'];

export default function ConfigEditor({ projectId, configs, towers, rd, onChanged }) {
  const [open, setOpen] = useState(null); // id | 'new'
  const [copyFrom, setCopyFrom] = useState(null);
  const active = configs.filter((c) => c.is_active);
  const inactive = configs.filter((c) => !c.is_active);
  return (
    <div>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table className="t">
          <thead><tr><th>Configuration</th><th className="num">Carpet</th><th className="num">Price</th><th className="num">₹/sq.ft.</th><th>Inventory</th><th /></tr></thead>
          <tbody>
            {active.length === 0 && <tr><td colSpan={6} className="muted">No configurations yet. A project cannot match budget searches until you add them.</td></tr>}
            {[...active, ...inactive].map((c) => (
              <ConfigRow key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} projectId={projectId} towers={towers} rd={rd}
                onChanged={() => { onChanged(); }} onCopy={() => { setCopyFrom(c); setOpen('new'); }} />
            ))}
          </tbody>
        </table>
      </div>
      {open === 'new' ? (
        <div className="panel panel-pad">
          <h4 style={{ marginBottom: 10 }}>{copyFrom ? `New configuration (copied from ${copyFrom.type})` : 'New configuration'}</h4>
          <ConfigForm projectId={projectId} c={copyFrom ? { ...copyFrom, id: undefined, tower_ids: copyFrom.tower_ids } : null} towers={towers} rd={rd}
            onDone={() => { setOpen(null); setCopyFrom(null); onChanged(); }} onCancel={() => { setOpen(null); setCopyFrom(null); }} />
        </div>
      ) : <button className="btn primary" onClick={() => { setCopyFrom(null); setOpen('new'); }}>Add configuration</button>}
    </div>
  );
}

function ConfigRow({ c, open, onToggle, projectId, towers, rd, onChanged, onCopy }) {
  const toast = useToast();
  const discontinue = async () => {
    const reason = window.prompt(`Discontinue ${c.type}${c.variant ? ` (${c.variant})` : ''}? It will stop appearing in searches but stays in history.\n\nReason (optional):`);
    if (reason === null) return;
    await api.del(`/api/manage/projects/${projectId}/configurations/${c.id}`, { reason });
    toast('Configuration discontinued');
    onChanged();
  };
  const restore = async () => { await api.patch(`/api/manage/projects/${projectId}/configurations/${c.id}`, { changes: { is_active: { to: true } } }); toast('Configuration restored'); onChanged(); };
  return (
    <>
      <tr className={`clickable ${c.is_active ? '' : 'dim'}`} onClick={onToggle}>
        <td><b>{c.type}</b>{c.variant && <span className="muted"> {c.variant}</span>}{!c.is_active && <span className="badge" style={{ marginLeft: 6 }}>Discontinued</span>}
          {c.attributes?.balcony === 'yes' && <span className="small muted"> · balcony</span>}</td>
        <td className="num">{sqft(c.carpet_from, c.carpet_to)}</td>
        <td className="num">{c.price_on_request ? 'On request' : inrRange(c.price_from, c.price_to)}</td>
        <td className="num">{c.psf ? psf(c.psf.value) : '—'}{c.dev_psf && c.calc_psf && <div className="small muted">calc {psf(c.calc_psf)}</div>}</td>
        <td>{c.inventory_status || <span className="muted">—</span>}</td>
        <td className="num" onClick={(e) => e.stopPropagation()}>
          <button className="btn sm ghost" onClick={onToggle}>{open ? 'Close' : 'Edit'}</button>
          {c.is_active ? <><button className="btn sm ghost" onClick={onCopy} title="Copy into a new configuration">Copy</button><button className="btn sm ghost danger" onClick={discontinue}>Discontinue</button></> : <button className="btn sm" onClick={restore}>Restore</button>}
        </td>
      </tr>
      {open && c.is_active && (
        <tr><td colSpan={6} style={{ background: 'var(--sunken)' }}>
          <ConfigForm projectId={projectId} c={c} towers={towers} rd={rd} onDone={() => { onToggle(); onChanged(); }} onCancel={onToggle} />
        </td></tr>
      )}
    </>
  );
}

function ConfigForm({ projectId, c, towers, rd, onDone, onCancel }) {
  const toast = useToast();
  const isNew = !c?.id;
  const init = useMemo(() => {
    const v = Object.fromEntries(KEYS.map((k) => [k, c?.[k] ?? null]));
    if (!v.psf_basis) v.psf_basis = 'carpet';
    if (!v.price_on_request) v.price_on_request = false;
    return flatten(v, c?.attributes, c?.field_states);
  }, [c]);
  const d = useDraft(init);
  const [towerIds, setTowerIds] = useState(c?.tower_ids || []);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const { save, modal } = useConflictSave();
  const f = (k) => coreField(rd, 'configuration', k);
  const v = d.draft;
  const errors = {};
  if (v.price_from && v.price_to && v.price_from > v.price_to) errors.price_to = 'Price To is lower than Price From';
  if (v.carpet_from && v.carpet_to && v.carpet_from > v.carpet_to) errors.carpet_to = 'Carpet To is lower than Carpet From';
  if (v.sbua_from && v.sbua_to && v.sbua_from > v.sbua_to) errors.sbua_to = 'Lower than Super Built-up From';
  const mid = (a, b) => (a == null && b == null ? null : ((a ?? b) + (b ?? a)) / 2);
  const area = v.psf_basis === 'sbua' ? mid(v.sbua_from, v.sbua_to) : mid(v.carpet_from, v.carpet_to);
  const price = v.price_on_request ? null : mid(v.price_from, v.price_to);
  const calc = price && area ? Math.round(price / area) : null;
  const typeLabel = rd.configuration_types.find((t) => t.id === v.config_type_id)?.area_label || 'Carpet';
  const towersChanged = JSON.stringify([...towerIds].sort()) !== JSON.stringify([...(c?.tower_ids || [])].sort());

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      let id = c?.id;
      if (isNew) {
        const values = Object.fromEntries(Object.entries(v).filter(([k]) => !k.includes('.')));
        const attributes = Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('attributes.')).map(([k, x]) => [k.slice(11), x]));
        const states = Object.fromEntries(Object.entries(v).filter(([k, x]) => k.startsWith('states.') && x).map(([k, x]) => [k.slice(7), x]));
        const r = await api.post(`/api/manage/projects/${projectId}/configurations`, { values, attributes, states });
        id = r.row.id;
      } else if (d.dirty) {
        const r = await save(`/api/manage/projects/${projectId}/configurations/${id}`, d.changes());
        if (!r) { setBusy(false); return; }
      }
      if (towersChanged || (isNew && towerIds.length)) await api.put(`/api/manage/projects/${projectId}/configurations/${id}/towers`, { tower_ids: towerIds });
      toast(isNew ? 'Configuration added' : 'Configuration saved');
      onDone();
    } catch (e) { setErr(e); }
    setBusy(false);
  };

  return (
    <div className="stack" style={{ padding: '6px 2px' }}>
      {modal}
      <div className="grid c3">
        <FieldInput f={f('config_type_id')} draft={v} set={d.set} rd={rd} states={false} />
        <FieldInput f={f('variant')} draft={v} set={d.set} rd={rd} states={false} inputProps={{ placeholder: 'e.g. Type B, with balcony' }} />
        <FieldInput f={{ ...f('carpet_from'), label: `${typeLabel} from` }} draft={v} set={d.set} rd={rd} />
        <FieldInput f={{ ...f('carpet_to'), label: `${typeLabel} to` }} draft={v} set={d.set} rd={rd} errors={errors} states={false} />
        <FieldInput f={f('sbua_from')} draft={v} set={d.set} rd={rd} />
        <FieldInput f={f('sbua_to')} draft={v} set={d.set} rd={rd} errors={errors} states={false} />
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={!!v.price_on_request} onChange={(e) => { d.set('price_on_request', e.target.checked); }} />Price on request</label>
        </div>
        {!v.price_on_request && <>
          <FieldInput f={f('price_from')} draft={v} set={d.set} rd={rd} />
          <FieldInput f={f('price_to')} draft={v} set={d.set} rd={rd} errors={errors} states={false} />
        </>}
        <FieldInput f={f('dev_psf')} draft={v} set={d.set} rd={rd} states={false} />
        <FieldInput f={f('psf_basis')} draft={v} set={d.set} rd={rd} states={false} />
        <Field label="Calculated ₹/sq.ft." help="Price ÷ area on the chosen basis. The developer figure is never overwritten.">
          <div style={{ padding: '7px 0', fontWeight: 600 }}>{calc ? psf(calc) : '—'}{calc && v.dev_psf && Math.abs(calc - v.dev_psf) / v.dev_psf > 0.25 && <span className="badge partial" style={{ marginLeft: 6 }}>Differs from developer</span>}</div>
        </Field>
        <FieldInput f={f('parking_count')} draft={v} set={d.set} rd={rd} />
        <FieldInput f={f('parking_remarks')} draft={v} set={d.set} rd={rd} states={false} />
        <FieldInput f={f('inventory_status_id')} draft={v} set={d.set} rd={rd} states={false} />
        <FieldInput f={f('inventory_details')} draft={v} set={d.set} rd={rd} states={false} className="span-2" />
        <FieldInput f={f('inventory_remarks')} draft={v} set={d.set} rd={rd} states={false} className="span-2" />
        <FieldInput f={f('remarks')} draft={v} set={d.set} rd={rd} states={false} className="span-2" />
      </div>
      <CustomFields rd={rd} entity="configuration" draft={v} set={d.set} />
      {towers.filter((t) => t.is_active).length > 0 && (
        <Field label="Available in towers" help="Leave all unticked if this configuration is available in every tower.">
          <div className="chips">
            {towers.filter((t) => t.is_active).map((t) => (
              <button type="button" key={t.id} className="chip" aria-pressed={towerIds.includes(t.id)} onClick={() => setTowerIds((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>{t.name}</button>
            ))}
          </div>
        </Field>
      )}
      <ErrorBox error={err} />
      <div className="row">
        <button className="btn primary" disabled={busy || Object.keys(errors).length > 0 || !v.config_type_id || (!isNew && !d.dirty && !towersChanged)} onClick={submit}>{isNew ? 'Add configuration' : 'Save configuration'}</button>
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        {price && <span className="small muted">{inr(price)}{area ? ` for ${Math.round(area)} sq.ft.` : ''}</span>}
      </div>
    </div>
  );
}
