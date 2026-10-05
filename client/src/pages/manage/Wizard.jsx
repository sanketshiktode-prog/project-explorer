import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { masterOptions, useSession } from '../../session.jsx';
import { CustomFields, FieldInput, ListEditor, coreField, flatten, isVisible, useConflictSave, useDraft } from '../../components/FormKit.jsx';
import ConfigEditor from '../../components/ConfigEditor.jsx';
import TowerEditor from '../../components/TowerEditor.jsx';
import MapPicker from '../../components/MapPicker.jsx';
import { Confirm, ErrorBox, Field, Loading, Modal, Seg, StatusBadge, TextInput, useAsync, useDebounced, useToast } from '../../components/ui.jsx';
import { ago, date, STATUS_LABEL } from '../../format.js';

export const STEPS = [
  { key: 'identity', label: 'Project identity', sections: ['identity'] },
  { key: 'status', label: 'Status & possession', sections: ['status', 'possession'] },
  { key: 'configurations', label: 'Configurations' },
  { key: 'towers', label: 'Towers' },
  { key: 'parking', label: 'Parking', sections: ['parking'] },
  { key: 'amenities', label: 'Amenities & USPs', sections: ['amenities'] },
  { key: 'location', label: 'Location', sections: ['location'] },
  { key: 'commercial', label: 'Commercial information', sections: ['land', 'developer', 'remarks', 'internal', 'other'] },
  { key: 'eoi', label: 'EOI, offers & objections', sections: ['eoi'] },
  { key: 'review', label: 'Review & submit' },
];
const STEP_OF_SECTION = { identity: 'identity', status: 'status', possession: 'status', configurations: 'configurations', towers: 'towers', parking: 'parking', amenities: 'amenities', location: 'location', land: 'commercial', developer: 'commercial', remarks: 'commercial', internal: 'commercial', eoi: 'eoi' };

export default function Wizard() {
  const { id } = useParams();
  return id ? <EditProject id={id} key={id} /> : <NewProject />;
}

// ---------------------------------------------------------------------------------------------
// New project: identity first, with duplicate prevention
// ---------------------------------------------------------------------------------------------
function NewProject() {
  const { ref: rd, reloadRef } = useSession();
  const nav = useNavigate();
  const d = useDraft({ name: null, developer_id: null, city_id: null, location_id: null, sub_location_id: null });
  const [dups, setDups] = useState([]);
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const v = d.draft;
  const probe = useDebounced(JSON.stringify(v), 500);
  useEffect(() => {
    if (!v.name || v.name.length < 3) { setDups([]); return; }
    api.post('/api/manage/projects/check-duplicates', v).then((r) => setDups(r.candidates)).catch(() => {});
  }, [probe]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (confirm, reason) => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/api/manage/projects', { values: v, confirm_not_duplicate: !!confirm, duplicate_reason: reason });
      nav(`/manage/${r.id}?step=status`, { replace: true });
    } catch (e) {
      if (e.status === 409 && e.body?.candidates) setModal(e.body.candidates);
      else setErr(e);
    }
    setBusy(false);
  };
  const f = (k) => coreField(rd, 'project', k);
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-head"><div><h1>New project</h1><p className="lede">Start with who and where. The system checks for existing projects before creating one; everything else can be added step by step afterwards.</p></div></div>
      <div className="panel panel-pad stack">
        <div className="grid c2">
          <FieldInput f={f('name')} draft={v} set={d.set} rd={rd} inputProps={{ autoFocus: true, placeholder: 'Marketing name of the project' }} />
          <DeveloperField v={v} set={d.set} rd={rd} reloadRef={reloadRef} />
          <FieldInput f={f('city_id')} draft={v} set={(k, x) => { d.set(k, x); d.set('location_id', null); d.set('sub_location_id', null); }} rd={rd} />
          <FieldInput f={f('location_id')} draft={v} set={(k, x) => { d.set(k, x); d.set('sub_location_id', null); }} rd={rd} states={false} />
          <FieldInput f={f('sub_location_id')} draft={v} set={d.set} rd={rd} states={false} />
        </div>
        {dups.length > 0 && (
          <div className="notice warn"><div>
            <b>Possible existing project{dups.length > 1 ? 's' : ''}:</b>
            <ul className="bul" style={{ marginTop: 4 }}>{dups.map((x) => <li key={x.id}><Link to={`/manage/${x.id}`}>{x.name}</Link> — {[x.developer, x.sub_location || x.location].filter(Boolean).join(', ')} <span className="muted">({x.reasons.join(', ')})</span></li>)}</ul>
          </div></div>
        )}
        <ErrorBox error={err} />
        <div className="row"><button className="btn primary" disabled={busy || !v.name || !v.city_id} onClick={() => create(false)}>Create project</button><Link className="btn ghost" to="/manage">Cancel</Link>
          <span className="small muted">A permanent ID (e.g. PRJ-MUM-000123) is assigned when you create it. It never changes, even if the project is renamed.</span></div>
      </div>
      {modal && <DuplicateModal candidates={modal} onClose={() => setModal(null)} onContinue={(reason) => { setModal(null); create(true, reason); }} />}
    </div>
  );
}

