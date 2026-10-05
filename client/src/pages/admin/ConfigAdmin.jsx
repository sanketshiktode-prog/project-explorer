import { useState } from 'react';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { ErrorBox, Field, Loading, NumberInput, Select, TextInput, useAsync, useToast } from '../../components/ui.jsx';
import { formatBy, STATUS_LABEL } from '../../format.js';
import CrudTable from './CrudTable.jsx';
import { Head } from './Admin.jsx';

const ACTIVE = { key: 'is_active', label: 'Active', type: 'bool', width: 60 };
const ORDER = { key: 'sort_order', label: 'Order', type: 'int', width: 76 };
const FORMATS = ['inr', 'sqft', 'psf', 'year', 'floors', 'number'].map((x) => ({ value: x, label: x }));

export function FiltersAdmin() {
  const { reloadRef, ref } = useSession();
  const sources = useAsync(() => api.get('/api/admin/filter-sources'), []);
  if (sources.loading) return <Loading />;
  const srcOpts = (sources.data || []).map((s) => ({ value: s.key, label: `${s.label} [${s.level}]` }));
  const filterKeys = ref.filters.map((f) => ({ value: f.key, label: f.label }));
  return (
    <div>
      <Head title="Filters">Each row is one filter in the sales explorer. Add, rename, reorder, switch off, or point a filter at a different field — no code changes needed. To filter on a new field, first create it under Fields, then add a filter whose source is that field.</Head>
      <div className="notice info" style={{ marginBottom: 12 }}>
        <div><b>Control types:</b> multiselect / select for lists; range for numbers (shows bands + slider when a band set is chosen); bands for band chips only; toggle for yes/no.
          <b> Matching:</b> graded = configuration-level filters can produce partial matches; hard = only exact matches count.</div>
      </div>
      <CrudTable resource="filters" onChanged={reloadRef} addLabel="Add filter" sort={(a, b) => a.sort_order - b.sort_order}
        columns={[
          { key: 'label', label: 'Label', required: true, width: 150 },
          { key: 'key', label: 'Key', width: 120, editable: (r, n) => n },
          { key: 'source_key', label: 'Source', type: 'select', options: srcOpts, required: true, width: 220 },
          { key: 'control', label: 'Control', type: 'select', required: true, options: ['multiselect', 'select', 'range', 'bands', 'toggle'].map((x) => ({ value: x, label: x })), width: 120 },
          { key: 'match_mode', label: 'Matching', type: 'select', required: true, options: [{ value: 'graded', label: 'graded' }, { value: 'hard', label: 'hard' }], width: 100 },
          { key: 'depends_on', label: 'Depends on', type: 'select', options: filterKeys, width: 120 },
          { key: 'band_set_key', label: 'Band set', type: 'select', options: ref.band_sets.map((b) => ({ value: b.key, label: b.label })), width: 120 },
          { key: 'display_format', label: 'Format', type: 'select', options: FORMATS, width: 90 },
          { key: 'min_value', label: 'Min', type: 'number', width: 100 },
          { key: 'max_value', label: 'Max', type: 'number', width: 110 },
          { key: 'step', label: 'Step', type: 'number', width: 90 },
          ORDER,
          { key: 'is_primary', label: 'Open by default', type: 'bool', width: 70 },
          ACTIVE,
        ]} defaults={{ control: 'multiselect', match_mode: 'graded', sort_order: 200 }} />
    </div>
  );
}

export function BandsAdmin() {
  const { reloadRef, ref } = useSession();
  const [set, setSet] = useState('price');
  const [k, setK] = useState(0);
  const check = useAsync(() => api.get(`/api/admin/band-check/${set}`), [set, k]);
  const bs = ref.band_sets.find((b) => b.key === set);
  const fmt = (v) => (v == null ? 'open' : formatBy(bs?.display_format, v));
  return (
    <div className="stack">
      <Head title="Bands">Quick-pick ranges shown as chips above sliders. Bands are only labels over the stored numbers — a ₹1.35 Cr flat is stored as 13,500,000 and falls into whichever band covers it today. Lower bound is included, upper bound is not.</Head>
      <div className="row wrap">{ref.band_sets.map((b) => <button key={b.key} className="chip" aria-pressed={set === b.key} onClick={() => setSet(b.key)}>{b.label}</button>)}</div>
      {check.data?.length > 0 && <div className="notice warn"><div>{check.data.map((x, i) => <div key={i}>{x.message}</div>)}</div></div>}
      <CrudTable key={set} resource="bands" filter={(r) => r.band_set_key === set} defaults={{ band_set_key: set }} onChanged={() => { reloadRef(); setK((x) => x + 1); }} addLabel="Add band"
        sort={(a, b) => (a.lower_bound ?? -Infinity) - (b.lower_bound ?? -Infinity)}
        columns={[
          { key: 'label', label: 'Label', required: true },
          { key: 'lower_bound', label: `From (${bs?.unit || ''})`, type: 'number', width: 150 },
          { key: 'upper_bound', label: 'Up to (not incl.)', type: 'number', width: 150 },
          { key: 'preview', label: 'Means', type: 'readonly', render: (r) => <span className="small muted">{fmt(r.lower_bound)} ≤ value &lt; {fmt(r.upper_bound)}</span> },
          ORDER, ACTIVE,
        ]} />
      <details><summary className="small" style={{ cursor: 'pointer' }}>Band sets</summary>
        <div style={{ marginTop: 8 }}><CrudTable resource="band-sets" onChanged={reloadRef} addLabel="Add band set" columns={[{ key: 'label', label: 'Label', required: true }, { key: 'key', label: 'Key', editable: (r, n) => n }, { key: 'unit', label: 'Unit' }, { key: 'display_format', label: 'Format', type: 'select', options: FORMATS }]} /></div>
      </details>
    </div>
  );
}

