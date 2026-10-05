export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const badRequest = (m, d) => new HttpError(400, m, d);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'You do not have permission to do this') => new HttpError(403, m);
export const conflict = (m, d) => new HttpError(409, m, d);

/** Lower-case, strip punctuation & common filler words – used for duplicate detection. */
export function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|pvt|private|ltd|limited|llp|group|realty|developers?|properties|builders?|constructions?|infra(structure)?|corp(oration)?|homes)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/** Project-name normalisation keeps words like "homes"/"residences" meaningful, strips only punctuation. */
export function normalizeProjectName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatINR(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.?0+$/, '')} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Stable JSON comparison for audit diffs. */
export function same(a, b) {
  const norm = (v) => (v === undefined || v === '' ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}
