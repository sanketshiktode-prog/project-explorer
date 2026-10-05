// Controlled bulk import: Upload → Preview → Column mapping → Validation → Duplicate check →
// Error report → Confirm → Import. Nothing touches project tables until "commit", and
// everything is created as DRAFT so it still goes through review before sales can see it.
import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { requirePerm } from '../middleware/auth.js';
import { query, tx } from '../db.js';
import { getMeta } from '../services/meta.js';
import { createRecord, writeAudit } from '../services/records.js';
import { findDuplicates } from '../services/projects.js';
import { badRequest, conflict, notFound, normalizeName, normalizeProjectName } from '../lib/util.js';

const r = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const MAX_ROWS = 5000;

// target fields: key, label, kind, aliases
const TARGETS = {
  projects: [
    ['name', 'Project Name', 'text', ['project', 'project name', 'name']], ['developer', 'Developer', 'developer', ['developer', 'builder']],
    ['city', 'City', 'city', ['city']], ['location', 'Location', 'location', ['location', 'area', 'region']], ['sub_location', 'Sub-location', 'sub_location', ['sub location', 'sublocation', 'micro market']],
    ['locality', 'Locality / Sector', 'text', ['locality', 'sector']], ['landmark', 'Landmark', 'text', ['landmark']], ['address', 'Address', 'text', ['address']],
    ['latitude', 'Latitude', 'number', ['latitude', 'lat']], ['longitude', 'Longitude', 'number', ['longitude', 'lng', 'long', 'lon']],
    ['purpose', 'Purpose', 'master:purpose', ['purpose', 'purpose of purchase']], ['launch_stage', 'Launch Stage', 'master:launch_stage', ['launch stage', 'stage']],
    ['sales_status', 'Project Status', 'master:sales_status', ['project status', 'status', 'sales status']],
    ['dev_possession_date', 'Developer Possession', 'date', ['developer possession', 'dev possession', 'possession']], ['rera_possession_date', 'RERA Possession', 'date', ['rera possession']],
    ['land_parcel_acres', 'Land Parcel (acres)', 'number', ['land parcel', 'land area', 'acres']], ['open_space_acres', 'Open Space (acres)', 'number', ['open space']],
    ['total_towers', 'Total Towers', 'int', ['total towers', 'no of towers', 'towers']],
    ['eoi_type', 'EOI Type', 'master:eoi_type', ['eoi type', 'eoi']], ['eoi_amount', 'EOI Amount', 'money', ['eoi amount']], ['eoi_remarks', 'EOI Remarks', 'text', ['eoi remarks']],
    ['rera_numbers', 'RERA Number(s)', 'list', ['rera', 'rera number', 'rera no']],
    ['other_remarks', 'Other Remarks', 'text', ['other remarks', 'remarks']], ['internal_notes', 'Internal Notes', 'text', ['internal notes', 'notes']], ['data_source', 'Data Source', 'text', ['data source', 'source']],
  ],
  configurations: [
    ['project', 'Project (ID or exact name)', 'project', ['project id', 'project', 'project name']], ['configuration', 'Configuration', 'config_type', ['configuration', 'config', 'bhk', 'type']],
    ['variant', 'Variant', 'text', ['variant']], ['carpet_from', 'Carpet From', 'number', ['carpet', 'carpet from', 'carpet area']], ['carpet_to', 'Carpet To', 'number', ['carpet to']],
    ['sbua_from', 'Super Built-up From', 'number', ['super builtup', 'super built up', 'sbua', 'saleable']], ['sbua_to', 'Super Built-up To', 'number', ['sbua to']],
    ['price_from', 'Price From', 'money', ['price', 'price from', 'base price']], ['price_to', 'Price To', 'money', ['price to']], ['price_on_request', 'Price on Request', 'bool', ['price on request', 'por']],
    ['dev_psf', 'Developer ₹/sq.ft.', 'number', ['developer psf', 'psf developer', 'rate']], ['parking_count', 'Parking (nos.)', 'int', ['parking']],
    ['inventory_status', 'Inventory Status', 'master:inventory_status', ['inventory status', 'inventory']], ['inventory_details', 'Inventory Details', 'text', ['inventory details']],
    ['remarks', 'Configuration Remarks', 'text', ['configuration remarks', 'remarks']],
  ],
  towers: [
    ['project', 'Project (ID or exact name)', 'project', ['project id', 'project', 'project name']], ['name', 'Tower Name', 'text', ['tower', 'tower name', 'name']],
    ['phase', 'Phase', 'text', ['phase']], ['represents_count', 'Represents (no. of towers)', 'int', ['represents', 'count']],
    ['flats_per_floor', 'Flats per Floor', 'int', ['flats per floor', 'no of flats on one floor']], ['floors_above_ground', 'Floors (G+)', 'int', ['floors', 'above ground floors']],
    ['habitable_from_floor', 'Habitable From Floor', 'int', ['habitable floor starts from', 'habitable from']], ['main_lifts', 'Main Lifts', 'int', ['main lifts', 'lifts']],
    ['service_lifts', 'Service Lifts', 'int', ['service lifts']], ['remarks', 'Tower Remarks', 'text', ['tower remarks', 'remarks']],
  ],
};
const ENTITY_FOR = { projects: 'project', configurations: 'configuration', towers: 'tower' };