export function FieldsAdmin() {
  const { reloadRef, ref } = useSession();
  const [entity, setEntity] = useState('project');
  const lists = ref.master_lists.map((l) => ({ value: l.key, label: l.name }));
  const types = ['text', 'longtext', 'number', 'integer', 'money', 'area', 'date', 'boolean', 'tristate', 'select', 'multiselect'].map((x) => ({ value: x, label: x }));
  const sections = ['identity', 'status', 'possession', 'configuration', 'tower', 'parking', 'amenities', 'location', 'land', 'developer', 'eoi', 'remarks', 'internal', 'other'].map((x) => ({ value: x, label: x }));
  const custom = (r, isNew) => isNew || r.storage === 'attribute';
  return (
    <div className="stack">
      <Head title="Fields">Labels, visibility and requirements for every field — plus custom fields you add yourself. Core fields (stored in their own database column) can be relabelled, hidden from the card, summary or detail view, or made required. Custom fields can be added without changing the database.</Head>
      <div className="notice info"><div>
        <b>Card</b> = quick project card in search results · <b>Summary</b> = snapshot at the top of the details panel · <b>Detail</b> = detailed overview · <b>Form</b> = data-entry wizard.
        To make a custom field filterable, add a filter in Filters with source “(custom field)”.
      </div></div>
      <div className="row">{['project', 'configuration', 'tower'].map((e) => <button key={e} className="chip" aria-pressed={entity === e} onClick={() => setEntity(e)}>{e}</button>)}</div>
      <CrudTable key={entity} resource="fields" filter={(r) => r.entity === entity} defaults={{ entity, data_type: 'text', section: entity === 'project' ? 'other' : entity, show_in_detail: true, show_in_form: true, sort_order: 900 }}
        onChanged={reloadRef} addLabel={`Add custom ${entity} field`} sort={(a, b) => a.sort_order - b.sort_order}
        columns={[
          { key: 'label', label: 'Label', required: true, width: 180 },
          { key: 'key', label: 'Key', width: 140, editable: (r, n) => n },
          { key: 'storage', label: 'Kind', type: 'readonly', width: 70, format: (v) => (v === 'attribute' ? 'custom' : v === 'column' ? 'core' : 'new') },
          { key: 'data_type', label: 'Type', type: 'select', options: types, editable: custom, width: 110 },
          { key: 'master_list_key', label: 'Options list', type: 'select', options: lists, editable: custom, width: 140 },
          { key: 'unit', label: 'Unit', editable: custom, width: 70 },
          { key: 'section', label: 'Section', type: 'select', options: sections, width: 110 },
          { key: 'show_in_card', label: 'Card', type: 'bool', width: 50 },
          { key: 'show_in_summary', label: 'Summary', type: 'bool', width: 60 },
          { key: 'show_in_detail', label: 'Detail', type: 'bool', width: 50 },
          { key: 'show_in_form', label: 'Form', type: 'bool', width: 50 },
          { key: 'is_required', label: 'Required', type: 'bool', width: 60 },
          ORDER, ACTIVE,
        ]} />
    </div>
  );
}

