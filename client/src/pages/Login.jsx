import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { ErrorBox, Logo } from '../components/ui.jsx';

export default function Login() {
  const { reloadUser } = useSession();
  const [cfg, setCfg] = useState(null);
  const [devUsers, setDevUsers] = useState([]);
  const [err, setErr] = useState(null);
  const btn = useRef(null);

  useEffect(() => { api.get('/api/auth/config').then(setCfg).catch(setErr); }, []);
  useEffect(() => { if (cfg?.dev_login) api.get('/api/auth/dev-users').then(setDevUsers).catch(() => {}); }, [cfg]);
  useEffect(() => {
    if (!cfg?.google_client_id) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id,
        callback: async ({ credential }) => {
          setErr(null);
          try { await api.post('/api/auth/google', { credential }); await reloadUser(); } catch (e) { setErr(e); }
        },
        hd: cfg.allowed_domain || undefined,
      });
      if (btn.current) window.google.accounts.id.renderButton(btn.current, { theme: 'outline', size: 'large', width: 320, text: 'signin_with' });
    };
    document.body.appendChild(s);
    return () => s.remove();
  }, [cfg, reloadUser]);

  const dev = async (email) => {
    setErr(null);
    try { await api.post('/api/auth/dev-login', { email }); await reloadUser(); } catch (e) { setErr(e); }
  };

  return (
    <div className="login">
      <div className="panel login-card">
        <div style={{ width: 40, height: 40 }}><Logo /></div>
        <h1>Project Explorer</h1>
        <p className="muted">Find the right project while the customer is still on the line.</p>
        <div className="stack" style={{ marginTop: 18 }}>
          {cfg?.google_client_id ? <div ref={btn} /> : cfg && !cfg.dev_login && <div className="notice warn">Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server.</div>}
          {cfg?.allowed_domain && <div className="small muted">Use your {cfg.allowed_domain} Google account. Only approved accounts can sign in.</div>}
          <ErrorBox error={err} />
          {cfg?.dev_login && (
            <div>
              <div className="notice info" style={{ marginBottom: 10 }}>Development sign-in is enabled. Pick a demo user — this is switched off in production.</div>
              <div className="stack" style={{ gap: 6 }}>
                {devUsers.map((u) => (
                  <button key={u.email} className="btn" style={{ justifyContent: 'space-between', height: 'auto', padding: '8px 12px' }} onClick={() => dev(u.email)}>
                    <span style={{ textAlign: 'left' }}>{u.name}<br /><span className="small muted">{u.email}</span></span>
                    <span className="badge">{u.is_active ? u.role : 'Deactivated'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