function DuplicateModal({ candidates, onClose, onContinue }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="This project may already exist" onClose={onClose} wide sub="Never create a second record for the same project — open the existing one instead."
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={!reason.trim()} onClick={() => onContinue(reason)}>Create anyway</button></>}>
      <div className="table-wrap" style={{ marginBottom: 12 }}><table className="t"><thead><tr><th>Existing project</th><th>Developer</th><th>Location</th><th>Why it matched</th><th /></tr></thead>
        <tbody>{candidates.map((c) => <tr key={c.id}><td><b>{c.name}</b><div className="small muted">{c.public_id} · {STATUS_LABEL[c.record_status]}</div></td><td>{c.developer}</td><td>{c.sub_location || c.location}</td><td className="small">{c.reasons.join(', ')}</td><td><Link className="btn sm primary" to={`/manage/${c.id}`}>Open existing</Link></td></tr>)}</tbody></table></div>
      <Field label="If this is genuinely a different project, say why (kept in the audit log)" required>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Different phase with its own RERA registration" />
      </Field>
    </Modal>
  );
}

function DeveloperField({ v, set, rd, reloadRef }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [similar, setSimilar] = useState(null);
  const [err, setErr] = useState(null);
  const add = async (confirm) => {
    setErr(null);
    try {
      const d = await api.post('/api/manage/projects/developers', { name, confirm_not_duplicate: confirm });
      await reloadRef();
      set('developer_id', d.id);
      setAdding(false); setName(''); setSimilar(null);
    } catch (e) {
      if (e.status === 409 && e.body?.candidates) setSimilar({ exists: e.body.code === 'exists', list: e.body.candidates, msg: e.message });
      else setErr(e);
    }
  };
  return (
    <div>
      <FieldInput f={coreField(rd, 'project', 'developer_id')} draft={v} set={set} rd={rd} />
      <button type="button" className="linkbtn small" style={{ marginTop: 4 }} onClick={() => setAdding(true)}>Developer not listed?</button>
      {adding && (
        <Modal title="Add a developer" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => add(false)}>Add developer</button></>}>
          <div className="stack">
            <Field label="Developer name" required><TextInput value={name} onChange={(x) => { setName(x ?? ''); setSimilar(null); }} autoFocus /></Field>
            {similar && (
              <div className="notice warn"><div className="grow">
                <b>{similar.msg}</b>
                <div className="stack" style={{ gap: 4, marginTop: 6 }}>{similar.list.map((s) => <div key={s.id} className="row"><span className="grow">{s.name}</span><button className="btn sm" onClick={() => { set('developer_id', s.id); setAdding(false); }}>Use this one</button></div>)}</div>
                {!similar.exists && <button className="btn sm danger" style={{ marginTop: 8 }} onClick={() => add(true)}>It is a different developer — add anyway</button>}
              </div></div>
            )}
            <ErrorBox error={err} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Edit an existing project
// ---------------------------------------------------------------------------------------------
function EditProject({ id }) {
  const { ref: rd, reloadRef, can } = useSession();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const step = sp.get('step') || 'identity';
  const setStep = (s) => { setSp({ step: s }, { replace: true }); window.scrollTo(0, 0); document.querySelector('.main')?.scrollTo(0, 0); };
  const p = useAsync(() => api.get(`/api/manage/projects/${id}`), [id]);
  const init = useMemo(() => (p.data ? flatten(p.data.values, p.data.attributes, p.data.field_states) : {}), [p.data]);
  const d = useDraft({});
  const [loadedVersion, setLoadedVersion] = useState(null);
  const [validation, setValidation] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const { save, modal } = useConflictSave();

  // Keep unsaved edits when the project is reloaded after child changes
  useEffect(() => {
    if (!p.data) return;
    setValidation(p.data.validation || []);
    if (loadedVersion === null) { d.reset(init); setLoadedVersion(p.data.row_version); return; }
    const keep = Object.fromEntries(d.dirtyKeys.map((k) => [k, d.draft[k]]));
    d.setOriginal(init);
    d.setDraft({ ...init, ...keep });
  }, [p.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e) => { if (d.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [d.dirty]);

  const reload = useCallback(async () => { await p.reload(); }, [p]);
  const saveFields = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await save(`/api/manage/projects/${id}`, d.changes());
      if (r) {
        toast(r.theirs ? 'Kept the other user’s version' : 'Saved');
        if (r.validation) setValidation(r.validation);
        const fresh = await p.reload();
        if (fresh) { const o = flatten(fresh.values, fresh.attributes, fresh.field_states); d.reset(o); }
      }
    } catch (e) { setErr(e); }
    setBusy(false);
  };

  if (p.loading && !p.data) return <Loading />;
  if (p.error) return <div className="page"><ErrorBox error={p.error} onRetry={p.reload} /></div>;
  const P = p.data;
  const locked = ['archived', 'inactive'].includes(P.record_status);
  const editable = can('project.edit') && !locked;
  const v = d.draft;
  const props = { P, v, set: d.set, rd, reload, editable, reloadRef, id };
  const flags = Object.fromEntries(STEPS.map((s) => [s.key, { e: 0, w: 0 }]));
  for (const x of validation) { const s = STEP_OF_SECTION[x.step] || 'review'; if (flags[s]) { if (x.level === 'error') flags[s].e += 1; else if (x.level === 'warning') flags[s].w += 1; } }
  const idx = STEPS.findIndex((s) => s.key === step);
  const fieldSteps = ['identity', 'status', 'towers', 'parking', 'amenities', 'location', 'commercial', 'eoi'];

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      {modal}
      <div className="page-head">
        <div className="grow">
          <div className="row wrap" style={{ marginBottom: 4 }}><StatusBadge status={P.record_status} /><span className="small muted">{P.public_id}</span>{P.status_reason && <span className="small muted">— {P.status_reason}</span>}</div>
          <h1>{P.name}</h1>
          <div className="small muted">{[P.developer?.name, P.sub_location?.name, P.location?.name, P.city?.name].filter(Boolean).join(', ')} · updated {ago(P.freshness.updated_at)}{P.freshness.updated_by ? ` by ${P.freshness.updated_by}` : ''}</div>
        </div>
        <div className="row">
          {['published', 'needs_update'].includes(P.record_status) && <Link className="btn" to={`/p/${P.public_id}`}>View as sales</Link>}
          <Link className="btn ghost" to="/manage">All projects</Link>
        </div>
      </div>
      {locked && <div className="notice warn" style={{ marginBottom: 14 }}>This project is {P.record_status}. Restore it from “Review &amp; submit” to edit.</div>}
      {['published', 'needs_update'].includes(P.record_status) && editable && <div className="notice info" style={{ marginBottom: 14 }}>This project is live. Saved changes are visible to sales immediately and are flagged for re-verification.</div>}
      <div className={`wiz ${['configurations', 'towers'].includes(step) ? 'wide' : ''}`}>
        <nav className="steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s.key} aria-current={s.key === step ? 'step' : undefined} onClick={() => setStep(s.key)}>
              <span className="n">{i + 1}</span><span>{s.label}</span>
              <span className={`flag ${flags[s.key].e ? 'e' : 'w'}`}>{flags[s.key].e ? `${flags[s.key].e}✕` : flags[s.key].w ? `${flags[s.key].w}!` : ''}</span>
            </button>
          ))}
        </nav>
        <div className="wiz-main">
          <div className="panel panel-pad">
            <h2 style={{ marginBottom: 14 }}>{STEPS[idx]?.label}</h2>
            <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {step === 'identity' && <IdentityStep {...props} />}
              {step === 'status' && <StatusStep {...props} />}
              {step === 'configurations' && <ConfigEditor projectId={P.id} configs={P.configurations} towers={P.towers} rd={rd} onChanged={reload} />}
              {step === 'towers' && <TowersStep {...props} />}
              {step === 'parking' && <ParkingStep {...props} />}
              {step === 'amenities' && <AmenitiesStep {...props} />}
              {step === 'location' && <LocationStep {...props} />}
              {step === 'commercial' && <CommercialStep {...props} />}
              {step === 'eoi' && <EoiStep {...props} />}
            </fieldset>
            {step === 'review' && <ReviewStep {...props} validation={validation} onStatus={reload} setStep={setStep} dirty={d.dirty} />}
          </div>
          <div className="wiz-foot">
            {fieldSteps.includes(step) && editable && <>
              <button className="btn primary" disabled={!d.dirty || busy} onClick={saveFields}>{busy ? 'Saving…' : `Save changes${d.dirty ? ` (${d.dirtyKeys.length})` : ''}`}</button>
              {d.dirty && <button className="btn ghost" onClick={() => d.reset(d.original)}>Discard</button>}
              {d.dirty && <span className="savebar"><span className="dirty-dot" /> Unsaved changes — they are kept while you move between steps.</span>}
            </>}
            <div className="grow" />
            {idx > 0 && <button className="btn" onClick={() => setStep(STEPS[idx - 1].key)}>Previous</button>}
            {idx < STEPS.length - 1 && <button className="btn" onClick={() => setStep(STEPS[idx + 1].key)}>Next: {STEPS[idx + 1].label}</button>}
          </div>
          <ErrorBox error={err} />
        </div>
        <aside className="wiz-side">
          <ValidationPanel validation={validation} setStep={setStep} />
        </aside>
      </div>
    </div>
  );
}

