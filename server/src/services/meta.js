// Cached metadata: settings, masters, field / filter / band definitions.
// Admin writes call invalidate(); reads are served from memory so the explorer stays fast.
import { query } from '../db.js';

let cache = null;
let loadedAt = 0;
let version = 1;
// On a single server the cache lives until an admin change invalidates it. On Cloudflare Workers
// several isolates run at once, so each also refreshes after META_CACHE_TTL_MS (set in wrangler.jsonc).
const ttl = () => Number(process.env.META_CACHE_TTL_MS || 0);

export function invalidate() {
  cache = null;
  version += 1;
}
export const metaVersion = () => version;

async function load() {
  const [settings, lists, values, cities, locations, subs, devs, ctypes, amen, fields, filters, bandSets, bands] = await Promise.all([
    query('SELECT key, value, label, description, updated_at FROM app_settings ORDER BY key'),
    query('SELECT * FROM master_lists ORDER BY name'),
    query('SELECT id, list_key, code, label, sort_order, is_active, meta, row_version FROM master_values ORDER BY list_key, sort_order, label'),
    query('SELECT * FROM cities ORDER BY sort_order, name'),
    query('SELECT * FROM locations ORDER BY sort_order, name'),
    query('SELECT * FROM sub_locations ORDER BY sort_order, name'),
    query('SELECT id, name, aliases, about, website, is_active, merged_into_id, row_version FROM developers WHERE merged_into_id IS NULL ORDER BY name'),
    query('SELECT * FROM configuration_types ORDER BY sort_order, label'),
    query(`SELECT a.*, mv.label AS category_label, mv.sort_order AS category_sort FROM amenities a JOIN master_values mv ON mv.id = a.category_id ORDER BY mv.sort_order, a.sort_order, a.name`),
    query('SELECT * FROM field_definitions ORDER BY entity, sort_order, id'),
    query('SELECT * FROM filter_definitions ORDER BY sort_order, id'),
    query('SELECT * FROM band_sets ORDER BY label'),
    query('SELECT * FROM band_definitions ORDER BY band_set_key, sort_order, lower_bound NULLS FIRST'),
  ]);
  const s = Object.fromEntries(settings.rows.map((r) => [r.key, r.value]));
  return {
    version,
    settings: s,
    settingsRows: settings.rows,
    masterLists: lists.rows,
    masterValues: values.rows,
    masterById: new Map(values.rows.map((v) => [v.id, v])),
    cities: cities.rows,
    locations: locations.rows,
    subLocations: subs.rows,
    developers: devs.rows,
    configTypes: ctypes.rows,
    amenities: amen.rows,
    fields: fields.rows,
    filters: filters.rows,
    bandSets: bandSets.rows,
    bands: bands.rows,
  };
}

export async function getMeta() {
  if (cache && ttl() && Date.now() - loadedAt > ttl()) cache = null;
  if (!cache) { cache = await load(); loadedAt = Date.now(); }
  return cache;
}

export async function setting(key, fallback) {
  const m = await getMeta();
  return m.settings[key] ?? fallback;
}

/** Master values for a list, optionally only active ones. */
export function listValues(meta, listKey, activeOnly = true) {
  return meta.masterValues.filter((v) => v.list_key === listKey && (!activeOnly || v.is_active));
}

export function masterCode(meta, id) {
  return id ? meta.masterById.get(Number(id))?.code ?? null : null;
}
