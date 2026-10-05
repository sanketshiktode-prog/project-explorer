// Synthetic SAMPLE projects for testing filters, matching, data quality and workflows.
// All names below are fictional and every record is marked "Sample data (fictional)".
import { createRecord, updateRecord } from '../../src/services/records.js';
import { normalizeName } from '../../src/lib/util.js';

const SOURCE = 'Sample data (fictional) — for testing only';

// ₹/sq.ft. (carpet) by sub-location — rough market levels used to make prices realistic
const PSF = {
  Kharghar: 16000, Vashi: 22000, Sanpada: 24000, Juinagar: 20000, Panvel: 11000, Nerul: 21000, Ulwe: 12500, 'CBD Belapur': 17000, Taloja: 9000,
  'Ghodbunder Road': 15000, Majiwada: 18000, 'Kolshet Road': 17000, Andheri: 32000, Goregaon: 28000, Malad: 25000, Powai: 30000, Chembur: 27000, Mulund: 21000,
  Alibaug: 15000, Karjat: 7000, Hinjewadi: 9000, Baner: 12500, Wakad: 10000, Kharadi: 11500, Hadapsar: 9000, Wagholi: 7000,
  Hebbal: 13000, Yelahanka: 9500, Devanahalli: 7500, Whitefield: 11000, 'Sarjapur Road': 9500, Varthur: 9000,
  Gachibowli: 11000, Kokapet: 12000, Kondapur: 10500, Kompally: 7500, Bachupally: 6500,
  'Sector 102': 11000, 'Sector 113': 13000, 'Sector 65': 18000, 'Sector 63A': 16000, 'Sector 150': 11000, 'Sector 128': 14000, 'Gaur City': 7000, 'Techzone 4': 6500,
};
const AREA = { Studio: [300, 360], '1 BHK': [380, 480], '2 BHK': [600, 780], '3 BHK': [900, 1250], '4 BHK': [1400, 1900], '5 BHK': [2200, 2800], Villa: [2400, 3600], Plot: [1800, 4500], Office: [450, 1200], '2.5 BHK': [820, 900], '1+1 BHK (Jodi)': [900, 980] };
const AREA_MULT = { MUM: 1, PUN: 1.1, BLR: 1.4, HYD: 1.5, GGN: 1.5, NOI: 1.4 };

// Deterministic RNG so the sample data is identical on every machine
let seed = 20261003;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const between = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const round = (n, to) => Math.round(n / to) * to;

const DEVS = [
  ['Aurum Crest Realty', 'Mumbai-based developer focused on mid-premium residential towers in Navi Mumbai.'],
  ['Bluestone Estates', 'Township developer active across MMR and Pune.'],
  ['Cedarwood Constructions', 'Mid-segment residential developer.'],
  ['Indus Horizon Builders', 'Developer of large-format gated communities.'],
  ['Meridian Spaces', 'Premium urban residences.'],
  ['Northstar Infra', 'Affordable and mid-income housing developer.'],
  ['Orchid Valley Developers', 'Villa and plotted-development specialist.'],
  ['Pinnacle Arc Realty', 'Luxury high-rise developer.'],
  ['Riverstone Homes', 'Integrated township developer.'],
  ['Saffron Heights Group', 'Family-owned developer with a 25-year delivery record.'],
  ['Terracotta Living', 'Design-led boutique residences.'],
  ['Vantage Bay Realty', 'Waterfront and sea-view residences.'],
  ['Westwind Properties', 'NCR-focused residential developer.'],
  ['Zenith Urban', 'Tech-corridor residential developer in Bengaluru and Hyderabad.'],
  ['Lotus Bloom Builders', 'Value housing in Pune.'],
  ['Granite Peak Developers', 'Mixed-use developer.'],
  ['Coral Coast Realty', 'Resort-style residences.'],
];

