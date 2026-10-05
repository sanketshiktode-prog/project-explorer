import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { Modal, Select, useAsync, useToast } from '../../components/ui.jsx';
import CrudTable from './CrudTable.jsx';
import { Head } from './Admin.jsx';

const ACTIVE = { key: 'is_active', label: 'Active', type: 'bool', width: 60 };
const ORDER = { key: 'sort_order', label: 'Order', type: 'int', width: 80 };

export default function Masters() {
  const { reloadRef } = useSession();
  return (
    <div>
      <Head title="Master data">Standard values everyone picks from. Deactivate values you no longer use — existing projects keep them; delete is only possible for values nothing uses.</Head>
      <div className="tabs">
        {[['geography', 'Cities & locations'], ['developers', 'Developers'], ['configurations', 'Configurations'], ['lists', 'Dropdown lists'], ['amenities', 'Amenities']].map(([k, l]) => <NavLink key={k} to={`/admin/masters/${k}`}>{l}</NavLink>)}
      </div>
      <Routes>
        <Route index element={<Navigate to="geography" replace />} />
        <Route path="geography" element={<Geography onChanged={reloadRef} />} />
        <Route path="developers" element={<Developers onChanged={reloadRef} />} />
        <Route path="configurations" element={<CrudTable resource="configuration-types" onChanged={reloadRef} addLabel="Add configuration type"
          note="Examples: add “Villa” or “Duplex” here and it is immediately available in data entry and the Configuration filter."
          columns={[{ key: 'label', label: 'Label', required: true }, { key: 'code', label: 'Code', width: 90, editable: (r, n) => n }, { key: 'category', label: 'Category', type: 'select', required: true, options: ['residential', 'commercial', 'plot', 'villa', 'other'].map((x) => ({ value: x, label: x })) }, { key: 'bedrooms', label: 'Bedrooms', type: 'number', width: 90 }, { key: 'area_label', label: 'Area label', width: 120 }, ORDER, ACTIVE]} defaults={{ category: 'residential', area_label: 'Carpet' }} />} />
        <Route path="lists" element={<Lists onChanged={reloadRef} />} />
        <Route path="amenities" element={<Amenities onChanged={reloadRef} />} />
      </Routes>
    </div>
  );
}

function Geography({ onChanged }) {
  const cities = useAsync(() => api.get('/api/admin/r/cities'), []);
  const locs = useAsync(() => api.get('/api/admin/r/locations'), []);
  const [city, setCity] = useState(null);
  const [loc, setLoc] = useState(null);
  const refresh = () => { cities.reload(); locs.reload(); onChanged(); };
  return (
    <div className="stack">
      <h3>Cities</h3>
      <CrudTable resource="cities" onChanged={refresh} addLabel="Add city"
        note="The city code is part of new project IDs (PRJ-MUM-000001). Coordinates set the map centre and the sanity check for project pins."
        columns={[{ key: 'name', label: 'City', required: true }, { key: 'code', label: 'Code', width: 80 }, { key: 'state', label: 'State' }, { key: 'latitude', label: 'Lat', type: 'number', width: 100 }, { key: 'longitude', label: 'Lng', type: 'number', width: 100 }, ORDER, ACTIVE]}
        rowActions={(r) => <button className="btn sm" onClick={() => { setCity(r.id); setLoc(null); }}>Locations</button>} />
      {city && <>
        <h3 style={{ marginTop: 10 }}>Locations in {cities.data?.find((c) => c.id === city)?.name}</h3>
        <CrudTable key={`l${city}`} resource="locations" filter={(r) => r.city_id === city} defaults={{ city_id: city }} onChanged={refresh} addLabel="Add location"
          columns={[{ key: 'name', label: 'Location', required: true }, { key: 'latitude', label: 'Lat', type: 'number', width: 100 }, { key: 'longitude', label: 'Lng', type: 'number', width: 100 }, ORDER, ACTIVE]}
          rowActions={(r) => <button className="btn sm" onClick={() => setLoc(r.id)}>Sub-locations</button>} />
      </>}
      {loc && <>
        <h3 style={{ marginTop: 10 }}>Sub-locations in {locs.data?.find((c) => c.id === loc)?.name}</h3>
        <CrudTable key={`s${loc}`} resource="sub-locations" filter={(r) => r.location_id === loc} defaults={{ location_id: loc }} onChanged={onChanged} addLabel="Add sub-location"
          columns={[{ key: 'name', label: 'Sub-location', required: true }, { key: 'latitude', label: 'Lat', type: 'number', width: 100 }, { key: 'longitude', label: 'Lng', type: 'number', width: 100 }, ORDER, ACTIVE]} />
      </>}
    </div>
  );
}