async function targetsFor(entity) {
  const meta = await getMeta();
  const base = TARGETS[entity].map(([key, label, kind, aliases]) => ({ key, label, kind, aliases }));
  const custom = meta.fields.filter((f) => f.entity === ENTITY_FOR[entity] && f.storage === 'attribute' && f.is_active)
    .map((f) => ({ key: `attr.${f.key}`, label: `${f.label} (custom)`, kind: `attr`, aliases: [f.label.toLowerCase(), f.key.replace(/_/g, ' ')], field: f }));
  return [...base, ...custom];
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[₹().,/_-]+/g, ' ').replace(/\s+/g, ' ').trim();

export function parseMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).toLowerCase().replace(/[₹,\s]|rs\.?|inr/g, '');
  const m = s.match(/^(\d+(?:\.\d+)?)(cr|crore|crores|l|lac|lakh|lakhs|k)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  const mult = { cr: 1e7, crore: 1e7, crores: 1e7, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, k: 1e3 }[m[2]] || 1;
  return Math.round(n * mult);
}
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${(m[3] || '01').padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/-](\d{4})$/); // 06/2030
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}-01`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/yyyy (Indian format)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.toLowerCase().match(/^([a-z]{3})[a-z]*[\s'-]*(\d{2,4})$/); // Jun 2030, Dec'32
  if (m && months.includes(m[1])) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${String(months.indexOf(m[1]) + 1).padStart(2, '0')}-01`;
  if (/^\d{4}$/.test(s)) return `${s}-12-01`;
  return 'INVALID';
}

async function parseFile(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.csv')) {
    const recs = parseCsv(file.buffer.toString('utf8').replace(/^﻿/, ''), { columns: false, skip_empty_lines: true, relax_column_count: true });
    const [headers, ...rows] = recs;
    return { headers: headers.map((h) => String(h).trim()), rows: rows.map((r) => Object.fromEntries(headers.map((h, i) => [String(h).trim(), r[i] ?? null]))) };
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const ws = wb.worksheets.find((w) => w.state === 'visible' && w.actualRowCount > 1) || wb.worksheets[0];
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = String(c.text || '').trim(); });
    const rows = [];
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const o = {};
      headers.forEach((h, j) => {
        if (!h) return;
        const c = row.getCell(j + 1);
        let v = c.value;
        if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : null);
        o[h] = v === undefined ? null : v;
      });
      if (Object.values(o).some((x) => x !== null && x !== '')) rows.push(o);
    });
    return { headers: headers.filter(Boolean), rows, sheet: ws.name };
  }
  throw badRequest('Upload a .csv or .xlsx file');
}

function suggestMapping(headers, targets) {
  const out = {};
  const used = new Set();
  for (const h of headers) {
    const n = norm(h);
    const t = targets.find((x) => !used.has(x.key) && (norm(x.label) === n || x.aliases.includes(n) || norm(x.key) === n));
    out[h] = t ? t.key : null;
    if (t) used.add(t.key);
  }
  return out;
}

r.get('/', requirePerm('import.run'), wrap(async (_req, res) => {
  res.json((await query(`SELECT b.id, b.entity, b.file_name, b.status, b.created_at, b.committed_at, jsonb_array_length(b.rows) AS row_count, b.report->'summary' AS summary, u.name AS user_name
    FROM import_batches b LEFT JOIN users u ON u.id=b.user_id ORDER BY b.created_at DESC LIMIT 30`)).rows);
}));

