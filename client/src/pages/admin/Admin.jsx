import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../../session.jsx';
import DataQuality from './DataQuality.jsx';
import Masters from './Masters.jsx';
import { BandsAdmin, FieldsAdmin, FiltersAdmin, SettingsAdmin } from './ConfigAdmin.jsx';
import UsersAdmin from './UsersAdmin.jsx';
import Audit from './Audit.jsx';
import Import from './Import.jsx';

export default function Admin() {
  const { can } = useSession();
  const links = [
    can('quality.view') && ['quality', 'Data quality'],
    can('master.manage') && ['masters', 'Master data'],
    can('config.manage') && ['filters', 'Filters'],
    can('config.manage') && ['bands', 'Bands'],
    can('config.manage') && ['fields', 'Fields'],
    can('config.manage') && ['settings', 'Business rules'],
    can('users.manage') && ['users', 'Users & roles'],
    can('import.run') && ['import', 'Bulk import'],
    can('audit.view') && ['audit', 'Audit log'],
  ].filter(Boolean);
  return (
    <div className="page" style={{ maxWidth: 1360 }}>
      <div className="admin-layout">
        <nav className="subnav" aria-label="Admin sections">{links.map(([k, l]) => <NavLink key={k} to={`/admin/${k}`}>{l}</NavLink>)}</nav>
        <div style={{ minWidth: 0 }}>
          <Routes>
            <Route index element={<Navigate to={links[0]?.[0] || '/'} replace />} />
            <Route path="quality" element={<DataQuality />} />
            <Route path="masters/*" element={<Masters />} />
            <Route path="filters" element={<FiltersAdmin />} />
            <Route path="bands" element={<BandsAdmin />} />
            <Route path="fields" element={<FieldsAdmin />} />
            <Route path="settings" element={<SettingsAdmin />} />
            <Route path="users" element={<UsersAdmin />} />
            <Route path="import" element={<Import />} />
            <Route path="audit" element={<Audit />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export function Head({ title, children }) {
  return <div className="page-head"><div className="grow"><h1>{title}</h1>{children && <p className="lede">{children}</p>}</div></div>;
}