function ValidationPanel({ validation, setStep }) {
  const n = (l) => validation.filter((x) => x.level === l).length;
  return (
    <div className="panel panel-pad">
      <h4 style={{ marginBottom: 8 }}>Checks</h4>
      <div className="row wrap" style={{ marginBottom: 8 }}>
        <span className="badge danger">{n('error')} to fix</span><span className="badge partial">{n('warning')} unusual</span><span className="badge info">{n('info')} missing</span>
      </div>
      {validation.length === 0 ? <div className="small muted">Nothing to flag.</div> : (
        <div className="vlist">
          {validation.map((x, i) => <div key={i} className={`vitem ${x.level}`} role="button" tabIndex={0} onClick={() => setStep(STEP_OF_SECTION[x.step] || 'review')} onKeyDown={(e) => e.key === 'Enter' && setStep(STEP_OF_SECTION[x.step] || 'review')}>{x.message}</div>)}
        </div>
      )}
      <div className="help" style={{ marginTop: 8 }}>Errors must be fixed before review. Warnings and missing information never block saving.</div>
    </div>
  );
}

const F = ({ k, v, set, rd, className, ...rest }) => {
  const f = coreField(rd, 'project', k);
  if (f.is_active === false) return null;
  if (!isVisible(f, v, rd)) return null;
  return <FieldInput f={f} draft={v} set={set} rd={rd} className={className} {...rest} />;
};