// name, developer, [city, location, sub], types, stage, possession year (dev), sales status, extra
const P = [
  ['Saffron Heights Kharghar', 'Saffron Heights Group', ['MUM', 'Navi Mumbai', 'Kharghar'], [], 'LAUNCHED', 2029, 'ACTIVE', { exactConfigs: [['2 BHK', 640, 700, 8000000, 10000000], ['3 BHK', 980, 1080, 15000000, 20000000], ['4 BHK', 1500, 1650, 30000000, 40000000]], purpose: 'BOTH', note: 'Spec test case: 2 BHK ₹80L–1Cr, 3 BHK ₹1.5–2Cr, 4 BHK ₹3–4Cr' }],
  ['Aurum Crest Residences', 'Aurum Crest Realty', ['MUM', 'Navi Mumbai', 'Kharghar'], ['2 BHK', '3 BHK'], 'PRE', 2030, 'ACTIVE', { coords: [19.0452, 73.0718], ranges: true }],
  ['Aurum Crest Residency', 'Aurum Crest Realty', ['MUM', 'Navi Mumbai', 'Kharghar'], ['2 BHK'], 'PRE', 2030, 'ACTIVE', { coords: [19.0461, 73.0729], record: 'draft', note: 'Possible duplicate of Aurum Crest Residences (entered by a different editor)' }],
  ['Vantage Bay Vashi', 'Vantage Bay Realty', ['MUM', 'Navi Mumbai', 'Vashi'], ['2 BHK', '3 BHK', '4 BHK'], 'LAUNCHED', 2028, 'LIMITED', { ranges: true, purpose: 'RES' }],
  ['Northstar Ulwe Gardens', 'Northstar Infra', ['MUM', 'Navi Mumbai', 'Ulwe'], ['1 BHK', '2 BHK'], 'LAUNCHED', 2027, 'ACTIVE', { purpose: 'INV' }],
  ['Cedarwood Nerul Square', 'Cedarwood Constructions', ['MUM', 'Navi Mumbai', 'Nerul'], ['2 BHK', '3 BHK'], 'SUSTENANCE', 2026, 'LIMITED', { stale: 210 }],
  ['Bluestone Taloja Township', 'Bluestone Estates', ['MUM', 'Navi Mumbai', 'Taloja'], ['1 BHK', '2 BHK', '3 BHK'], 'LAUNCHED', 2029, 'ACTIVE', { towers: 12, varyTowers: true }],
  ['Meridian Belapur One', 'Meridian Spaces', ['MUM', 'Navi Mumbai', 'CBD Belapur'], ['2 BHK', '3 BHK'], 'PRE', 2031, 'ACTIVE', { por: true }],
  ['Pinnacle Arc Powai', 'Pinnacle Arc Realty', ['MUM', 'Central Suburbs', 'Powai'], ['3 BHK', '4 BHK', '5 BHK'], 'LAUNCHED', 2029, 'ACTIVE', { ranges: true, floors: 52 }],
  ['Terracotta Andheri Studios', 'Terracotta Living', ['MUM', 'Western Suburbs', 'Andheri'], ['Studio', '1 BHK', '2 BHK'], 'LAUNCHED', 2028, 'ACTIVE', { purpose: 'INV' }],
  ['Meridian Goregaon Park', 'Meridian Spaces', ['MUM', 'Western Suburbs', 'Goregaon'], ['2 BHK', '3 BHK'], 'RTM', 2025, 'COMPLETED', { completed: true }],
  ['Indus Horizon Thane', 'Indus Horizon Builders', ['MUM', 'Thane', 'Ghodbunder Road'], ['1 BHK', '2 BHK', '3 BHK'], 'LAUNCHED', 2029, 'ACTIVE', { devAfterRera: true }],
  ['Westwind Grand Residences', 'Westwind Properties', ['MUM', 'Thane', 'Majiwada'], ['2 BHK', '3 BHK'], 'LAUNCHED', 2030, 'ACTIVE', { renamedFrom: 'Westwind Heights' }],
  ['Orchid Valley Alibaug Villas', 'Orchid Valley Developers', ['MUM', 'Raigad', 'Alibaug'], ['Villa', 'Plot'], 'LAUNCHED', 2028, 'ACTIVE', { lowRise: true, purpose: 'BOTH' }],
  ['Riverstone Township Phase 1', 'Riverstone Homes', ['MUM', 'Raigad', 'Karjat'], ['1 BHK', '2 BHK'], 'SUSTENANCE', 2027, 'LIMITED', { phase: 'Phase 1', parentOf: 'Riverstone Township Phase 2' }],
  ['Riverstone Township Phase 2', 'Riverstone Homes', ['MUM', 'Raigad', 'Karjat'], ['1 BHK', '2 BHK', '2.5 BHK'], 'PRE', 2031, 'ACTIVE', { phase: 'Phase 2' }],
  ['Lotus Bloom Enclave', 'Lotus Bloom Builders', ['PUN', 'East Pune', 'Wagholi'], ['1 BHK', '2 BHK'], 'LAUNCHED', 2028, 'ACTIVE', { noCoords: true }],
  ['Zenith Hinjewadi Tech Homes', 'Zenith Urban', ['PUN', 'West Pune', 'Hinjewadi'], ['1 BHK', '2 BHK', '3 BHK'], 'LAUNCHED', 2029, 'ACTIVE', { purpose: 'INV' }],
  ['Bluestone Baner Heights', 'Bluestone Estates', ['PUN', 'West Pune', 'Baner'], ['2 BHK', '3 BHK'], 'PRE', 2030, 'ACTIVE', { record: 'under_review' }],
  ['Saffron Kharadi Edge', 'Saffron Heights Group', ['PUN', 'East Pune', 'Kharadi'], ['2 BHK', '3 BHK', '4 BHK'], 'LAUNCHED', 2029, 'ACTIVE', { ranges: true }],
  ['Zenith Whitefield Commons', 'Zenith Urban', ['BLR', 'East Bengaluru', 'Whitefield'], ['2 BHK', '3 BHK'], 'LAUNCHED', 2028, 'ACTIVE', {}],
  ['Coral Coast Bay', 'Coral Coast Realty', ['BLR', 'North Bengaluru', 'Hebbal'], ['3 BHK', '4 BHK'], 'PRE', 2030, 'ACTIVE', { coords: [19.01, 72.95], note: 'Coordinates deliberately wrong (plotted in Mumbai) to test data-quality checks' }],
  ['Orchid Valley Devanahalli Plots', 'Orchid Valley Developers', ['BLR', 'North Bengaluru', 'Devanahalli'], ['Plot'], 'LAUNCHED', 2027, 'ACTIVE', { lowRise: true, purpose: 'INV' }],
  ['Granite Peak Towers', 'Granite Peak Developers', ['BLR', 'East Bengaluru', 'Sarjapur Road'], [], 'PRE', 2031, 'ACTIVE', { note: 'No configurations entered yet' }],
  ['Zenith Gachibowli Sky', 'Zenith Urban', ['HYD', 'West Hyderabad', 'Gachibowli'], ['3 BHK', '4 BHK'], 'LAUNCHED', 2029, 'ACTIVE', { floors: 45, ranges: true }],
  ['Indus Horizon Kokapet', 'Indus Horizon Builders', ['HYD', 'West Hyderabad', 'Kokapet'], ['3 BHK', '4 BHK', '5 BHK'], 'PRE', 2031, 'ACTIVE', { floors: 55, invalidTower: true }],
  ['Northstar Kompally Homes', 'Northstar Infra', ['HYD', 'North Hyderabad', 'Kompally'], ['2 BHK', '3 BHK'], 'SUSTENANCE', 2027, 'ACTIVE', { missingCarpet: true }],
  ['Westwind Dwarka Expressway', 'Westwind Properties', ['GGN', 'Dwarka Expressway', 'Sector 113'], ['3 BHK', '4 BHK'], 'LAUNCHED', 2029, 'ACTIVE', { ranges: true }],
  ['Pinnacle Arc Golf Vista', 'Pinnacle Arc Realty', ['GGN', 'Golf Course Extension Road', 'Sector 65'], ['3 BHK', '4 BHK', '5 BHK'], 'PRE', 2031, 'ACTIVE', { floors: 48 }],
  ['Cedarwood Noida 150', 'Cedarwood Constructions', ['NOI', 'Noida Expressway', 'Sector 150'], ['2 BHK', '3 BHK', '4 BHK'], 'LAUNCHED', 2028, 'ACTIVE', { expiredOffer: true }],
  ['Lotus Bloom Gaur City', 'Lotus Bloom Builders', ['NOI', 'Greater Noida West', 'Gaur City'], ['1 BHK', '2 BHK', '3 BHK'], 'SUSTENANCE', 2026, 'ACTIVE', { record: 'needs_update' }],
  ['Terracotta Sector 128', 'Terracotta Living', ['NOI', 'Noida Expressway', 'Sector 128'], ['3 BHK', '4 BHK'], 'PRE', 2030, 'CANCELLED', { record: 'inactive', note: 'Project cancelled by developer' }],
  ['Vantage Bay Seawoods (old listing)', 'Vantage Bay Realty', ['MUM', 'Navi Mumbai', 'Nerul'], ['2 BHK'], 'SUSTENANCE', 2024, 'SOLD_OUT', { record: 'archived' }],
];

