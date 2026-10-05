// Generic, metadata-driven form building blocks for the data-entry wizard.
import { useCallback, useMemo, useState } from 'react';
import { api } from '../api.js';
import { masterOptions } from '../session.jsx';
import { DateInput, ErrorBox, Field, Modal, MoneyInput, NumberInput, Select, TextArea, TextInput, Tristate, useToast } from './ui.jsx';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Flatten a record into editable keys: column keys + attributes.<k> + states.<k>. */
export function flatten(values, attributes = {}, states = {}) {
  const o = { ...values };
  for (const [k, v] of Object.entries(attributes || {})) o[`attributes.${k}`] = v;
  for (const [k, v] of Object.entries(states || {})) o[`states.${k}`] = v;
  return o;
}

/** Track a draft against the last-saved original; produce {field:{from,to}} change sets. */
export function useDraft(initial) {
  const [original, setOriginal] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const set = useCallback((k, v) => setDraft((d) => {
    const n = { ...d, [k]: v };
    // Entering a value clears an N/A / Unknown marker for that field
    if (!k.includes('.') && v !== null && v !== undefined && v !== '' && n[`states.${k}`]) n[`states.${k}`] = null;
    return n;
  }), []);
  const dirtyKeys = useMemo(() => Object.keys(draft).filter((k) => !same(draft[k], original[k])), [draft, original]);
  const changes = useCallback((keys) => Object.fromEntries((keys || dirtyKeys).filter((k) => !same(draft[k], original[k])).map((k) => [k, { from: original[k] ?? null, to: draft[k] ?? null }])), [draft, original, dirtyKeys]);
  const reset = useCallback((o) => { setOriginal(o); setDraft(o); }, []);
  const accept = useCallback((saved) => { setOriginal((o) => ({ ...o, ...saved })); }, []);
  return { draft, original, set, dirtyKeys, dirty: dirtyKeys.length > 0, changes, reset, accept, setDraft, setOriginal };
}

/**
 * Save a change set; on 409 show both versions and let the user decide.
 * Returns the server response or null when the user cancels.
 */
export function useConflictSave() {
  const [conflict, setConflict] = useState(null);
  const save = useCallback(async (url, changes, extra = {}) => {
    try {
      return await api.patch(url, { changes, ...extra });
    } catch (e) {
      if (e.status !== 409 || !e.details?.conflicts) throw e;
      return new Promise((resolve, reject) => setConflict({ url, changes, extra, conflicts: e.details.conflicts, resolve, reject }));
    }
  }, []);
  const modal = conflict && (
    <ConflictModal c={conflict} onDone={async (choice) => {
      const c = conflict;
      setConflict(null);
      if (choice === 'cancel') return c.resolve(null);
      // keep mine: re-send with the server's current values as the new base
      const next = { ...c.changes };
      for (const x of c.conflicts) {
        if (choice === 'theirs') delete next[x.field];
        else next[x.field] = { from: x.theirs, to: x.yours };
      }
      try { c.resolve(Object.keys(next).length ? await api.patch(c.url, { changes: next, ...c.extra }) : { theirs: true }); } catch (e) { c.reject(e); }
    }} />
  );
  return { save, modal };
}

