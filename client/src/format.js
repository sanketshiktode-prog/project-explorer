export function inr(v, { short = false } = {}) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (n >= 1e7) return `₹${trim((n / 1e7).toFixed(2))}${short ? 'Cr' : ' Cr'}`;
  if (n >= 1e5) return `₹${trim((n / 1e5).toFixed(2))}${short ? 'L' : ' L'}`;
  return `₹${n.toLocaleString('en-IN')}`;
}
const trim = (s) => s.replace(/\.?0+$/, '');

export function inrRange(a, b, opts) {
  if (a == null && b == null) return '—';
  if (a == null || b == null || a === b) return inr(a ?? b, opts);
  if (a >= 1e7 && b >= 1e7) return `₹${trim((a / 1e7).toFixed(2))}–${trim((b / 1e7).toFixed(2))} Cr`;
  return `${inr(a, opts)} – ${inr(b, opts)}`;
}
export const num = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-IN'));
export function sqft(a, b) {
  if (a == null && b == null) return '—';
  if (a == null || b == null || Number(a) === Number(b)) return `${num(Math.round(a ?? b))} sq.ft.`;
  return `${num(Math.round(a))}–${num(Math.round(b))} sq.ft.`;
}
export const psf = (v) => (v == null ? '—' : `₹${num(Math.round(v))}`);
export function date(v, style = 'month') {
  if (!v) return '—';
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  if (Number.isNaN(d.getTime())) return v;
  if (style === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  if (style === 'day') return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function ago(v) {
  if (!v) return '—';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
export function formatBy(fmt, v) {
  if (v === null || v === undefined || v === '') return '—';
  switch (fmt) {
    case 'inr': return inr(v);
    case 'sqft': return `${num(v)} sq.ft.`;
    case 'psf': return `₹${num(v)}/sq.ft.`;
    case 'year': return String(v);
    case 'floors': return `G+${v}`;
    default: return num(v);
  }
}
export const STATUS_LABEL = {
  draft: 'Draft', under_review: 'Under review', verified: 'Verified', published: 'Published', needs_update: 'Needs update', inactive: 'Inactive', archived: 'Archived',
};
export const STATE_LABEL = { na: 'Not applicable', unknown: 'Unknown' };
/** Render a field value respecting "not provided / N/A / unknown". */
export function fieldValue(value, state, render = (x) => x) {
  if (value === null || value === undefined || value === '') {
    if (state === 'na') return { text: 'Not applicable', muted: true };
    if (state === 'unknown') return { text: 'Unknown', muted: true };
    return { text: 'Not provided', muted: true, missing: true };
  }
  return { text: render(value), muted: false };
}