function Developers({ onChanged }) {
  const toast = useToast();
  const [merge, setMerge] = useState(null);
  const [into, setInto] = useState(null);
  const [k, setK] = useState(0);
  const all = useAsync(() => api.get('/api/admin/r/developers'), [k]);
  return (
    <div>
      <CrudTable key={k} resource="developers" onChanged={onChanged} addLabel="Add developer" sort={(a, b) => a.name.localeCompare(b.name)}
        note="Duplicate developers (e.g. “Hiranandani” and “Hiranandani Group”) can be merged: all projects move to the one you keep and the old name becomes an alias."
        columns={[{ key: 'name', label: 'Developer', required: true }, { key: 'aliases', label: 'Also known as', type: 'tags' }, { key: 'about', label: 'About' }, { key: 'website', label: 'Website' }, ACTIVE]}
        rowActions={(r) => <button className="btn sm ghost" onClick={() => { setMerge(r); setInto(null); }}>Merge…</button>} canDelete />
      {merge && (
        <Modal title={`Merge “${merge.name}” into…`} onClose={() => setMerge(null)} footer={<><button className="btn" onClick={() => setMerge(null)}>Cancel</button>
          <button className="btn danger solid" disabled={!into} onClick={async () => { await api.post(`/api/admin/developers/${merge.id}/merge`, { into_id: into }); toast('Developers merged'); setMerge(null); setK((x) => x + 1); onChanged(); }}>Merge</button></>}>
          <p className="small">{merge.usage_count} project(s) will move to the developer you choose. “{merge.name}” is kept as an alias so imports and searches still recognise it.</p>
          <Select value={into} onChange={setInto} options={(all.data || []).filter((d) => d.id !== merge.id).map((d) => ({ value: d.id, label: d.name }))} />
        </Modal>
      )}
    </div>
  );
}

function Lists({ onChanged }) {
  const lists = useAsync(() => api.get('/api/admin/r/master-lists'), []);
  const [sel, setSel] = useState('launch_stage');
  return (
    <div className="stack">
      <div className="row wrap">
        {(lists.data || []).map((l) => <button key={l.key} className="chip" aria-pressed={sel === l.key} onClick={() => setSel(l.key)}>{l.name}</button>)}
      </div>
      <div className="help">Behaviour flags live in “Meta” as JSON — e.g. Purpose “Investment” has <code>{'{"shows_investment_usp":true}'}</code> which controls which USP fields data entry shows; Inventory “Sold Out” has <code>{'{"excludes_from_match":true}'}</code>.</div>
      <CrudTable key={sel} resource="master-values" filter={(r) => r.list_key === sel} defaults={{ list_key: sel }} onChanged={onChanged} addLabel="Add value"
        columns={[{ key: 'label', label: 'Label', required: true }, { key: 'code', label: 'Code', width: 140, editable: (r, n) => n }, { key: 'meta', label: 'Meta (JSON)', type: 'json' }, ORDER, ACTIVE]} />
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>Manage lists (for new custom select fields)</summary>
        <div style={{ marginTop: 8 }}>
          <CrudTable resource="master-lists" onChanged={() => { lists.reload(); onChanged(); }} addLabel="Add list"
            columns={[{ key: 'name', label: 'Name', required: true }, { key: 'key', label: 'Key', editable: (r, n) => n }, { key: 'description', label: 'Description' }]} />
        </div>
      </details>
    </div>
  );
}

function Amenities({ onChanged }) {
  const { ref } = useSession();
  const cats = ref.master_values.filter((v) => v.list_key === 'amenity_category').map((v) => ({ value: v.id, label: v.label }));
  return (
    <CrudTable resource="amenities" onChanged={onChanged} addLabel="Add amenity" note="Categories are a dropdown list (Dropdown lists → Amenity Category)."
      sort={(a, b) => a.category_id - b.category_id || a.sort_order - b.sort_order}
      columns={[{ key: 'name', label: 'Amenity', required: true }, { key: 'category_id', label: 'Category', type: 'select', options: cats, required: true }, ORDER, ACTIVE]} defaults={{ category_id: cats[0]?.value }} />
  );
}
