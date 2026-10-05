import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { inr, STATUS_LABEL } from '../format.js';

// ---------------- toasts ----------------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- async helper ----------------
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const counter = useRef(0);
  const run = useCallback(async () => {
    const n = ++counter.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (n === counter.current) setState({ loading: false, data, error: null });
      return data;
    } catch (error) {
      if (n === counter.current) setState({ loading: false, data: null, error });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })) };
}

// ---------------- primitives ----------------
export function Spinner() { return <span className="spinner" aria-label="Loading" />; }
export function Loading({ text = 'Loading…' }) { return <div className="empty"><Spinner /><div className="small muted" style={{ marginTop: 8 }}>{text}</div></div>; }
export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return <div className="notice error"><div className="grow">{error.message}</div>{onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}</div>;
}
export function StatusBadge({ status }) { return <span className={`badge st-${status}`}>{STATUS_LABEL[status] || status}</span>; }
export function MatchBadge({ status }) {
  const label = { exact: 'Exact match', partial: 'Partial match', none: 'No match' }[status];
  return <span className={`badge ${status}`}><span className={`dot ${status}`} />{label}</span>;
}

export function Modal({ title, children, footer, onClose, wide, sub }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="grow"><h3>{title}</h3>{sub && <div className="small muted" style={{ marginTop: 3 }}>{sub}</div>}</div>
          {onClose && <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Confirm', danger, needReason, reasonLabel = 'Reason', onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger solid' : 'primary'}`} disabled={busy || (needReason && !reason.trim())}
        onClick={async () => { setBusy(true); setErr(null); try { await onConfirm(reason); onClose(); } catch (e) { setErr(e); setBusy(false); } }}>{confirmLabel}</button>
    </>}>
      <div className="stack">
        {message && <div>{message}</div>}
        {needReason && <label className="field"><span className="lbl">{reasonLabel}</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></label>}
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}

// ---------------- form fields ----------------
export function Field({ label, required, help, error, children, state, onState, allowStates, className = '' }) {
  return (
    <label className={`field ${className}`} onClick={(e) => { if (e.target.closest('.state-pick')) e.preventDefault(); }}>
      <span className="lbl">
        {label}{required && <span className="req" aria-label="required">*</span>}
        {allowStates && <StatePick value={state} onChange={onState} />}
      </span>
      {children}
      {error ? <span className="field-err">{error}</span> : help ? <span className="help">{help}</span> : null}
    </label>
  );
}

/** "N/A" / "Unknown" markers that explain why a field is empty. */
export function StatePick({ value, onChange }) {
  return (
    <span className="state-pick">
      {[['na', 'N/A', 'Not applicable to this project'], ['unknown', 'Unknown', 'We do not know yet']].map(([v, l, t]) => (
        <button key={v} type="button" title={t} aria-pressed={value === v} onClick={(e) => { e.preventDefault(); onChange?.(value === v ? null : v); }}>{l}</button>
      ))}
    </span>
  );
}

export function TextInput({ value, onChange, ...p }) {
  return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} {...p} />;
}
export function TextArea({ value, onChange, ...p }) {
  return <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} {...p} />;
}
export function NumberInput({ value, onChange, unit, integer, ...p }) {
  const [txt, setTxt] = useState(value ?? '');
  useEffect(() => { setTxt((t) => (Number(t) === value || (t === '' && value == null) ? t : value ?? '')); }, [value]);
  const el = (
    <input type="text" inputMode={integer ? 'numeric' : 'decimal'} value={txt}
      onChange={(e) => {
        const s = e.target.value.replace(/,/g, '');
        setTxt(e.target.value);
        if (s.trim() === '') onChange(null);
        else if (Number.isFinite(Number(s))) onChange(integer ? Math.round(Number(s)) : Number(s));
      }} {...p} />
  );
  return unit ? <span className="input-unit">{el}<span className="unit">{unit}</span></span> : el;
}

/** Money: accepts 13500000, "1.35 Cr", "85 L". Always stores whole rupees. */
export function parseMoney(s) {
  const t = String(s).toLowerCase().replace(/[₹,\s]|rs\.?/g, '');
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)(cr|crore|l|lac|lakh|lakhs|k)?$/);
  if (!m) return NaN;
  const mult = { cr: 1e7, crore: 1e7, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, k: 1e3 }[m[2]] || 1;
  return Math.round(Number(m[1]) * mult);
}
export function MoneyInput({ value, onChange, placeholder = 'e.g. 1.35 Cr or 85 L', ...p }) {
  const [txt, setTxt] = useState(value != null ? inr(value).replace('₹', '') : '');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setTxt((t) => (parseMoney(t) === value || (value == null && t === '') ? t : value != null ? inr(value).replace('₹', '') : ''));
  }, [value]);
  return (
    <span style={{ display: 'block' }}>
      <span className="input-unit">
        <input type="text" value={txt} placeholder={placeholder} aria-invalid={bad} style={bad ? { borderColor: 'var(--danger)' } : null}
          onChange={(e) => {
            setTxt(e.target.value);
            const v = parseMoney(e.target.value);
            setBad(Number.isNaN(v));
            if (!Number.isNaN(v)) onChange(v);
          }} {...p} />
        <span className="unit">₹</span>
      </span>
      {(bad || (value != null && !/^\d+$/.test(String(txt).trim()))) && <span className={bad ? 'field-err' : 'help'} style={{ display: 'block', marginTop: 2 }}>{bad ? 'Use a number, or e.g. 1.35 Cr / 85 L' : `= ₹${Number(value).toLocaleString('en-IN')}`}</span>}
    </span>
  );
}
export function DateInput({ value, onChange, month, ...p }) {
  if (month) {
    return <input type="month" value={value ? value.slice(0, 7) : ''} onChange={(e) => onChange(e.target.value ? `${e.target.value}-01` : null)} {...p} />;
  }
  return <input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...p} />;
}
export function Select({ value, onChange, options, placeholder = 'Select…', allowEmpty = true, ...p }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : isNaN(e.target.value) ? e.target.value : Number(e.target.value))} {...p}>
      {allowEmpty && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
}
export function Seg({ value, onChange, options, ariaLabel }) {
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(value === o.value && o.toggle ? null : o.value)}>{o.label}</button>)}
    </div>
  );
}
export function Tristate({ value, onChange }) {
  return <Seg value={value} onChange={onChange} options={[{ value: 'yes', label: 'Yes', toggle: true }, { value: 'no', label: 'No', toggle: true }, { value: 'na', label: 'N/A', toggle: true }, { value: 'unknown', label: 'Unknown', toggle: true }]} />;
}
export function Toggle({ checked, onChange, label }) {
  return <label className="check"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>{t.label}{t.count != null && <span className="count">{t.count}</span>}</button>)}
    </div>
  );
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useOptions(list, labelKey = 'name', filter) {
  return useMemo(() => (list || []).filter((x) => (filter ? filter(x) : true)).map((x) => ({ value: x.id, label: x[labelKey] + (x.is_active === false ? ' (inactive)' : ''), disabled: x.is_active === false })), [list, labelKey, filter]);
}

export const SearchIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" strokeLinecap="round" /></svg>
);
export const Logo = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#0E6B66" /><path d="M16 6c-4.4 0-8 3.4-8 7.7C8 19.5 16 26 16 26s8-6.5 8-12.3C24 9.4 20.4 6 16 6zm0 10.6a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="#F6F7F5" /></svg>
);