r.get('/targets/:entity', requirePerm('import.run'), wrap(async (req, res) => {
  if (!TARGETS[req.params.entity]) throw notFound();
  res.json(await targetsFor(req.params.entity));
}));

r.get('/template/:entity', requirePerm('import.run'), wrap(async (req, res) => {
  if (!TARGETS[req.params.entity]) throw notFound();
  const t = await targetsFor(req.params.entity);
  res.type('text/csv').attachment(`${req.params.entity}-template.csv`).send(`﻿${t.map((x) => `"${x.label}"`).join(',')}\n`);
}));

r.post('/upload', requirePerm('import.run'), upload.single('file'), wrap(async (req, res) => {
  const entity = req.body?.entity;
  if (!TARGETS[entity]) throw badRequest('Choose what you are importing: projects, configurations or towers');
  if (!req.file) throw badRequest('No file uploaded');
  const parsed = await parseFile(req.file);
  if (!parsed.rows.length) throw badRequest('The file has no data rows');
  if (parsed.rows.length > MAX_ROWS) throw badRequest(`Too many rows (${parsed.rows.length}). Split the file into batches of ${MAX_ROWS}.`);
  const targets = await targetsFor(entity);
  const mapping = suggestMapping(parsed.headers, targets);
  const id = crypto.randomUUID();
  const rows = parsed.rows.map((rw) => Object.fromEntries(Object.entries(rw).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v])));
  await query('INSERT INTO import_batches (id, user_id, entity, file_name, headers, rows, mapping) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, req.user.id, entity, req.file.originalname, JSON.stringify(parsed.headers), JSON.stringify(rows), JSON.stringify(mapping)]);
  res.status(201).json({ id, entity, file_name: req.file.originalname, sheet: parsed.sheet, headers: parsed.headers, row_count: rows.length, preview: rows.slice(0, 15), mapping, targets });
}));

async function loadBatch(id, user) {
  const b = (await query('SELECT * FROM import_batches WHERE id=$1', [id])).rows[0];
  if (!b) throw notFound('Import not found');
  if (b.user_id !== user.id && !user.permissions.has('config.manage')) throw notFound('Import not found');
  return b;
}

r.get('/:id', requirePerm('import.run'), wrap(async (req, res) => {
  const b = await loadBatch(req.params.id, req.user);
  res.json({ ...b, rows: undefined, row_count: b.rows.length, preview: b.rows.slice(0, 15), targets: await targetsFor(b.entity) });
}));