export function SettingsAdmin() {
  const { reloadRef } = useSession();
  const s = useAsync(() => api.get('/api/admin/settings'), []);
  if (s.loading) return <Loading />;
  const by = Object.fromEntries((s.data || []).map((x) => [x.key, x]));
  const props = { by, onSaved: () => { s.reload(); reloadRef(); } };
  return (
    <div className="stack">
      <Head title="Business rules">Rules the application follows. Changes apply immediately for everyone and are recorded in the audit log.</Head>
      <Setting k="matching" {...props} render={(v, set) => (
        <div className="grid c3">
          <Field label="Exact match means" help="How a configuration's price/area range must relate to the customer's range"><Select allowEmpty={false} value={v.range_exact_rule} onChange={(x) => set({ ...v, range_exact_rule: x })} options={[{ value: 'contained', label: 'Fully inside the requirement' }, { value: 'overlap', label: 'Any overlap' }]} /></Field>
          <Field label="Partial match tolerance" help="How far outside the requirement still counts as partial"><NumberInput unit="%" value={v.tolerance_pct} onChange={(x) => set({ ...v, tolerance_pct: x ?? 0 })} /></Field>
          <Field label="Configurations without price/area" help="Show as partial match, or leave out"><Select allowEmpty={false} value={v.missing_value} onChange={(x) => set({ ...v, missing_value: x })} options={[{ value: 'partial', label: 'Show as partial' }, { value: 'exclude', label: 'Exclude' }]} /></Field>
        </div>
      )} />
      <Setting k="psf_display_rule" {...props} render={(v, set) => (
        <Select allowEmpty={false} value={v} onChange={set} options={[{ value: 'developer_first', label: 'Developer figure if given, else calculated' }, { value: 'calculated_first', label: 'Calculated if possible, else developer' }, { value: 'developer_only', label: 'Developer figure only' }, { value: 'calculated_only', label: 'Calculated only' }]} />
      )} />
      <Setting k="stale_after_days" {...props} render={(v, set) => <div style={{ maxWidth: 200 }}><NumberInput integer unit="days" value={v} onChange={set} /></div>} />
      <Setting k="sales_visible_statuses" {...props} render={(v, set) => (
        <div className="chips">{Object.keys(STATUS_LABEL).map((st) => <button type="button" key={st} className="chip" aria-pressed={v.includes(st)} onClick={() => set(v.includes(st) ? v.filter((x) => x !== st) : [...v, st])}>{STATUS_LABEL[st]}</button>)}</div>
      )} />
      <Setting k="duplicate_detection" {...props} render={(v, set) => (
        <div className="grid c3">
          <Field label="Sensitivity threshold" help="0–1; lower flags more possible duplicates"><NumberInput value={v.threshold} onChange={(x) => set({ ...v, threshold: x })} /></Field>
          <Field label="Same-site radius"><NumberInput integer unit="m" value={v.radius_m} onChange={(x) => set({ ...v, radius_m: x })} /></Field>
        </div>
      )} />
      <Setting k="coordinate_sanity_km" {...props} render={(v, set) => <div style={{ maxWidth: 200 }}><NumberInput unit="km" value={v} onChange={set} /></div>} />
      <Setting k="psf_sanity" {...props} render={(v, set) => (
        <div className="grid c3"><Field label="Lowest plausible"><NumberInput unit="₹" value={v.min} onChange={(x) => set({ ...v, min: x })} /></Field><Field label="Highest plausible"><NumberInput unit="₹" value={v.max} onChange={(x) => set({ ...v, max: x })} /></Field></div>
      )} />
      <Setting k="map" {...props} render={(v, set) => (
        <div className="grid c2">
          <Field label="Tile URL" className="span-2"><TextInput value={v.tile_url} onChange={(x) => set({ ...v, tile_url: x })} /></Field>
          <Field label="Attribution" className="span-2"><TextInput value={v.attribution} onChange={(x) => set({ ...v, attribution: x })} /></Field>
          <Field label="Default centre (lat, lng)"><TextInput value={(v.default_center || []).join(', ')} onChange={(x) => set({ ...v, default_center: String(x || '').split(',').map((n) => Number(n.trim())).filter((n) => !Number.isNaN(n)) })} /></Field>
          <Field label="Default zoom"><NumberInput integer value={v.default_zoom} onChange={(x) => set({ ...v, default_zoom: x })} /></Field>
        </div>
      )} />
      <Setting k="project_id_format" {...props} render={(v, set) => (
        <div className="grid c3"><Field label="Prefix"><TextInput value={v.prefix} onChange={(x) => set({ ...v, prefix: (x || '').toUpperCase() })} /></Field><Field label="Digits"><NumberInput integer value={v.digits} onChange={(x) => set({ ...v, digits: x })} /></Field>
          <Field label="Example"><div style={{ padding: '7px 0' }}>{v.prefix}-MUM-{'1'.padStart(v.digits || 6, '0')}</div></Field></div>
      )} />
    </div>
  );
}

function Setting({ k, by, render, onSaved }) {
  const toast = useToast();
  const row = by[k];
  const [v, setV] = useState(row?.value);
  const [err, setErr] = useState(null);
  if (!row) return null;
  const dirty = JSON.stringify(v) !== JSON.stringify(row.value);
  return (
    <div className="panel panel-pad">
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
        <div className="grow"><h3>{row.label || k}</h3><div className="small muted" style={{ marginTop: 3, maxWidth: '75ch' }}>{row.description}</div></div>
        {dirty && <><button className="btn sm ghost" onClick={() => setV(row.value)}>Undo</button><button className="btn sm primary" onClick={async () => { setErr(null); try { await api.put(`/api/admin/settings/${k}`, { value: v }); toast('Rule saved'); onSaved(); } catch (e) { setErr(e); } }}>Save</button></>}
      </div>
      {render(v, setV)}
      <ErrorBox error={err} />
      {row.updated_by_name && <div className="help" style={{ marginTop: 6 }}>Last changed by {row.updated_by_name}</div>}
    </div>
  );
}