function IdentityStep({ P, v, set, rd, reloadRef }) {
  return (
    <div className="stack">
      <div className="grid c2">
        <F k="name" v={v} set={set} rd={rd} />
        <DeveloperField v={v} set={set} rd={rd} reloadRef={reloadRef} />
        <F k="phase_name" v={v} set={set} rd={rd} states={false} inputProps={{ placeholder: 'e.g. Phase 2 — only if this record is one phase' }} />
        <Field label="Project ID"><div style={{ padding: '7px 0', fontWeight: 600 }}>{P.public_id} <span className="small muted" style={{ fontWeight: 400 }}>— permanent</span></div></Field>
        <F k="city_id" v={v} set={(k, x) => { set(k, x); set('location_id', null); set('sub_location_id', null); }} rd={rd} />
        <F k="location_id" v={v} set={(k, x) => { set(k, x); set('sub_location_id', null); }} rd={rd} states={false} />
        <F k="sub_location_id" v={v} set={set} rd={rd} states={false} />
      </div>
      {v.name !== P.values.name && v.name && <div className="notice info">Renaming keeps the same project and ID. “{P.values.name}” will be saved as a previous name so searches still find it.</div>}
      {P.aliases.length > 0 && <div className="small muted">Previous names: {P.aliases.map((a) => a.name).join(', ')}</div>}
      {(P.parent || P.phases.length > 0) && <div className="small">{P.parent && <>Phase of <Link to={`/manage/${P.parent.id}`}>{P.parent.name}</Link>. </>}{P.phases.map((x) => <span key={x.id}>Phase: <Link to={`/manage/${x.id}`}>{x.name}</Link> </span>)}</div>}
      <CustomFields rd={rd} entity="project" sections={['identity']} draft={v} set={set} />
    </div>
  );
}

function StatusStep({ P, v, set, rd, reload }) {
  const seg = (k, list) => (
    <Field label={coreField(rd, 'project', k).label} required={coreField(rd, 'project', k).is_required}>
      <Seg value={v[k]} onChange={(x) => set(k, x)} options={masterOptions(rd, list, v[k]).map((o) => ({ value: o.value, label: o.label }))} />
    </Field>
  );
  return (
    <div className="stack">
      <div className="grid c2">
        {seg('purpose_id', 'purpose')}
        {seg('launch_stage_id', 'launch_stage')}
        <F k="sales_status_id" v={v} set={set} rd={rd} states={false} />
        <div />
        <F k="dev_possession_date" v={v} set={set} rd={rd} />
        <F k="rera_possession_date" v={v} set={set} rd={rd} />
        <F k="possession_remarks" v={v} set={set} rd={rd} states={false} className="span-2" />
      </div>
      {v.dev_possession_date && v.rera_possession_date && v.dev_possession_date > v.rera_possession_date && <div className="notice warn">Developer possession is later than RERA possession. Double-check both dates.</div>}
      <CustomFields rd={rd} entity="project" sections={['status', 'possession']} draft={v} set={set} />
      <h3 style={{ marginTop: 10 }}>RERA registrations</h3>
      <ListEditor projectId={P.id} seg="rera" items={P.rera} onChanged={reload} addLabel="Add RERA number" empty="No RERA registration entered."
        columns={[{ key: 'rera_number', label: 'RERA number', required: true }, { key: 'phase_label', label: 'Phase / tower' }, { key: 'rera_possession_date', label: 'RERA possession', type: 'date' }, { key: 'remarks', label: 'Remarks' }]} />
    </div>
  );
}

