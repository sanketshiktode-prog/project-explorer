import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [ref, setRef] = useState(null);
  const loadUser = useCallback(async () => {
    try { setUser(await api.get('/api/auth/me')); } catch { setUser(null); }
  }, []);
  const loadRef = useCallback(async () => { try { setRef(await api.get('/api/reference')); } catch { /* not signed in */ } }, []);
  useEffect(() => { loadUser(); }, [loadUser]);
  useEffect(() => { if (user) loadRef(); }, [user, loadRef]);
  useEffect(() => {
    const h = () => setUser(null);
    window.addEventListener('pe:signed-out', h);
    return () => window.removeEventListener('pe:signed-out', h);
  }, []);
  const can = useCallback((p) => !!user?.permissions?.includes(p), [user]);
  const signOut = async () => { await api.post('/api/auth/logout'); setUser(null); setRef(null); };
  return <Ctx.Provider value={{ user, setUser, reloadUser: loadUser, ref, reloadRef: loadRef, can, signOut }}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx);

/** Lookup helpers over the reference payload. */
export function useRef_() {
  const { ref } = useSession();
  return ref;
}
export function masterOptions(ref, listKey, includeInactiveId) {
  return (ref?.master_values || []).filter((v) => v.list_key === listKey && (v.is_active || v.id === includeInactiveId)).map((v) => ({ value: v.id, label: v.label, code: v.code, meta: v.meta }));
}
export const masterCode = (ref, id) => ref?.master_values?.find((v) => v.id === id)?.code ?? null;