/** Resolve one raw row into typed values + messages. */
async function resolveRow(entity, raw, mapping, targets, meta, ctx) {
  const msgs = [];
  const values = {};
  const attributes = {};
  const extra = {};
  const err = (m) => msgs.push({ level: 'error', message: m });
  const warn = (m) => msgs.push({ level: 'warning', message: m });
  const get = (key) => { const h = Object.keys(mapping).find((k) => mapping[k] === key); return h ? raw[h] : undefined; };
  const findByName = (arr, v, field = 'name') => arr.find((x) => norm(x[field]) === norm(v));
  for (const t of targets) {
    const v = get(t.key);
    if (v === undefined || v === null || String(v).trim() === '') continue;
    const sv = String(v).trim();
    switch (t.kind) {
      case 'text': values[t.key] = sv; break;
      case 'number': case 'int': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
        const num = Number.isFinite(n) ? n : Number(String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0]);
        if (!Number.isFinite(num)) err(`${t.label}: "${sv}" is not a number`);
        else { values[t.key] = t.kind === 'int' ? Math.round(num) : num; if (!Number.isFinite(n)) warn(`${t.label}: used ${num} from "${sv}"`); }
        break;
      }
      case 'money': { const m = parseMoney(v); if (Number.isNaN(m)) err(`${t.label}: "${sv}" is not a valid amount (e.g. 13500000, 1.35 Cr, 85 L)`); else values[t.key] = m; break; }
      case 'bool': values[t.key] = ['yes', 'y', 'true', '1', 'por'].includes(sv.toLowerCase()); break;
      case 'date': { const d = parseDate(v); if (d === 'INVALID') err(`${t.label}: "${sv}" is not a recognisable date`); else values[t.key] = d; break; }
      case 'list': extra[t.key] = sv.split(/[,|;\n]/).map((x) => x.trim()).filter(Boolean); break;
      case 'developer': {
        const d = meta.developers.find((x) => normalizeName(x.name) === normalizeName(sv) || (x.aliases || []).some((a) => normalizeName(a) === normalizeName(sv)));
        if (d) values.developer_id = d.id;
        else if (ctx.createDevelopers) { extra.new_developer = sv; warn(`Developer "${sv}" will be created`); }
        else err(`Developer "${sv}" not found in master data`);
        break;
      }
      case 'city': { const c = findByName(meta.cities, sv) || meta.cities.find((x) => x.code === sv.toUpperCase()); if (c) values.city_id = c.id; else err(`City "${sv}" not found`); break; }
      case 'location': extra.location_name = sv; break;
      case 'sub_location': extra.sub_location_name = sv; break;
      case 'config_type': {
        const ct = meta.configTypes.find((x) => norm(x.label) === norm(sv) || norm(x.code) === norm(sv)) || meta.configTypes.find((x) => norm(x.label).replace(/ bhk$/, '') === norm(sv).replace(/ bhk$/, ''));
        if (ct) values.config_type_id = ct.id; else err(`Configuration "${sv}" not found in master data`);
        break;
      }
      case 'project': {
        const p = ctx.projects.find((x) => x.public_id.toLowerCase() === sv.toLowerCase()) || ctx.projects.filter((x) => normalizeProjectName(x.name) === normalizeProjectName(sv));
        if (Array.isArray(p)) { if (p.length === 1) extra.project_id = p[0].id; else if (p.length > 1) err(`Project name "${sv}" is ambiguous — use the project ID`); else err(`Project "${sv}" not found`); }
        else extra.project_id = p.id;
        break;
      }
      case 'attr': {
        const f = t.field;
        if (['select', 'multiselect'].includes(f.data_type)) {
          const ids = sv.split(/[,;|]/).map((x) => meta.masterValues.find((mv) => mv.list_key === f.master_list_key && norm(mv.label) === norm(x))?.id);
          if (ids.some((x) => !x)) err(`${f.label}: unknown value "${sv}"`); else attributes[f.key] = f.data_type === 'select' ? ids[0] : ids;
        } else if (['number', 'integer', 'area', 'money'].includes(f.data_type)) {
          const n = f.data_type === 'money' ? parseMoney(v) : Number(String(v).replace(/,/g, ''));
          if (!Number.isFinite(n)) err(`${f.label}: not a number`); else attributes[f.key] = n;
        } else if (f.data_type === 'tristate') {
          const m = { yes: 'yes', y: 'yes', no: 'no', n: 'no', 'n/a': 'na', na: 'na', unknown: 'unknown' }[sv.toLowerCase()];
          if (!m) err(`${f.label}: use Yes / No / N/A / Unknown`); else attributes[f.key] = m;
        } else attributes[f.key] = sv;
        break;
      }
      default:
        if (t.kind.startsWith('master:')) {
          const list = t.kind.slice(7);
          const mv = meta.masterValues.find((x) => x.list_key === list && (norm(x.label) === norm(sv) || norm(x.code) === norm(sv)));
          const col = { purpose: 'purpose_id', launch_stage: 'launch_stage_id', sales_status: 'sales_status_id', eoi_type: 'eoi_type_id', inventory_status: 'inventory_status_id' }[list];
          if (mv) values[col] = mv.id; else err(`${t.label}: "${sv}" is not one of ${meta.masterValues.filter((x) => x.list_key === list && x.is_active).map((x) => x.label).join(', ')}`);
        }
    }
  }
  // Hierarchy
  if (entity === 'projects') {
    if (!values.name) err('Project Name is required');
    if (!values.city_id) err('City is required');
    if (extra.location_name && values.city_id) {
      const l = meta.locations.find((x) => x.city_id === values.city_id && norm(x.name) === norm(extra.location_name));
      if (l) values.location_id = l.id; else err(`Location "${extra.location_name}" not found in that city`);
    }
    if (extra.sub_location_name) {
      const s = meta.subLocations.find((x) => (!values.location_id || x.location_id === values.location_id) && norm(x.name) === norm(extra.sub_location_name));
      if (s) { values.sub_location_id = s.id; if (!values.location_id) values.location_id = s.location_id; } else err(`Sub-location "${extra.sub_location_name}" not found`);
    }
    if ((values.latitude == null) !== (values.longitude == null)) err('Latitude and longitude must both be given');
    if (values.latitude != null && (values.latitude < -90 || values.latitude > 90)) err('Latitude out of range');
    if (!values.developer_id && !extra.new_developer) warn('No developer');
    if (values.latitude == null) warn('No map coordinates');
  }
  if (entity !== 'projects' && !extra.project_id && !msgs.some((m) => m.message.startsWith('Project'))) err('Project is required');
  if (entity === 'configurations') {
    if (!values.config_type_id && !msgs.length) err('Configuration is required');
    if (values.price_from && values.price_to && values.price_from > values.price_to) err('Price From is greater than Price To');
    if (values.carpet_from && values.carpet_to && values.carpet_from > values.carpet_to) err('Carpet From is greater than Carpet To');
    if (!values.price_from && !values.price_on_request) warn('No price');
  }
  if (entity === 'towers') {
    if (!values.name) err('Tower name is required');
    if (values.habitable_from_floor != null && values.floors_above_ground != null && values.habitable_from_floor > values.floors_above_ground) err('Habitable floor is above the top floor');
  }
  return { values, attributes, extra, msgs };
}