function TowersStep({ P, v, set, rd, reload }) {
  return (
    <div className="stack">
      <div className="grid c3"><F k="total_towers" v={v} set={set} rd={rd} help="Total towers planned in the project" /></div>
      {v.total_towers !== P.values.total_towers && <div className="help">Save changes to update the total.</div>}
      <TowerEditor projectId={P.id} towers={P.towers} rd={rd} onChanged={reload} totalTowers={P.values.total_towers} />
    </div>
  );
}

function ParkingStep({ P, v, set, rd }) {
  const perConfig = P.configurations.filter((c) => c.is_active && c.parking_count != null);
  return (
    <div className="stack">
      <div className="grid c3">
        <F k="has_parking" v={v} set={set} rd={rd} className="span-all" />
        <F k="basement_levels" v={v} set={set} rd={rd} />
        <F k="stilt_levels" v={v} set={set} rd={rd} />
        <F k="podium_levels" v={v} set={set} rd={rd} />
        <F k="parking_remarks" v={v} set={set} rd={rd} states={false} className="span-all" />
      </div>
      {v.has_parking !== 'yes' && <div className="help">Parking levels appear when parking is marked “Yes”.</div>}
      <CustomFields rd={rd} entity="project" sections={['parking']} draft={v} set={set} />
      <div className="small muted">Parking per configuration is entered on each configuration{perConfig.length ? `: ${perConfig.map((c) => `${c.type} ${c.parking_count}`).join(', ')}` : ''}. Tower-specific parking goes in the tower remarks.</div>
    </div>
  );
}

function AmenitiesStep({ P, v, set, rd, reload }) {
  const purpose = rd.master_values.find((m) => m.id === v.purpose_id);
  const showRes = !purpose || purpose.meta?.shows_residential_usp;
  const showInv = !purpose || purpose.meta?.shows_investment_usp;
  return (
    <div className="stack">
      <AmenityPicker P={P} rd={rd} onSaved={reload} />
      <F k="amenity_remarks" v={v} set={set} rd={rd} states={false} />
      <CustomFields rd={rd} entity="project" sections={['amenities']} draft={v} set={set} />
      {showRes && <><h3 style={{ marginTop: 10 }}>Residential USPs</h3><HighlightList P={P} kind="usp_residential" onChanged={reload} placeholder="Why someone would live here" /></>}
      {showInv && <><h3 style={{ marginTop: 10 }}>Investment USPs</h3><HighlightList P={P} kind="usp_investment" onChanged={reload} placeholder="Why someone would invest here" /></>}
      {!purpose && <div className="help">Set the purpose in step 2 to show only the relevant USPs.</div>}
    </div>
  );
}

