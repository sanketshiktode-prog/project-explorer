// Renders filter controls purely from filter definitions sent by the server.
// Adding a filter in Admin → Filters makes it appear here with no code change.
import { useMemo, useState } from 'react';
import { formatBy, inr } from '../format.js';
import { parseMoney } from './ui.jsx';

export function isEmptyValue(v) {
  if (v === undefined || v === null || v === '' || v === false) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return !(v.bands?.length) && (v.min == null || v.min === '') && (v.max == null || v.max === '');
  return false;
}

export function describeValue(def, v) {
  if (isEmptyValue(v)) return null;
  if (Array.isArray(v)) {
    const labels = v.map((id) => def.options?.find((o) => String(o.id) === String(id))?.label).filter(Boolean);
    return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ');
  }
  if (v === true) return def.label;
  if (v.bands?.length) return v.bands.map((id) => def.bands?.find((b) => b.id === id)?.label).filter(Boolean).join(', ');
  const f = (x) => formatBy(def.display_format, x);
  if (v.min != null && v.max != null) return `${f(v.min)} – ${f(v.max)}`;
  if (v.min != null) return `${f(v.min)}+`;
  return `up to ${f(v.max)}`;
}

export default function Filters({ defs, value, onChange }) {
  const set = (key, v) => {
    const next = { ...value, [key]: v };
    // Clear dependent children whose options no longer belong to the selected parents
    for (const child of defs.filter((d) => d.depends_on === key)) {
      const sel = next[child.key];
      if (Array.isArray(sel) && sel.length && Array.isArray(v) && v.length) {
        next[child.key] = sel.filter((id) => v.map(String).includes(String(child.options?.find((o) => String(o.id) === String(id))?.parent_id)));
      }
    }
    onChange(next);
  };
  return (
    <div>
      {defs.map((d) => <FilterGroup key={d.key} def={d} defs={defs} value={value[d.key]} all={value} onChange={(v) => set(d.key, v)} />)}
    </div>
  );
}

function FilterGroup({ def, defs, value, all, onChange }) {
  const [open, setOpen] = useState(def.is_primary || !isEmptyValue(value));
  const active = !isEmptyValue(value);
  return (
    <div className={`fgroup ${open ? '' : 'collapsed'}`}>
      <div className="fgroup-head">
        <button type="button" className="linkbtn" style={{ color: 'var(--ink)', display: 'flex', gap: 6, alignItems: 'center' }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span aria-hidden="true" style={{ fontSize: 10, width: 10, color: 'var(--ink-3)' }}>{open ? '▾' : '▸'}</span>
          <span className="lbl">{def.label}</span>
          {!open && active && <span className="badge brand">{describeValue(def, value)}</span>}
        </button>
        {active && <button type="button" className="linkbtn clear" onClick={() => onChange(undefined)}>Clear</button>}
      </div>
      <div className="fbody">
        {def.control === 'multiselect' || def.control === 'select' ? <MultiSelect def={def} defs={defs} value={value} all={all} onChange={onChange} single={def.control === 'select'} />
          : def.control === 'range' ? <RangeFilter def={def} value={value} onChange={onChange} />
            : def.control === 'bands' ? <BandChips def={def} value={value} onChange={onChange} />
              : def.control === 'toggle' ? <label className="check"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked || undefined)} />{def.help_text || 'Only show matching projects'}</label>
                : null}
      </div>
    </div>
  );
}

