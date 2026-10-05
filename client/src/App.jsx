import { lazy, Suspense, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from './session.jsx';
import { Loading, Logo } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Explorer from './pages/Explorer.jsx';

const ProjectOverview = lazy(() => import('./pages/ProjectOverview.jsx'));
const ProjectsList = lazy(() => import('./pages/manage/ProjectsList.jsx'));
const Wizard = lazy(() => import('./pages/manage/Wizard.jsx'));
const Admin = lazy(() => import('./pages/admin/Admin.jsx'));
const Objections = lazy(() => import('./pages/Objections.jsx'));
const Help = lazy(() => import('./pages/Help.jsx'));

export default function App() {
  return <SessionProvider><Gate /></SessionProvider>;
}

function Gate() {
  const { user } = useSession();
  if (user === undefined) return <Loading text="Opening Project Explorer…" />;
  if (!user) return <Login />;
  return <Shell />;
}

function Shell() {
  const { user, can, signOut, ref } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const isAdmin = can('master.manage') || can('config.manage') || can('users.manage') || can('quality.view') || can('audit.view') || can('import.run');
  return (
    <div className="shell">
      <header className="topnav">
        <button className="btn ghost icon menu-btn" style={{ color: '#fff' }} aria-label="Menu" onClick={() => setOpen((o) => !o)}>☰</button>
        <NavLink to="/" className="brand" style={{ textDecoration: 'none' }}><Logo /> Project Explorer</NavLink>
        <nav className={`navlinks ${open ? 'open' : ''}`} onClick={() => setOpen(false)}>
          <NavLink to="/" end className="navlink">Search</NavLink>
          <NavLink to="/objections" className="navlink">Objection handling</NavLink>
          {can('project.view_all') && <NavLink to="/manage" className={() => `navlink ${loc.pathname.startsWith('/manage') ? 'active' : ''}`}>Projects</NavLink>}
          {can('project.verify') && <NavLink to="/manage?status=under_review" className={() => 'navlink'}>Review queue</NavLink>}
          {isAdmin && <NavLink to="/admin" className="navlink">Admin</NavLink>}
          <NavLink to="/help" className="navlink">Help</NavLink>
        </nav>
        <div className="spacer" />
        <div className="user">
          <span className="who">{user.name || user.email} · {user.role_name}</span>
          <button className="btn ghost sm" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="main">
        {!ref ? <Loading /> : (
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Explorer />} />
              <Route path="/p/:id" element={<ProjectOverview />} />
              <Route path="/objections" element={<Objections />} />
              <Route path="/help" element={<Help />} />
              {can('project.view_all') && <Route path="/manage" element={<ProjectsList />} />}
              {can('project.create') && <Route path="/manage/new" element={<Wizard />} />}
              {can('project.view_all') && <Route path="/manage/:id" element={<Wizard />} />}
              {isAdmin && <Route path="/admin/*" element={<Admin />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        )}
      </main>
    </div>
  );
}