function AmenityPicker({ P, rd, onSaved }) {
  const toast = useToast();
  const initial = useMemo(() => P.amenities.map((a) => a.id), [P.amenities]);
  const [sel, setSel] = useState(initial);
  useEffect(() => setSel(initial), [initial]);
  const dirty = JSON.stringify([...sel].sort()) !== JSON.stringify([...initial].sort());
  const cats = rd.amenities.filter((a) => a.is_active || initial.includes(a.id)).reduce((m, a) => { (m[a.category_label] ||= []).push(a); return m; }, {});
  return (
    <div>
      <div className="amen-cats">
        {Object.entries(cats).map(([c, list]) => (
          <div key={c}><h4>{c}</h4>{list.map((a) => <label key={a.id} className="check" style={{ display: 'flex', padding: '2px 0' }}><input type="checkbox" checked={sel.includes(a.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))} />{a.name}</label>)}</div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sm primary" disabled={!dirty} onClick={async () => { await api.put(`/api/manage/projects/${P.id}/amenities`, { items: sel.map((x) => ({ amenity_id: x })) }); toast('Amenities saved'); onSaved(); }}>Save amenities</button>
        <span className="small muted">{sel.length} selected. Missing an amenity? Ask an admin to add it to the list, and mention it in the remarks meanwhile.</span>
      </div>
    </div>
  );
}

function HighlightList({ P, kind, onChanged, placeholder, withTime }) {
  return (
    <ListEditor projectId={P.id} seg="highlights" items={P.highlights.filter((h) => h.kind === kind)} onChanged={onChanged} defaults={{ kind }}
      columns={[{ key: 'text', label: 'Point', span: withTime ? 2 : 'all', required: true, placeholder }, ...(withTime ? [{ key: 'travel_time_mins', label: 'Travel time', type: 'int', unit: 'min' }, { key: 'distance_km', label: 'Distance', type: 'number', unit: 'km' }] : []), { key: 'kind', label: '', type: 'hidden' }].filter((c) => c.type !== 'hidden')}
      addLabel="Add point" />
  );
}

function LocationStep({ P, v, set, rd, reload }) {
  const sub = rd.sub_locations.find((s) => s.id === v.sub_location_id);
  const loc = rd.locations.find((s) => s.id === v.location_id);
  const center = sub?.latitude ? [Number(sub.latitude), Number(sub.longitude)] : loc?.latitude ? [Number(loc.latitude), Number(loc.longitude)] : null;
  return (
    <div className="stack">
      <div className="grid c2">
        <F k="locality" v={v} set={set} rd={rd} />
        <F k="landmark" v={v} set={set} rd={rd} />
        <F k="address" v={v} set={set} rd={rd} className="span-2" />
      </div>
      <h3 style={{ marginTop: 6 }}>Map position</h3>
      <div className="small muted">Click the map to drop the pin, or drag it. Projects without a pin do not appear on the sales map.</div>
      <MapPicker lat={v.latitude} lng={v.longitude} center={center} settings={rd.settings.map}
        onChange={(la, ln) => { set('latitude', la); set('longitude', ln); if (v.coords_status === 'verified') set('coords_status', 'unverified'); }} />
      <div className="grid c3">
        <F k="latitude" v={v} set={set} rd={rd} states={false} />
        <F k="longitude" v={v} set={set} rd={rd} states={false} />
        <Field label="Pin accuracy"><Seg value={v.coords_status} onChange={(x) => set('coords_status', x || 'unverified')} options={[{ value: 'unverified', label: 'Not checked' }, { value: 'approximate', label: 'Approximate' }, { value: 'verified', label: 'Verified on site' }]} /></Field>
      </div>
      <CustomFields rd={rd} entity="project" sections={['location']} draft={v} set={set} />
      <h3 style={{ marginTop: 10 }}>Connectivity</h3>
      <HighlightList P={P} kind="connectivity" onChanged={reload} withTime placeholder="e.g. Kharghar metro station" />
      <h3 style={{ marginTop: 10 }}>Location advantages</h3>
      <HighlightList P={P} kind="location_advantage" onChanged={reload} placeholder="e.g. Established schools and hospitals within 2 km" />
      <F k="other_location_remarks" v={v} set={set} rd={rd} states={false} />
    </div>
  );
}

function CommercialStep({ P, v, set, rd, reload }) {
  return (
    <div className="stack">
      <div className="grid c3">
        <F k="land_parcel_acres" v={v} set={set} rd={rd} />
        <F k="land_parcel_remarks" v={v} set={set} rd={rd} states={false} className="span-2" />
        <F k="open_space_acres" v={v} set={set} rd={rd} />
        <F k="open_space_pct" v={v} set={set} rd={rd} />
        <F k="open_space_remarks" v={v} set={set} rd={rd} states={false} />
      </div>
      <h3 style={{ marginTop: 10 }}>Payment plans</h3>
      <ListEditor projectId={P.id} seg="payment-plans" items={P.payment_plans} onChanged={reload} addLabel="Add payment plan"
        columns={[{ key: 'name', label: 'Plan', required: true, placeholder: 'e.g. Construction-linked' }, { key: 'structure', label: 'Structure', placeholder: '20:80' }, { key: 'applicable_to', label: 'For', placeholder: 'All / NRI' }, { key: 'remarks', label: 'Remarks' }]} />
      <h3 style={{ marginTop: 10 }}>Developer</h3>
      {P.developer?.about && <div className="small muted">{P.developer.about}</div>}
      <F k="developer_remarks" v={v} set={set} rd={rd} states={false} />
      <div className="grid c2">
        <F k="other_remarks" v={v} set={set} rd={rd} states={false} className="span-2" />
        <F k="internal_notes" v={v} set={set} rd={rd} states={false} />
        <F k="data_source" v={v} set={set} rd={rd} states={false} />
      </div>
      <CustomFields rd={rd} entity="project" sections={['land', 'developer', 'remarks', 'internal', 'other']} draft={v} set={set} />
    </div>
  );
}

function EoiStep({ P, v, set, rd, reload }) {
  const code = rd.master_values.find((m) => m.id === v.eoi_type_id)?.code;
  return (
    <div className="stack">
      <div className="grid c2">
        <Field label="EOI type" allowStates state={v['states.eoi_type_id']} onState={(s) => { set('states.eoi_type_id', s); if (s) set('eoi_type_id', null); }}>
          <Seg value={v.eoi_type_id} onChange={(x) => set('eoi_type_id', x)} options={masterOptions(rd, 'eoi_type', v.eoi_type_id).map((o) => ({ value: o.value, label: o.label, toggle: true }))} />
        </Field>
        <div />
        {code && code !== 'NA' && <>
          <F k="eoi_amount" v={v} set={set} rd={rd} />
          <F k="eoi_date" v={v} set={set} rd={rd} states={false} />
          <F k="eoi_valid_until" v={v} set={set} rd={rd} />
        </>}
        <F k="eoi_remarks" v={v} set={set} rd={rd} states={false} className="span-2" />
      </div>
      {!v.eoi_type_id && !v['states.eoi_type_id'] && <div className="help">Leaving EOI empty means “not provided”. Choose N/A if the project has no EOI.</div>}
      <CustomFields rd={rd} entity="project" sections={['eoi']} draft={v} set={set} />
      <h3 style={{ marginTop: 10 }}>Offers</h3>
      <div className="help">Offers past their end date are hidden from sales automatically.</div>
      <ListEditor projectId={P.id} seg="offers" items={P.offers} onChanged={reload} addLabel="Add offer" itemTitle={(o) => ({ current: 'Current', expired: 'Expired', upcoming: 'Upcoming', inactive: 'Removed' }[o.state])}
        columns={[{ key: 'name', label: 'Offer', required: true, span: 2 }, { key: 'start_date', label: 'Start', type: 'date' }, { key: 'end_date', label: 'End', type: 'date' }, { key: 'description', label: 'Details', type: 'longtext', span: 2 }, { key: 'remarks', label: 'Internal remarks', span: 2 }]} />
      <h3 style={{ marginTop: 10 }}>Objection handling</h3>
      <ListEditor projectId={P.id} seg="objections" items={P.objections} onChanged={reload} addLabel="Add objection"
        columns={[{ key: 'objection', label: 'Customer says…', required: true, span: 2 }, { key: 'tags', label: 'Tags', type: 'tags', span: 2 }, { key: 'response', label: 'Agreed answer', type: 'longtext', span: 'all' }]} />
    </div>
  );
}

function ReviewStep({ P, validation, onStatus, can: _c, setStep, dirty }) {
  const { can } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const [action, setAction] = useState(null);
  const [full, setFull] = useState(null);
  const [err, setErr] = useState(null);
  const hist = useAsync(() => (can('audit.view') ? api.get(`/api/manage/projects/${P.id}/history`) : Promise.resolve([])), [P.id, P.row_version]);
  useEffect(() => { api.get(`/api/manage/projects/${P.id}/validation?phase=submit`).then(setFull).catch(() => {}); }, [P.id, P.row_version, validation]);
  const s = P.record_status;
  const actions = [
    ['submit', 'Submit for review', ['draft', 'needs_update', 'verified'], 'project.submit', false, 'primary'],
    ['verify', 'Verify', ['under_review'], 'project.verify', false, 'primary'],
    ['publish', 'Publish to sales', ['verified', 'under_review', 'needs_update'], 'project.publish', false, 'primary'],
    ['reverify', 'Confirm still accurate', ['published', 'needs_update'], 'project.verify', false, ''],
    ['send_back', 'Send back to editor', ['under_review', 'verified'], 'project.verify', true, ''],
    ['mark_needs_update', 'Flag as needing update', ['published'], 'project.edit', true, ''],
    ['unpublish', 'Unpublish', ['published', 'needs_update'], 'project.publish', true, ''],
    ['deactivate', 'Deactivate', ['draft', 'under_review', 'verified', 'published', 'needs_update'], 'project.archive', true, 'danger'],
    ['archive', 'Archive', ['draft', 'under_review', 'verified', 'published', 'needs_update', 'inactive'], 'project.archive', true, 'danger'],
    ['restore', 'Restore to draft', ['inactive', 'archived'], 'project.archive', false, ''],
  ].filter(([, , from, perm]) => from.includes(s) && can(perm));
  const errors = (full || []).filter((x) => x.level === 'error');
  const run = async (key, remarks) => {
    try {
      const r = await api.post(`/api/manage/projects/${P.id}/workflow`, { action: key, remarks });
      toast(`Status: ${STATUS_LABEL[r.record_status]}`);
      onStatus();
    } catch (e) { setErr(e); throw e; }
  };
  return (
    <div className="stack">
      {dirty && <div className="notice warn">You have unsaved field changes. Save them before submitting.</div>}
      <div className="grid c2">
        <div>
          <h3>Checks before review</h3>
          {full === null ? <Loading /> : full.length === 0 ? <div className="notice ok" style={{ marginTop: 8 }}>No issues found.</div> : (
            <div className="vlist" style={{ marginTop: 8, maxHeight: 360 }}>{full.map((x, i) => <div key={i} className={`vitem ${x.level}`} onClick={() => setStep(STEP_OF_SECTION[x.step] || 'review')}>{x.message}</div>)}</div>
          )}
        </div>
        <div>
          <h3>Record status</h3>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>Status</dt><dd><StatusBadge status={s} /></dd>
            <dt>Created</dt><dd>{date(P.freshness.created_at, 'time')}{P.freshness.created_by ? ` by ${P.freshness.created_by}` : ''}</dd>
            <dt>Last updated</dt><dd>{date(P.freshness.updated_at, 'time')}{P.freshness.updated_by ? ` by ${P.freshness.updated_by}` : ''}</dd>
            <dt>Submitted</dt><dd>{P.freshness.submitted_at ? `${date(P.freshness.submitted_at, 'time')} by ${P.freshness.submitted_by || '—'}` : '—'}</dd>
            <dt>Verified</dt><dd>{P.freshness.verified_at ? `${date(P.freshness.verified_at, 'time')} by ${P.freshness.verified_by || '—'}` : 'Not yet'}</dd>
            <dt>Published</dt><dd>{P.freshness.published_at ? `${date(P.freshness.published_at, 'time')}` : '—'}</dd>
          </dl>
          {P.freshness.unverified_changes && P.freshness.verified_at && <div className="notice warn" style={{ marginTop: 8 }}>Changed since last verification.</div>}
          <div className="row wrap" style={{ marginTop: 12 }}>
            {actions.map(([key, label, , , needsReason, kind]) => (
              <button key={key} className={`btn ${kind === 'primary' ? 'primary' : kind === 'danger' ? 'danger' : ''}`} disabled={dirty || (['submit', 'verify', 'publish', 'reverify'].includes(key) && errors.length > 0)}
                onClick={() => (needsReason ? setAction({ key, label }) : run(key).catch(() => {}))}>{label}</button>
            ))}
            {can('project.delete') && s === 'draft' && !P.freshness.published_at && <button className="btn danger" onClick={() => setAction({ key: 'delete', label: 'Delete permanently' })}>Delete permanently</button>}
          </div>
          {errors.length > 0 && <div className="help" style={{ marginTop: 6 }}>Fix the {errors.length} error(s) to submit, verify or publish.</div>}
          <ErrorBox error={err} />
        </div>
      </div>
      {P.verifications.length > 0 && (<>
        <h3 style={{ marginTop: 10 }}>Review trail</h3>
        <div className="table-wrap"><table className="t"><tbody>{P.verifications.map((x) => <tr key={x.id}><td className="nowrap">{date(x.at, 'time')}</td><td>{x.user_name || '—'}</td><td>{x.action.replace(/_/g, ' ')}</td><td>{x.remarks}</td></tr>)}</tbody></table></div>
      </>)}
      {can('audit.view') && (<>
        <h3 style={{ marginTop: 10 }}>Change history</h3>
        <HistoryTable rows={hist.data || []} />
      </>)}
      {action && action.key !== 'delete' && <Confirm title={action.label} message={`This changes the project from “${STATUS_LABEL[s]}”.`} needReason confirmLabel={action.label} danger={['deactivate', 'archive'].includes(action.key)} onClose={() => setAction(null)} onConfirm={(r) => run(action.key, r)} />}
      {action?.key === 'delete' && <Confirm title="Delete permanently" danger confirmLabel="Delete" needReason reasonLabel={`Type the project name (“${P.name}”) to confirm`} message="This removes the draft and all its configurations and towers. The deletion itself stays in the audit log."
        onClose={() => setAction(null)} onConfirm={async (name) => { await api.del(`/api/manage/projects/${P.id}`, { confirm_name: name }); toast('Project deleted'); nav('/manage'); }} />}
    </div>
  );
}

export function HistoryTable({ rows, showProject }) {
  const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? (Array.isArray(v) ? v.join(', ') : JSON.stringify(v).slice(0, 160)) : String(v));
  if (!rows.length) return <div className="small muted">No changes recorded yet.</div>;
  return (
    <div className="table-wrap" style={{ maxHeight: 480 }}>
      <table className="t">
        <thead><tr><th>When</th><th>Who</th>{showProject && <th>Project</th>}<th>What</th><th>Before</th><th>After</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="nowrap">{date(a.at, 'time')}</td>
              <td>{a.user_name || 'System'}</td>
              {showProject && <td>{a.project_name ? <Link to={`/manage/${a.project_id}`}>{a.project_name}</Link> : '—'}</td>}
              <td><b>{a.action}</b> {a.entity !== 'project' && <span className="muted">{a.entity} #{a.entity_id}</span>} {a.field && <span>· {a.field.replace(/_/g, ' ')}</span>}{a.note && <div className="small muted">{a.note}</div>}</td>
              <td className="small">{a.action === 'update' || a.action === 'status' ? <span className="diff-old">{fmt(a.old_value)}</span> : a.action === 'delete' ? <span className="muted">snapshot kept</span> : ''}</td>
              <td className="small">{a.action === 'update' || a.action === 'status' ? <span className="diff-new">{fmt(a.new_value)}</span> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