r.post('/:id/validate', requirePerm('import.run'), wrap(async (req, res) => {
  const b = await loadBatch(req.params.id, req.user);
  if (b.status === 'committed') throw conflict('This import has already been committed');
  const mapping = req.body?.mapping || b.mapping;
  const options = req.body?.options || {};
  const targets = await targetsFor(b.entity);
  const mappedKeys = Object.values(mapping).filter(Boolean);
  if (new Set(mappedKeys).size !== mappedKeys.length) throw badRequest('Two columns are mapped to the same field');
  const required = { projects: ['name', 'city'], configurations: ['project', 'configuration'], towers: ['project', 'name'] }[b.entity];
  const missingReq = required.filter((k) => !mappedKeys.includes(k));
  if (missingReq.length) throw badRequest(`Map a column to: ${missingReq.map((k) => targets.find((t) => t.key === k).label).join(', ')}`);
  const meta = await getMeta();
  const ctx = { createDevelopers: !!options.create_missing_developers, projects: (await query("SELECT id, public_id, name FROM projects WHERE record_status <> 'archived'")).rows };
  const report = [];
  const seenNames = new Map();
  for (let i = 0; i < b.rows.length; i += 1) {
    const out = await resolveRow(b.entity, b.rows[i], mapping, targets, meta, ctx);
    const row = { row: i + 2, status: 'ok', messages: out.msgs, duplicates: [] };
    if (b.entity === 'projects' && out.values.name) {
      const key = `${normalizeProjectName(out.values.name)}|${out.values.city_id}`;
      if (seenNames.has(key)) out.msgs.push({ level: 'error', message: `Same project appears earlier in this file (row ${seenNames.get(key)})` });
      else seenNames.set(key, row.row);
      if (!out.msgs.some((m) => m.level === 'error')) row.duplicates = await findDuplicates({ ...out.values });
    }
    if (b.entity === 'towers' && out.extra.project_id && out.values.name) {
      const ex = (await query('SELECT 1 FROM towers WHERE project_id=$1 AND lower(name)=lower($2) AND is_active', [out.extra.project_id, out.values.name])).rows.length;
      if (ex) out.msgs.push({ level: 'error', message: `Tower "${out.values.name}" already exists in that project` });
    }
    row.status = out.msgs.some((m) => m.level === 'error') ? 'error' : row.duplicates.length ? 'duplicate' : out.msgs.some((m) => m.level === 'warning') ? 'warning' : 'ok';
    row.label = out.values.name || [out.values.config_type_id && meta.configTypes.find((c) => c.id === out.values.config_type_id)?.label, out.values.price_from].filter(Boolean).join(' · ') || null;
    report.push(row);
  }
  const summary = { total: report.length, ok: report.filter((x) => x.status === 'ok').length, warning: report.filter((x) => x.status === 'warning').length, duplicate: report.filter((x) => x.status === 'duplicate').length, error: report.filter((x) => x.status === 'error').length };
  await query("UPDATE import_batches SET mapping=$2, report=$3, status='validated' WHERE id=$1", [b.id, JSON.stringify(mapping), JSON.stringify({ summary, rows: report, options })]);
  res.json({ summary, rows: report });
}));

