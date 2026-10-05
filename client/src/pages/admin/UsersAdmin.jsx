import { useState } from 'react';
import { api } from '../../api.js';
import { useSession } from '../../session.jsx';
import { ErrorBox, Field, Loading, Modal, Select, TextInput, useAsync, useToast } from '../../components/ui.jsx';
import { ago } from '../../format.js';
import { Head } from './Admin.jsx';

export default function UsersAdmin() {
  const { user: me } = useSession();
  const toast = useToast();
  const users = useAsync(() => api.get('/api/admin/users'), []);
  const roles = useAsync(() => api.get('/api/admin/roles'), []);
  const [add, setAdd] = useState(null);
  const [roleEdit, setRoleEdit] = useState(null);
  const [err, setErr] = useState(null);
  if (users.loading || roles.loading) return <Loading />;
  const roleOpts = roles.data.roles.map((r) => ({ value: r.id, label: r.name }));
  const patch = async (u, body, msg) => { setErr(null); try { await api.patch(`/api/admin/users/${u.id}`, body); toast(msg); users.reload(); } catch (e) { setErr(e); } };
  return (
    <div className="stack">
      <Head title="Users & roles">Only people listed here can sign in with Google. Deactivating someone signs them out everywhere immediately; their history stays.</Head>
      <div><button className="btn primary" onClick={() => setAdd({ email: '', name: '', role_id: roleOpts.find((r) => r.label.startsWith('Sales'))?.value })}>Approve a new user</button></div>
      <ErrorBox error={err} />
      <div className="table-wrap"><table className="t">
        <thead><tr><th>User</th><th>Role</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
        <tbody>{users.data.map((u) => (
          <tr key={u.id} className={u.is_active ? '' : 'dim'}>
            <td><b>{u.name || '—'}</b><div className="small muted">{u.email}</div></td>
            <td style={{ width: 200 }}><Select allowEmpty={false} value={u.role_id} options={roleOpts} disabled={!u.is_active} onChange={(r) => patch(u, { role_id: r }, 'Role changed')} aria-label="Role" /></td>
            <td className="small">{u.last_login_at ? ago(u.last_login_at) : 'Never'}{u.active_sessions ? ` · ${u.active_sessions} session(s)` : ''}</td>
            <td>{u.is_active ? <span className="badge exact">Active</span> : <span className="badge">Deactivated</span>}</td>
            <td className="num">{u.id !== me.id && (u.is_active
              ? <button className="btn sm danger" onClick={() => window.confirm(`Deactivate ${u.email}? They are signed out immediately.`) && patch(u, { is_active: false }, 'User deactivated')}>Deactivate</button>
              : <button className="btn sm" onClick={() => patch(u, { is_active: true }, 'User reactivated')}>Reactivate</button>)}</td>
          </tr>
        ))}</tbody>
      </table></div>

      <h2 style={{ marginTop: 16 }}>Roles</h2>
      <p className="small muted">Create roles for new responsibilities (e.g. “Regional lead”: view all + verify) by ticking permissions — no code changes.</p>
      <div className="table-wrap"><table className="t">
        <thead><tr><th>Role</th><th>Permissions</th><th className="num">Users</th><th /></tr></thead>
        <tbody>{roles.data.roles.map((r) => (
          <tr key={r.id}><td><b>{r.name}</b><div className="small muted">{r.description}</div></td><td className="small">{r.permissions.length === roles.data.permissions.length ? 'All permissions' : r.permissions.map((p) => roles.data.permissions.find((x) => x.key === p)?.label).join(' · ')}</td><td className="num">{r.user_count}</td>
            <td className="num">{r.key !== 'admin' && <button className="btn sm" onClick={() => setRoleEdit({ ...r })}>Edit</button>}</td></tr>
        ))}</tbody>
      </table></div>
      <div><button className="btn" onClick={() => setRoleEdit({ key: '', name: '', description: '', permissions: ['explorer.view'], isNew: true })}>New role</button></div>

      {add && (
        <Modal title="Approve a new user" onClose={() => setAdd(null)} footer={<><button className="btn" onClick={() => setAdd(null)}>Cancel</button>
          <button className="btn primary" onClick={async () => { setErr(null); try { await api.post('/api/admin/users', add); toast('User approved — they can now sign in with Google'); setAdd(null); users.reload(); } catch (e) { setErr(e); } }}>Approve</button></>}>
          <div className="stack">
            <Field label="Google account email" required><TextInput value={add.email} onChange={(x) => setAdd({ ...add, email: x })} autoFocus /></Field>
            <Field label="Name"><TextInput value={add.name} onChange={(x) => setAdd({ ...add, name: x })} /></Field>
            <Field label="Role" required><Select allowEmpty={false} value={add.role_id} options={roleOpts} onChange={(x) => setAdd({ ...add, role_id: x })} /></Field>
            <ErrorBox error={err} />
          </div>
        </Modal>
      )}
      {roleEdit && (
        <Modal title={roleEdit.isNew ? 'New role' : `Edit ${roleEdit.name}`} onClose={() => setRoleEdit(null)} footer={<><button className="btn" onClick={() => setRoleEdit(null)}>Cancel</button>
          <button className="btn primary" onClick={async () => { setErr(null); try { if (roleEdit.isNew) await api.post('/api/admin/roles', roleEdit); else await api.patch(`/api/admin/roles/${roleEdit.id}`, roleEdit); toast('Role saved'); setRoleEdit(null); roles.reload(); } catch (e) { setErr(e); } }}>Save role</button></>}>
          <div className="stack">
            <div className="grid c2">
              <Field label="Name" required><TextInput value={roleEdit.name} onChange={(x) => setRoleEdit({ ...roleEdit, name: x })} /></Field>
              {roleEdit.isNew && <Field label="Key" required help="lower_snake_case"><TextInput value={roleEdit.key} onChange={(x) => setRoleEdit({ ...roleEdit, key: x })} /></Field>}
            </div>
            <Field label="Description"><TextInput value={roleEdit.description} onChange={(x) => setRoleEdit({ ...roleEdit, description: x })} /></Field>
            <div className="stack" style={{ gap: 6 }}>{roles.data.permissions.map((p) => (
              <label key={p.key} className="check"><input type="checkbox" checked={roleEdit.permissions.includes(p.key)} onChange={(e) => setRoleEdit({ ...roleEdit, permissions: e.target.checked ? [...roleEdit.permissions, p.key] : roleEdit.permissions.filter((x) => x !== p.key) })} />{p.label}</label>
            ))}</div>
            <ErrorBox error={err} />
          </div>
        </Modal>
      )}
    </div>
  );
}
