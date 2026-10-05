// Entity registry: the single server-side description of every editable column.
// Writes, imports, validation and audit all go through this — nothing writes a column
// that is not declared here, which keeps the API safe while the UI stays metadata-driven.
import { badRequest } from '../lib/util.js';

const text = (max = 500) => ({ t: 'text', max });
const long = { t: 'text', max: 20000 };
const int = (min = 0, max = 100000) => ({ t: 'int', min, max });
const num = (min = 0, max = 1e12) => ({ t: 'num', min, max });
const money = { t: 'num', min: 0, max: 1e11, integer: true };
const date = { t: 'date' };
const bool = { t: 'bool' };
const tristate = { t: 'enum', values: ['yes', 'no', 'na', 'unknown'] };
const ref = (table, list) => ({ t: 'ref', table, list });

export const ENTITIES = {
  project: {
    table: 'projects',
    label: 'Project',
    columns: {
      name: { ...text(200), required: true },
      developer_id: ref('developers'),
      parent_project_id: ref('projects'),
      phase_name: text(120),
      city_id: { ...ref('cities'), required: true },
      location_id: ref('locations'),
      sub_location_id: ref('sub_locations'),
      locality: text(300),
      landmark: text(300),
      address: text(1000),
      pincode: { t: 'text', max: 10, pattern: /^[0-9]{6}$/ },
      latitude: num(-90, 90),
      longitude: num(-180, 180),
      coords_status: { t: 'enum', values: ['unverified', 'approximate', 'verified'] },
      purpose_id: ref('master_values', 'purpose'),
      launch_stage_id: ref('master_values', 'launch_stage'),
      sales_status_id: ref('master_values', 'sales_status'),
      dev_possession_date: date,
      rera_possession_date: date,
      possession_remarks: long,
      land_parcel_acres: num(0, 100000),
      land_parcel_remarks: text(300),
      open_space_acres: num(0, 100000),
      open_space_pct: num(0, 100),
      open_space_remarks: text(300),
      total_towers: int(0, 1000),
      has_parking: tristate,
      basement_levels: int(0, 20),
      stilt_levels: int(0, 20),
      podium_levels: int(0, 30),
      parking_remarks: text(1000),
      eoi_type_id: ref('master_values', 'eoi_type'),
      eoi_amount: money,
      eoi_date: date,
      eoi_valid_until: date,
      eoi_remarks: long,
      amenity_remarks: long,
      developer_remarks: long,
      other_location_remarks: long,
      other_remarks: long,
      internal_notes: long,
      data_source: text(300),
    },
  },
  configuration: {
    table: 'project_configurations',
    label: 'Configuration',
    child: true,
    columns: {
      config_type_id: { ...ref('configuration_types'), required: true },
      variant: text(120),
      carpet_from: num(1, 1e6),
      carpet_to: num(1, 1e6),
      sbua_from: num(1, 1e6),
      sbua_to: num(1, 1e6),
      price_from: { ...money, min: 1 },
      price_to: { ...money, min: 1 },
      price_on_request: bool,
      dev_psf: num(1, 1e7),
      psf_basis: { t: 'enum', values: ['carpet', 'sbua'] },
      parking_count: int(0, 50),
      parking_remarks: text(300),
      inventory_status_id: ref('master_values', 'inventory_status'),
      inventory_details: text(1000),
      inventory_remarks: text(1000),
      remarks: text(1000),
      sort_order: int(0, 100000),
      is_active: bool,
    },
  },
  tower: {
    table: 'towers',
    label: 'Tower',
    child: true,
    columns: {
      name: { ...text(120), required: true },
      phase: text(120),
      represents_count: int(1, 500),
      flats_per_floor: int(0, 100),
      floors_above_ground: int(0, 200),
      habitable_from_floor: int(0, 200),
      main_lifts: int(0, 50),
      service_lifts: int(0, 50),
      parking_remarks: text(500),
      remarks: text(2000),
      sort_order: int(0, 100000),
      is_active: bool,
    },
  },
  offer: {
    table: 'offers', label: 'Offer', child: true,
    columns: { name: { ...text(200), required: true }, description: long, start_date: date, end_date: date, remarks: text(1000), sort_order: int(0, 100000), is_active: bool },
  },
  payment_plan: {
    table: 'payment_plans', label: 'Payment Plan', child: true,
    columns: { name: { ...text(200), required: true }, structure: text(100), applicable_to: text(100), remarks: text(1000), sort_order: int(0, 100000), is_active: bool },
  },
  objection: {
    table: 'objections', label: 'Objection', child: true,
    columns: { objection: { ...text(500), required: true }, response: long, tags: { t: 'tags' }, sort_order: int(0, 100000), is_active: bool },
  },
  highlight: {
    table: 'project_highlights', label: 'Highlight', child: true,
    columns: {
      kind: { t: 'enum', values: ['connectivity', 'location_advantage', 'usp_residential', 'usp_investment'], required: true },
      text: { ...text(1000), required: true }, travel_time_mins: int(0, 1000), distance_km: num(0, 10000), sort_order: int(0, 100000), is_active: bool,
    },
  },
  rera: {
    table: 'project_rera', label: 'RERA Registration', child: true,
    columns: { rera_number: { ...text(60), required: true }, phase_label: text(120), rera_possession_date: date, remarks: text(500), sort_order: int(0, 100000), is_active: bool },
  },
};