const AMENITY_POOL = ['Swimming Pool', 'Gymnasium', 'Clubhouse', "Kids' Play Area", 'Jogging Track', 'Landscaped Gardens', 'Indoor Games', 'Yoga / Meditation Zone', 'Multipurpose Court', '24x7 Security', 'Power Backup', 'EV Charging', 'Party Lawn', 'Co-working Space', 'Senior Citizen Zone'];
const CONNECT = [['Metro station', 5, 12], ['Railway station', 8, 20], ['Highway / expressway', 5, 15], ['International airport', 25, 55], ['Major IT park', 10, 30], ['Mall & retail', 5, 15], ['Multi-specialty hospital', 5, 15]];

export async function seedSample(c, admin, log = console.log) {
  log('Seeding synthetic sample projects…');
  const q1 = async (sql, p) => (await c.query(sql, p)).rows[0];
  const mv = async (list, code) => (await q1('SELECT id FROM master_values WHERE list_key=$1 AND code=$2', [list, code]))?.id ?? null;
  const ctype = Object.fromEntries((await c.query('SELECT id, label FROM configuration_types')).rows.map((r) => [r.label, r.id]));
  const amen = Object.fromEntries((await c.query('SELECT id, name FROM amenities')).rows.map((r) => [r.name, r.id]));
  const devIds = {};
  for (const [name, about] of DEVS) {
    devIds[name] = (await q1('INSERT INTO developers (name, normalized_name, about) VALUES ($1,$2,$3) RETURNING id', [name, normalizeName(name), about])).id;
  }
  const users = Object.fromEntries((await c.query('SELECT id, email FROM users')).rows.map((u) => [u.email, u]));
  const editor = users['abhay.editor@example.com'];
  const editor2 = users['riya.editor@example.com'];
  const reviewer = users['neha.reviewer@example.com'];
  const byName = {};

  for (const [name, devName, [cityCode, locName, subName], types, stage, possYear, salesStatus, x] of P) {
    const city = await q1('SELECT id, latitude, longitude FROM cities WHERE code=$1', [cityCode]);
    const loc = await q1('SELECT id FROM locations WHERE city_id=$1 AND name=$2', [city.id, locName]);
    const sub = await q1('SELECT id, latitude, longitude FROM sub_locations WHERE location_id=$1 AND name=$2', [loc.id, subName]);
    const coords = x.noCoords ? [null, null] : x.coords || [Number(sub.latitude) + between(-0.012, 0.012), Number(sub.longitude) + between(-0.012, 0.012)];
    const devPoss = `${possYear}-${pick(['03', '06', '09', '12'])}-01`;
    let reraPoss = `${possYear + 1}-${devPoss.slice(5, 7)}-01`;
    if (x.devAfterRera) reraPoss = `${possYear - 1}-06-01`;
    const purposeCode = x.purpose || pick(['BOTH', 'BOTH', 'RES']);
    const land = round(between(2, x.towers ? 40 : 15), 0.5);
    const author = x.record === 'draft' ? editor2 : editor;
    const values = {
      name: x.renamedFrom || name, developer_id: devIds[devName], city_id: city.id, location_id: loc.id, sub_location_id: sub.id,
      landmark: `Near ${subName} ${pick(['main road', 'metro station', 'railway station', 'junction'])}`,
      latitude: coords[0], longitude: coords[1], coords_status: x.noCoords ? 'unverified' : x.coords ? 'unverified' : 'approximate',
      purpose_id: await mv('purpose', purposeCode), launch_stage_id: await mv('launch_stage', stage), sales_status_id: await mv('sales_status', salesStatus),
      phase_name: x.phase || null,
      dev_possession_date: devPoss, rera_possession_date: reraPoss,
      land_parcel_acres: land, open_space_pct: round(between(55, 80), 1), total_towers: x.towers || (x.lowRise ? null : Math.ceil(between(1, 6))),
      has_parking: x.lowRise ? 'yes' : 'yes', basement_levels: x.lowRise ? null : Math.floor(between(1, 3)), podium_levels: x.lowRise ? null : Math.floor(between(0, 4)), stilt_levels: x.lowRise ? null : 1,
      eoi_type_id: await mv('eoi_type', stage === 'PRE' ? pick(['BANKABLE', 'NON_BANKABLE']) : 'NA'),
      eoi_amount: stage === 'PRE' ? pick([100000, 200000, 500000]) : null,
      eoi_valid_until: stage === 'PRE' ? '2026-12-31' : null,
      developer_remarks: null,
      other_remarks: x.note || null,
      data_source: SOURCE,
    };
    const states = {};
    if (x.lowRise) { states.total_towers = 'na'; }
    if (stage !== 'PRE') states.eoi_amount = 'na';
    const p = await createRecord(c, {
      entity: 'project', values, states, user: author,
      attributes: rnd() > 0.5 ? { clubhouse_area: round(between(15000, 60000), 1000) } : {},
      extra: { record_status: 'draft' },
    });
    byName[name] = p;
    if (x.renamedFrom) await updateRecord(c, { entity: 'project', id: p.id, user: editor, changes: { name: { from: x.renamedFrom, to: name } }, note: 'Developer rebranded the project' });

    // RERA
    if (stage !== 'PRE' || rnd() > 0.5) {
      const st = { MUM: 'P5', PUN: 'P5', BLR: 'PRM/KA/RERA/', HYD: 'P0', GGN: 'RC/REP/HARERA/GGM/', NOI: 'UPRERAPRJ' }[cityCode];
      await createRecord(c, { entity: 'rera', projectId: p.id, user: author, values: { rera_number: `${st}${Math.floor(between(10000000, 99999999))}`, rera_possession_date: reraPoss, phase_label: x.phase || null } });
    }
    // Configurations
    const mult = AREA_MULT[cityCode];
    const basePsf = PSF[subName] * between(0.92, 1.12);
    let so = 10;
    const cfgs = x.exactConfigs || types.flatMap((t) => {
      const [a0, a1] = AREA[t] || [700, 900];
      const variants = rnd() > 0.5 ? 2 : 1;
      return Array.from({ length: variants }, (_, i) => {
        const area = round(between(a0, a1) * (t === 'Plot' || t === 'Villa' ? 1 : mult) * (1 + i * 0.08), 5);
        const psf = t === 'Plot' ? basePsf * 0.55 : basePsf * (1 + i * 0.03);
        const price = round(area * psf, 100000);
        if (x.ranges) return [t, area, round(area * 1.08, 5), price, round(price * 1.18, 100000)];
        return [t, area, null, price, null];
      });
    });
    for (const [t, cf, ct, pf, pt] of cfgs) {
      const por = x.por && t === cfgs[cfgs.length - 1][0];
      await createRecord(c, {
        entity: 'configuration', projectId: p.id, user: author,
        values: {
          config_type_id: ctype[t], carpet_from: x.missingCarpet && t === '3 BHK' ? null : cf, carpet_to: x.missingCarpet && t === '3 BHK' ? null : ct,
          sbua_from: cf ? round(cf * 1.38, 5) : null, price_from: por ? null : pf, price_to: por ? null : pt, price_on_request: por,
          dev_psf: rnd() > 0.75 && !por ? round(pf / cf, 100) : null,
          parking_count: t.includes('3') || t.includes('4') || t.includes('5') ? 2 : 1,
          inventory_status_id: await mv('inventory_status', salesStatus === 'LIMITED' ? 'LIMITED' : 'ACTIVE'),
          variant: t === 'Plot' ? `${Math.round(cf)} sq.ft. plot` : null,
          sort_order: so,
        },
        attributes: rnd() > 0.6 ? { balcony: 'yes' } : {},
      });
      so += 10;
    }
    // Towers
    if (!x.lowRise) {
      const total = x.towers || values.total_towers || 1;
      const floors = x.floors || Math.round(between(18, 42));
      const shared = { flats_per_floor: pick([4, 6, 8]), floors_above_ground: floors, habitable_from_floor: pick([3, 4, 5, 7]), main_lifts: floors > 30 ? 4 : 3, service_lifts: 1 };
      const n = Math.min(total, 6);
      for (let i = 0; i < n; i += 1) {
        const t = { ...shared };
        if (x.varyTowers && i >= 4) { t.floors_above_ground = floors - 8; t.flats_per_floor = shared.flats_per_floor + 2; }
        if (x.invalidTower && i === 1) { t.habitable_from_floor = floors + 3; t.main_lifts = 0; }
        await createRecord(c, { entity: 'tower', projectId: p.id, user: author, values: { name: `Tower ${String.fromCharCode(65 + i)}`, ...t, sort_order: (i + 1) * 10, remarks: x.varyTowers && i >= 4 ? 'Phase 2 tower — lower height' : null } });
      }
      if (total > n) {
        await createRecord(c, { entity: 'tower', projectId: p.id, user: author, values: { name: 'Typical tower (remaining)', represents_count: total - n, ...shared, sort_order: 999, remarks: 'Remaining towers share the same specification' } });
      }
    } else {
      await createRecord(c, { entity: 'tower', projectId: p.id, user: author, values: { name: 'Villa cluster', represents_count: 1, floors_above_ground: 2, habitable_from_floor: 0, main_lifts: 0, service_lifts: 0 } });
    }
    // Amenities & highlights
    const am = [...AMENITY_POOL].sort(() => rnd() - 0.5).slice(0, Math.round(between(5, 11)));
    for (const a of am) await c.query('INSERT INTO project_amenities (project_id, amenity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [p.id, amen[a]]);
    so = 10;
    for (const [what, lo, hi] of [...CONNECT].sort(() => rnd() - 0.5).slice(0, 4)) {
      const m = Math.round(between(lo, hi));
      await createRecord(c, { entity: 'highlight', projectId: p.id, user: author, values: { kind: 'connectivity', text: `${what} – ~${m} mins`, travel_time_mins: m, sort_order: so } });
      so += 10;
    }
    if (purposeCode !== 'INV') await createRecord(c, { entity: 'highlight', projectId: p.id, user: author, values: { kind: 'usp_residential', text: pick(['Large open central greens', 'Low-density layout with 4 flats per floor', 'Vastu-compliant layouts', 'Excellent schools within 3 km']) } });
    if (purposeCode !== 'RES' && rnd() > 0.3) await createRecord(c, { entity: 'highlight', projectId: p.id, user: author, values: { kind: 'usp_investment', text: pick(['Strong rental demand from nearby IT parks (~3–4% yield)', 'Upcoming metro line expected to lift values', 'Early-phase pricing vs. completed neighbouring towers']) } });
    await createRecord(c, { entity: 'highlight', projectId: p.id, user: author, values: { kind: 'location_advantage', text: pick(['Established social infrastructure', 'Upcoming infrastructure corridor', 'Green surroundings with hill views', 'Close to employment hubs']) } });
    await createRecord(c, { entity: 'payment_plan', projectId: p.id, user: author, values: { name: pick(['Construction-linked plan', '20:80 plan', '10:90 subvention plan', '25:25:50 plan']), structure: pick(['20:80', '10:90', '25:25:50', null]) } });
    if (x.expiredOffer) await createRecord(c, { entity: 'offer', projectId: p.id, user: author, values: { name: 'Diwali offer – free modular kitchen', start_date: '2025-10-01', end_date: '2025-11-15' } });
    if (rnd() > 0.4) await createRecord(c, { entity: 'offer', projectId: p.id, user: author, values: { name: pick(['Spot booking discount ₹2 L', 'Stamp duty waiver', 'No floor-rise charges up to 15th floor', 'Free car park on 3 BHK']), start_date: '2026-09-01', end_date: pick(['2026-10-31', '2026-12-31']) } });
    const [objQ, objA] = pick([
      ['Price is higher than the neighbouring project', 'Compare on carpet ₹/sq.ft., not ticket size — this project includes clubhouse membership and one covered car park in the price.'],
      ['Possession timeline is long', 'The RERA date is the legal commitment; the developer delivered its last three projects ahead of RERA dates. Under-construction pricing is lower than ready inventory nearby.'],
      ['Too many flats per floor', 'Every flat is a corner or two-side-open unit with separate lift lobbies — share the typical floor plan.'],
    ]);
    await createRecord(c, { entity: 'objection', projectId: p.id, user: author, values: { objection: objQ, response: objA } });

    // Lifecycle state
    const record = x.record || 'published';
    const daysAgo = x.stale || Math.round(between(2, 45));
    const updatedAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
    const verified = ['published', 'needs_update', 'verified', 'inactive', 'archived'].includes(record);
    await c.query(`UPDATE projects SET record_status=$2::record_status, updated_at=$3, created_at=$3::timestamptz - interval '30 days',
        submitted_at = CASE WHEN $2::text <> 'draft' THEN $3::timestamptz ELSE NULL END, submitted_by = CASE WHEN $2::text <> 'draft' THEN $4::int ELSE NULL END,
        verified_at = CASE WHEN $5 THEN $3::timestamptz ELSE NULL END, verified_by = CASE WHEN $5 THEN $6::int ELSE NULL END,
        published_at = CASE WHEN $2::text IN ('published','needs_update') THEN $3::timestamptz ELSE NULL END, published_by = CASE WHEN $2::text IN ('published','needs_update') THEN $6::int ELSE NULL END,
        archived_at = CASE WHEN $2::text = 'archived' THEN $3::timestamptz ELSE NULL END, status_reason = $7
      WHERE id=$1`, [p.id, record, updatedAt, author.id, verified, reviewer.id, record === 'inactive' ? 'Cancelled by developer' : record === 'needs_update' ? 'Prices reported outdated by sales team' : null]);
    if (verified) await c.query('INSERT INTO verifications (project_id, user_id, at, action, remarks) VALUES ($1,$2,$3,$4,$5)', [p.id, reviewer.id, updatedAt, 'verified', 'Checked against developer price sheet']);
  }
  // Phase linkage
  for (const [name, , , , , , , x] of P) {
    if (x.parentOf) await c.query('UPDATE projects SET parent_project_id=$1 WHERE id=$2', [byName[name].id, byName[x.parentOf].id]);
  }
  log(`  ${P.length} sample projects created`);
}