function ConflictModal({ c, onDone }) {
  const show = (v) => (v === null || v === undefined || v === '' ? <i className="muted">empty</i> : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return (
    <Modal title="Someone else changed this while you were editing" onClose={() => onDone('cancel')} wide
      footer={<>
        <button className="btn" onClick={() => onDone('cancel')}>Cancel</button>
        <button className="btn" onClick={() => onDone('theirs')}>Keep their version</button>
        <button className="btn primary" onClick={() => onDone('mine')}>Overwrite with mine</button>
      </>}>
      <p className="small">Your other changes are fine. These fields were changed by another user after you opened the project:</p>
      <div className="table-wrap"><table className="t"><thead><tr><th>Field</th><th>When you opened it</th><th>Their value (saved)</th><th>Your value</th></tr></thead>
        <tbody>{c.conflicts.map((x) => <tr key={x.field}><td><b>{x.field.replace(/^attributes\./, '').replace(/_id$/, '').replace(/_/g, ' ')}</b></td><td>{show(x.base)}</td><td className="diff-new">{show(x.theirs)}</td><td>{show(x.yours)}</td></tr>)}</tbody>
      </table></div>
    </Modal>
  );
}

/** Options for a select-type field definition. */
export function optionsForField(f, ref, draft = {}) {
  if (f.key === 'developer_id') return ref.developers.filter((d) => d.is_active || d.id === draft.developer_id).map((d) => ({ value: d.id, label: d.name }));
  if (f.key === 'city_id') return ref.cities.filter((c) => c.is_active || c.id === draft.city_id).map((c) => ({ value: c.id, label: c.name }));
  if (f.key === 'location_id') return ref.locations.filter((l) => (!draft.city_id || l.city_id === draft.city_id) && (l.is_active || l.id === draft.location_id)).map((l) => ({ value: l.id, label: l.name }));
  if (f.key === 'sub_location_id') return ref.sub_locations.filter((s) => (!draft.location_id || s.location_id === draft.location_id) && (s.is_active || s.id === draft.sub_location_id)).map((s) => ({ value: s.id, label: s.name }));
  if (f.key === 'config_type_id') return ref.configuration_types.filter((c) => c.is_active || c.id === draft.config_type_id).map((c) => ({ value: c.id, label: c.label }));
  if (f.key === 'psf_basis') return [{ value: 'carpet', label: 'Carpet area' }, { value: 'sbua', label: 'Super built-up area' }];
  if (f.master_list_key) return masterOptions(ref, f.master_list_key, draft[f.storage === 'attribute' ? `attributes.${f.key}` : f.key]);
  return [];
}

export function isVisible(f, draft, ref) {
  const w = f.visible_when;
  if (!w) return true;
  const v = draft[w.field];
  if (w.in) return w.in.includes(v);
  if (w.not_codes) { const code = ref.master_values.find((m) => m.id === v)?.code; return !w.not_codes.includes(code); }
  return true;
}

/** One input for one field definition, bound to a draft. */
export function FieldInput({ f, draft, set, rd, errors, states = true, className, inputProps = {} }) {
  const key = f.storage === 'attribute' ? `attributes.${f.key}` : f.key;
  const value = draft[key];
  const stateKey = `states.${f.key}`;
  const allowStates = states && !f.is_required && !['boolean', 'tristate'].includes(f.data_type);
  const onChange = (v) => set(key, v);
  let input;
  switch (f.data_type) {
    case 'longtext': input = <TextArea value={value} onChange={onChange} rows={3} {...inputProps} />; break;
    case 'number': case 'integer': case 'area': input = <NumberInput value={value} onChange={onChange} integer={f.data_type === 'integer'} unit={f.unit} {...inputProps} />; break;
    case 'money': input = <MoneyInput value={value} onChange={onChange} {...inputProps} />; break;
    case 'date': input = <DateInput value={value} onChange={onChange} month={/possession/.test(f.key)} {...inputProps} />; break;
    case 'boolean': input = <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{f.help_text || 'Yes'}</label>; break;
    case 'tristate': input = <Tristate value={value} onChange={onChange} />; break;
    case 'select': input = <Select value={value} onChange={onChange} options={optionsForField(f, rd, draft)} {...inputProps} />; break;
    case 'multiselect': {
      const opts = optionsForField(f, rd, draft);
      const sel = value || [];
      input = <div className="chips">{opts.map((o) => <button type="button" key={o.value} className="chip" aria-pressed={sel.includes(o.value)} onClick={() => onChange(sel.includes(o.value) ? sel.filter((x) => x !== o.value) : [...sel, o.value])}>{o.label}</button>)}</div>;
      break;
    }
    default: input = <TextInput value={value} onChange={onChange} {...inputProps} />;
  }
  const disabled = draft[stateKey] && (value === null || value === undefined);
  return (
    <Field label={f.label} required={f.is_required} help={f.data_type !== 'boolean' ? f.help_text : null} error={errors?.[key]} className={className}
      allowStates={allowStates} state={draft[stateKey]} onState={(s) => { set(stateKey, s); if (s) set(key, null); }}>
      <div style={disabled ? { opacity: 0.5 } : null}>{input}</div>
    </Field>
  );
}

/** Render all active custom (attribute) fields for an entity + sections. */
export function CustomFields({ rd, entity, sections, draft, set }) {
  const fs = rd.fields.filter((f) => f.entity === entity && f.storage === 'attribute' && f.is_active && f.show_in_form && (!sections || sections.includes(f.section)));
  if (!fs.length) return null;
  return <div className="grid c2" style={{ marginTop: 14 }}>{fs.map((f) => <FieldInput key={f.key} f={f} draft={draft} set={set} rd={rd} />)}</div>;
}

/** Core field definition lookup with a safe fallback. */
export function coreField(ref, entity, key, fallback = {}) {
  return ref.fields.find((f) => f.entity === entity && f.key === key) || { entity, key, label: key, data_type: 'text', storage: 'column', ...fallback };
}

/**
 * Generic editor for small child collections (highlights, payment plans, offers, objections, RERA).
 * columns: [{ key, label, type: 'text'|'longtext'|'date'|'int'|'number'|'select'|'tags', options, span }]
 */
export function ListEditor({ projectId, seg, items, columns, onChanged, defaults = {}, addLabel = 'Add', empty = 'Nothing added yet.', itemTitle }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  return (
    <div>
      {items.length === 0 && !adding && <div className="small muted" style={{ marginBottom: 8 }}>{empty}</div>}
      {items.map((it) => <ListItem key={it.id} it={it} seg={seg} projectId={projectId} columns={columns} onChanged={onChanged} toast={toast} title={itemTitle?.(it)} />)}
      {adding ? <ListItem it={{ ...defaults }} isNew seg={seg} projectId={projectId} columns={columns} onChanged={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} toast={toast} />
        : <button type="button" className="btn sm" onClick={() => setAdding(true)}>{addLabel}</button>}
    </div>
  );
}

function ListItem({ it, isNew, seg, projectId, columns, onChanged, onCancel, toast, title }) {
  const init = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, it[c.key] ?? null])), [it, columns]);
  const d = useDraft(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const { save, modal } = useConflictSave();
  const inactive = it.is_active === false;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      if (isNew) {
        await api.post(`/api/manage/projects/${projectId}/${seg}`, { values: d.draft });
        toast('Added');
      } else {
        const r = await save(`/api/manage/projects/${projectId}/${seg}/${it.id}`, d.changes());
        if (!r) { setBusy(false); return; }
        toast('Saved');
      }
      onChanged();
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm('Remove this item? It stays in the change history.')) return;
    try { await api.del(`/api/manage/projects/${projectId}/${seg}/${it.id}`); toast('Removed'); onChanged(); } catch (e) { setErr(e); }
  };
  const restore = async () => { try { await api.patch(`/api/manage/projects/${projectId}/${seg}/${it.id}`, { changes: { is_active: { to: true } } }); onChanged(); } catch (e) { setErr(e); } };
  return (
    <div className="listedit-item" style={inactive ? { opacity: 0.6 } : null}>
      {modal}
      {title && <div className="row"><b className="small">{title}</b>{inactive && <span className="badge">Removed</span>}</div>}
      <div className="grid c4">
        {columns.map((c) => {
          const v = d.draft[c.key];
          const set = (x) => d.set(c.key, x);
          let input;
          if (c.type === 'longtext') input = <TextArea value={v} onChange={set} rows={2} disabled={inactive} />;
          else if (c.type === 'date') input = <DateInput value={v} onChange={set} disabled={inactive} />;
          else if (c.type === 'int' || c.type === 'number') input = <NumberInput value={v} onChange={set} integer={c.type === 'int'} unit={c.unit} disabled={inactive} />;
          else if (c.type === 'select') input = <Select value={v} onChange={set} options={c.options} allowEmpty={!c.required} disabled={inactive} />;
          else if (c.type === 'tags') input = <TextInput value={Array.isArray(v) ? v.join(', ') : v} onChange={(x) => set(x ? x.split(',').map((s) => s.trim()).filter(Boolean) : [])} placeholder="comma, separated" disabled={inactive} />;
          else input = <TextInput value={v} onChange={set} disabled={inactive} placeholder={c.placeholder} />;
          return <Field key={c.key} label={c.label} required={c.required} className={c.span ? `span-${c.span}` : ''}>{input}</Field>;
        })}
      </div>
      <ErrorBox error={err} />
      <div className="row">
        {(isNew || d.dirty) && !inactive && <button className="btn sm primary" disabled={busy} onClick={submit}>{isNew ? 'Add' : 'Save'}</button>}
        {d.dirty && !isNew && <button className="btn sm ghost" onClick={() => d.reset(init)}>Undo</button>}
        {isNew && <button className="btn sm ghost" onClick={onCancel}>Cancel</button>}
        <div className="grow" />
        {!isNew && !inactive && <button className="btn sm ghost danger" onClick={remove}>Remove</button>}
        {inactive && <button className="btn sm" onClick={restore}>Restore</button>}
      </div>
    </div>
  );
}

export { same };