// URL segment → entity key for child collections
export const CHILD_ROUTES = {
  configurations: 'configuration',
  towers: 'tower',
  offers: 'offer',
  'payment-plans': 'payment_plan',
  objections: 'objection',
  highlights: 'highlight',
  rera: 'rera',
};

// Entities that store custom attributes / field states
export const FLEX_ENTITIES = { project: 'project', configuration: 'configuration', tower: 'tower' };

/** Coerce an incoming value to its column type, or throw a friendly 400. */
export function coerce(def, value, label) {
  if (value === undefined || value === null || value === '') return def.t === 'bool' ? false : def.t === 'tags' ? [] : null;
  const fail = (msg) => { throw badRequest(`${label}: ${msg}`, { field: label }); };
  switch (def.t) {
    case 'text': {
      const s = String(value).trim();
      if (!s) return null;
      if (def.max && s.length > def.max) fail(`must be at most ${def.max} characters`);
      if (def.pattern && !def.pattern.test(s)) fail('has an invalid format');
      return s;
    }
    case 'int': {
      const n = Number(value);
      if (!Number.isInteger(n)) fail('must be a whole number');
      if (def.min !== undefined && n < def.min) fail(`must be ≥ ${def.min}`);
      if (def.max !== undefined && n > def.max) fail(`must be ≤ ${def.max}`);
      return n;
    }
    case 'num': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      if (!Number.isFinite(n)) fail('must be a number');
      if (def.min !== undefined && n < def.min) fail(`must be ≥ ${def.min}`);
      if (def.max !== undefined && n > def.max) fail(`must be ≤ ${def.max}`);
      return def.integer ? Math.round(n) : n;
    }
    case 'date': {
      const s = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail('must be a date (YYYY-MM-DD)');
      return s;
    }
    case 'bool':
      return value === true || value === 'true' || value === 1 || value === '1' || value === 'yes';
    case 'enum':
      if (!def.values.includes(String(value))) fail(`must be one of ${def.values.join(', ')}`);
      return String(value);
    case 'ref': {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) fail('is not a valid reference');
      return n;
    }
    case 'tags':
      return (Array.isArray(value) ? value : String(value).split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
    default:
      return value;
  }
}

/** Coerce a custom attribute value according to its field definition. */
export function coerceAttribute(fd, value) {
  const label = fd.label;
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return null;
  switch (fd.data_type) {
    case 'number': case 'area': case 'money': case 'integer': {
      const def = { t: fd.data_type === 'integer' ? 'int' : 'num', min: fd.validation?.min ?? -1e12, max: fd.validation?.max ?? 1e12, integer: fd.data_type === 'money' };
      return coerce(def, value, label);
    }
    case 'date': return coerce({ t: 'date' }, value, label);
    case 'boolean': return coerce({ t: 'bool' }, value, label);
    case 'tristate': return coerce({ t: 'enum', values: ['yes', 'no', 'na', 'unknown'] }, value, label);
    case 'select': return coerce({ t: 'ref' }, value, label);
    case 'multiselect': return (Array.isArray(value) ? value : [value]).map((v) => coerce({ t: 'ref' }, v, label));
    case 'text': return coerce({ t: 'text', max: 500 }, value, label);
    case 'longtext': default: return coerce({ t: 'text', max: 20000 }, value, label);
  }
}

export const FIELD_STATES = ['na', 'unknown'];