function MultiSelect({ def, defs, value, all, onChange, single }) {
  const [q, setQ] = useState('');
  const sel = (value || []).map(String);
  const parent = def.depends_on ? defs.find((d) => d.key === def.depends_on) : null;
  const parentSel = parent ? (all[parent.key] || []).map(String) : [];
  const opts = useMemo(() => (def.options || []).filter((o) => !parentSel.length || parentSel.includes(String(o.parent_id))), [def.options, parentSel]);
  const toggle = (id) => {
    const s = String(id);
    if (single) return onChange(sel.includes(s) ? undefined : [id]);
    onChange(sel.includes(s) ? (value || []).filter((x) => String(x) !== s) : [...(value || []), id]);
  };
  if (parent && !parentSel.length && opts.length > 12) {
    return <div className="help">Choose a {parent.label.toLowerCase()} first, or search: <input className="optsearch" style={{ marginTop: 6 }} placeholder={`Search ${def.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />{q && <OptList opts={opts} q={q} sel={sel} toggle={toggle} parentOpts={parent.options} />}</div>;
  }
  if (opts.length <= 20 && !parent) {
    return (
      <div className="chips">
        {opts.map((o) => <button type="button" key={o.id} className="chip" aria-pressed={sel.includes(String(o.id))} onClick={() => toggle(o.id)}>{o.label}</button>)}
      </div>
    );
  }
  return (
    <div>
      {sel.length > 0 && (
        <div className="chips" style={{ marginBottom: 6 }}>
          {sel.map((id) => { const o = def.options.find((x) => String(x.id) === id); return o ? <button type="button" key={id} className="chip" aria-pressed onClick={() => toggle(o.id)}>{o.label} ✕</button> : null; })}
        </div>
      )}
      {opts.length > 8 && <input className="optsearch" placeholder={`Search ${def.label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />}
      <OptList opts={opts} q={q} sel={sel} toggle={toggle} parentOpts={parent?.options} grouped={!!parent && parentSel.length !== 1} />
    </div>
  );
}

function OptList({ opts, q, sel, toggle, parentOpts, grouped }) {
  const shown = opts.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  if (!shown.length) return <div className="help" style={{ marginTop: 6 }}>No matches</div>;
  let lastParent = null;
  return (
    <div className="optlist">
      {shown.map((o) => {
        const head = grouped && o.parent_id !== lastParent ? parentOpts?.find((p) => p.id === o.parent_id)?.label : null;
        lastParent = o.parent_id;
        return (
          <div key={o.id}>
            {head && <div className="help" style={{ marginTop: 4 }}>{head}</div>}
            <label className="check"><input type="checkbox" checked={sel.includes(String(o.id))} onChange={() => toggle(o.id)} />{o.label}</label>
          </div>
        );
      })}
    </div>
  );
}

function BandChips({ def, value, onChange }) {
  const sel = value?.bands || [];
  return (
    <div className="chips">
      {(def.bands || []).map((b) => (
        <button type="button" key={b.id} className="chip" aria-pressed={sel.includes(b.id)}
          onClick={() => { const n = sel.includes(b.id) ? sel.filter((x) => x !== b.id) : [...sel, b.id]; onChange(n.length ? { bands: n } : undefined); }}>{b.label}</button>
      ))}
    </div>
  );
}

/** Quick bands AND a numeric slider — both write to the same filter. */
function RangeFilter({ def, value, onChange }) {
  const min = Number(def.min ?? 0);
  const max = Number(def.max ?? 100);
  const step = Number(def.step || 1);
  const bandsSel = value?.bands || [];
  // Effective numeric span (from bands or explicit values) drives the slider position
  const span = useMemo(() => {
    if (bandsSel.length) {
      const bs = def.bands.filter((b) => bandsSel.includes(b.id));
      const lo = Math.min(...bs.map((b) => (b.lower == null ? min : Number(b.lower))));
      const hi = Math.max(...bs.map((b) => (b.upper == null ? max : Number(b.upper))));
      return [lo, hi];
    }
    return [value?.min ?? min, value?.max ?? max];
  }, [value, def.bands, bandsSel, min, max]);
  const isInr = def.display_format === 'inr';
  const fmt = (v, edge) => (edge === 'max' && v >= max ? `${formatBy(def.display_format, max)}+` : edge === 'min' && v <= min ? 'Any' : formatBy(def.display_format, v));
  const setRange = (lo, hi) => {
    lo = Math.max(min, Math.min(lo, hi));
    hi = Math.min(max, Math.max(hi, lo));
    onChange(lo <= min && hi >= max ? undefined : { min: lo <= min ? null : lo, max: hi >= max ? null : hi });
  };
  const pct = (v) => ((Math.min(Math.max(v, min), max) - min) / (max - min)) * 100;
  return (
    <div>
      {def.bands?.length > 0 && (
        <div className="chips" style={{ marginBottom: 6 }}>
          {def.bands.map((b) => (
            <button type="button" key={b.id} className="chip" aria-pressed={bandsSel.includes(b.id)}
              onClick={() => { const n = bandsSel.includes(b.id) ? bandsSel.filter((x) => x !== b.id) : [...bandsSel, b.id]; onChange(n.length ? { bands: n } : undefined); }}>{b.label}</button>
          ))}
        </div>
      )}
      <div className="range-readout"><span>{fmt(span[0], 'min')}</span><span>{fmt(span[1], 'max')}</span></div>
      <div className="dual">
        <div className="track" />
        <div className="fill" style={{ left: `${pct(span[0])}%`, width: `${pct(span[1]) - pct(span[0])}%` }} />
        <input type="range" aria-label={`${def.label} minimum`} min={min} max={max} step={step} value={Math.min(span[0], max)} onChange={(e) => setRange(Number(e.target.value), span[1])} />
        <input type="range" aria-label={`${def.label} maximum`} min={min} max={max} step={step} value={Math.min(span[1], max)} onChange={(e) => setRange(span[0], Number(e.target.value))} />
      </div>
      <div className="range-inputs">
        <RangeBox placeholder="Min" isInr={isInr} value={bandsSel.length ? null : value?.min} onCommit={(v) => setRange(v ?? min, span[1])} />
        <RangeBox placeholder="Max" isInr={isInr} value={bandsSel.length ? null : value?.max} onCommit={(v) => setRange(span[0], v ?? max)} />
      </div>
      {def.match_mode === 'graded' && <div className="help" style={{ marginTop: 6 }}>Close values show as partial matches.</div>}
    </div>
  );
}

function RangeBox({ value, onCommit, placeholder, isInr }) {
  const [t, setT] = useState('');
  const shown = t !== '' ? t : value != null ? (isInr ? inr(value).replace('₹', '') : String(value)) : '';
  const commit = () => {
    if (t === '') return;
    const v = isInr ? parseMoney(t) : Number(t.replace(/,/g, ''));
    if (t.trim() === '') onCommit(null); else if (Number.isFinite(v)) onCommit(v);
    setT('');
  };
  return <input placeholder={isInr ? `${placeholder} (e.g. 1.2 Cr)` : placeholder} value={shown} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} aria-label={placeholder} />;
}