r.get('/:id/report.csv', requirePerm('import.run'), wrap(async (req, res) => {
  const b = await loadBatch(req.params.id, req.user);
  if (!b.report) throw badRequest('Validate the import first');
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = ['Row,Status,Messages,Possible duplicates'];
  for (const r0 of b.report.rows) lines.push([r0.row, r0.status, esc(r0.messages.map((m) => `${m.level.toUpperCase()}: ${m.message}`).join(' | ')), esc((r0.duplicates || []).map((d) => `${d.public_id} ${d.name}`).join(' | '))].join(','));
  res.type('text/csv').attachment(`import-report-${b.id.slice(0, 8)}.csv`).send(`﻿${lines.join('\n')}`);
}));

r.post('/:id/commit', requirePerm('import.run'), wrap(async (req, res) => {
  const b = await loadBatch(req.params.id, req.user);
  if (b.status !== 'validated' || !b.report) throw conflict('Validate the import before committing');
  const allowDup = new Set((req.body?.include_duplicate_rows || []).map(Number));
  const targets = await targetsFor(b.entity);
  const meta = await getMeta();
  const ctx = { createDevelopers: !!b.report.options?.create_missing_developers, projects: (await query("SELECT id, public_id, name FROM projects WHERE record_status <> 'archived'")).rows };
  const result = await tx(async (c) => {
    const created = [];
    const skipped = [];
    const newDevs = {};
    for (let i = 0; i < b.rows.length; i += 1) {
      const rep = b.report.rows[i];
      if (rep.status === 'error') { skipped.push({ row: rep.row, reason: 'errors' }); continue; }
      if (rep.status === 'duplicate' && !allowDup.has(rep.row)) { skipped.push({ row: rep.row, reason: 'possible duplicate not confirmed' }); continue; }
      const out = await resolveRow(b.entity, b.rows[i], b.mapping, targets, meta, ctx); // re-resolve against current data
      if (out.msgs.some((m) => m.level === 'error')) { skipped.push({ row: rep.row, reason: out.msgs.filter((m) => m.level === 'error').map((m) => m.message).join('; ') }); continue; }
      const note = `Imported from ${b.file_name} row ${rep.row}${rep.status === 'duplicate' ? ' (duplicate check overridden)' : ''}`;
      if (b.entity === 'projects') {
        if (out.extra.new_developer) {
          const key = normalizeName(out.extra.new_developer);
          if (!newDevs[key]) {
            const ex = (await c.query('SELECT id FROM developers WHERE normalized_name=$1', [key])).rows[0];
            newDevs[key] = ex ? ex.id : (await c.query('INSERT INTO developers (name, normalized_name) VALUES ($1,$2) RETURNING id', [out.extra.new_developer, key])).rows[0].id;
          }
          out.values.developer_id = newDevs[key];
        }
        const p = await createRecord(c, { entity: 'project', values: out.values, attributes: out.attributes, user: req.user, batchId: b.id, note });
        for (const rn of out.extra.rera_numbers || []) await createRecord(c, { entity: 'rera', projectId: p.id, values: { rera_number: rn }, user: req.user, batchId: b.id });
        created.push({ row: rep.row, id: p.id, public_id: p.public_id, name: p.name });
      } else {
        const entity = ENTITY_FOR[b.entity];
        const row = await createRecord(c, { entity, projectId: out.extra.project_id, values: out.values, attributes: out.attributes, user: req.user, batchId: b.id, note });
        created.push({ row: rep.row, id: row.id, project_id: out.extra.project_id });
      }
    }
    await c.query("UPDATE import_batches SET status='committed', committed_at=now(), report = report || $2 WHERE id=$1", [b.id, JSON.stringify({ result: { created: created.length, skipped } })]);
    await writeAudit(c, [{ user_id: req.user.id, action: 'import', entity: b.entity, entity_id: b.id, batch_id: b.id, new_value: { created: created.length, skipped: skipped.length }, note: b.file_name }]);
    return { created, skipped };
  });
  res.json(result);
}));

r.post('/:id/cancel', requirePerm('import.run'), wrap(async (req, res) => {
  const b = await loadBatch(req.params.id, req.user);
  if (b.status === 'committed') throw conflict('Already committed');
  await query("UPDATE import_batches SET status='cancelled' WHERE id=$1", [b.id]);
  res.json({ ok: true });
}));

export default r;
