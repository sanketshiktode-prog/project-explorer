// Migrates the 9 projects from "5.2 Project Explorer Dashboard - Navi Mumbai.xlsm"
// (extracted to workbook_navi_mumbai.json) into the relational model.
// This file doubles as the documented workbook → application field mapping.
import data from './workbook_navi_mumbai.json' with { type: 'json' };
import { createRecord } from '../../src/services/records.js';
import { normalizeName } from '../../src/lib/util.js';


// Workbook "Location" → new hierarchy (City / Location / Sub-location)
const LOCATION_MAP = {
  Sanpada: ['Mumbai', 'Navi Mumbai', 'Sanpada'],
  Khargar: ['Mumbai', 'Navi Mumbai', 'Kharghar'], // typo fixed
  Panvel: ['Mumbai', 'Navi Mumbai', 'Panvel'],
  Juinagar: ['Mumbai', 'Navi Mumbai', 'Juinagar'],
  Alibaug: ['Mumbai', 'Raigad', 'Alibaug'],
};
// Approximate site coordinates (the workbook had none — it used a screenshot). Flagged "approximate".
const COORDS = {
  P001: [19.059, 73.008], P002: [19.031, 73.057], P003: [18.972, 73.183], P004: [18.964, 73.171],
  P005: [18.606, 72.903], P006: [18.96, 73.12], P007: [19.045, 73.023], P008: [19.0458, 73.024], P009: [18.959, 73.164],
};
const AMENITY_KEYWORDS = [
  [/swimming|pool/i, 'Swimming Pool'], [/gym|fitness/i, 'Gymnasium'], [/spa|steam/i, 'Spa & Steam Room'],
  [/club ?house|club lounge/i, 'Clubhouse'], [/theatre|theater/i, 'Mini Theatre'], [/indoor games/i, 'Indoor Games'],
  [/library|business lounge/i, 'Library & Business Lounge'], [/kids/i, "Kids' Play Area"], [/multipurpose court/i, 'Multipurpose Court'],
  [/box cricket/i, 'Box Cricket'], [/jogging/i, 'Jogging Track'], [/yoga|meditation/i, 'Yoga / Meditation Zone'],
  [/landscaped|garden/i, 'Landscaped Gardens'], [/golf/i, 'Golf Course'],
];

const lines = (s) => String(s || '').split(/\n|\r/).map((l) => l.replace(/^[\s•\-–*]+/, '').trim()).filter((l) => l && l !== ',');
const firstNumber = (s) => { const m = String(s || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : null; };
const travelMins = (s) => { const m = String(s).match(/~?\s*(\d+)\s*(?:[–-]\s*\d+\s*)?min/i); return m ? Number(m[1]) : null; };

function towerName(raw) {
  if (raw === null || raw === undefined) return { name: null };
  if (typeof raw === 'number' && raw > 40000) {
    // Excel turned "1/9" into a date serial. Recover month/day → "Tower 1 of 9".
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    return { name: `Tower ${d.getUTCMonth() + 1}`, note: `${d.getUTCMonth() + 1} of ${d.getUTCDate()} (name recovered from an Excel date auto-conversion)` };
  }
  const s = String(raw).trim();
  const phase = s.match(/\(([^)]+)\)/)?.[1] ?? null;
  const body = s.replace(/\([^)]*\)/, '').trim();
  let m = body.match(/^(.*?)\s*-\s*(\d+)\s*of\s*(\d+)$/i);
  if (m) return { name: m[1].trim(), phase, note: `${m[2]} of ${m[3]}` };
  m = body.match(/^(\d+)\s*(?:\/|of)\s*(\d+)$/i);
  if (m) return { name: `Tower ${m[1]}`, phase, note: `${m[1]} of ${m[2]}` };
  if (/^\d+$/.test(body)) return { name: `Tower ${body}`, phase };
  return { name: body, phase };
}

async function devId(c, name) {
  const norm = normalizeName(name);
  const ex = await c.query('SELECT id FROM developers WHERE normalized_name=$1', [norm]);
  if (ex.rows[0]) return ex.rows[0].id;
  return (await c.query('INSERT INTO developers (name, normalized_name) VALUES ($1,$2) RETURNING id', [name, norm])).rows[0].id;
}

export async function seedWorkbook(c, admin, log = console.log) {
  log('Migrating workbook projects…');
  const q1 = async (sql, p) => (await c.query(sql, p)).rows[0];
  const mvId = async (list, label) => (label ? (await q1('SELECT id FROM master_values WHERE list_key=$1 AND (lower(label)=lower($2) OR lower(code)=lower($2))', [list, label]))?.id : null);
  const amenityIds = Object.fromEntries((await c.query('SELECT id, name FROM amenities')).rows.map((r) => [r.name, r.id]));
  const typeByLabel = Object.fromEntries((await c.query('SELECT id, lower(label) l FROM configuration_types')).rows.map((r) => [r.l, r.id]));
  const purposeMap = { Both: 'BOTH', Investment: 'INV', Residence: 'RES' };
  const eoiMap = { 'N/A': 'NA', Bankable: 'BANKABLE', 'Non Bankable': 'NON_BANKABLE' };
  const ids = {};

  for (const p of data.projects) {
    const [cityName, locName, subName] = LOCATION_MAP[p.Location];
    const city = await q1('SELECT id FROM cities WHERE name=$1', [cityName]);
    const loc = await q1('SELECT id FROM locations WHERE city_id=$1 AND name=$2', [city.id, locName]);
    const sub = await q1('SELECT id FROM sub_locations WHERE location_id=$1 AND name=$2', [loc.id, subName]);
    const about = String(p['About Developer'] || '');
    const reraNos = about.match(/\b[A-Z]{1,2}\d{8,}\b/g) || [];
    const amenityLines = lines(p.Amenities);
    const matchedAmenities = new Set();
    const amenityRemarks = [];
    let clubhouseArea = null;
    for (const l of amenityLines) {
      const ca = l.match(/([\d,]+)\s*sq\.?\s*ft\.?\s*(?:of\s+)?(?:grand\s+)?club/i) || l.match(/club ?house[^\d]*([\d,]+)\s*sq/i);
      if (ca) clubhouseArea = Number(ca[1].replace(/,/g, ''));
      const hits = AMENITY_KEYWORDS.filter(([re]) => re.test(l)).map(([, n]) => n);
      hits.forEach((h) => matchedAmenities.add(h));
      if (!hits.length || l.length > 40) amenityRemarks.push(l);
    }
    const land = p['Land Parcel'];
    const open = p['Open Space'];
    const towersTotal = data.towers.find((t) => t['Project ID'] === p['Project ID'])?.['Total No. of Towers'] ?? null;
    const purpose = await mvId('purpose', purposeMap[p.Purpose]);
    const values = {
      name: p['Project Name'],
      developer_id: await devId(c, p.Developer),
      city_id: city.id, location_id: loc.id, sub_location_id: sub.id,
      locality: p['Sub-Location'], landmark: p.Landmark,
      latitude: COORDS[p['Project ID']][0], longitude: COORDS[p['Project ID']][1], coords_status: 'approximate',
      purpose_id: purpose,
      launch_stage_id: await mvId('launch_stage', p['Launch Stage']),
      sales_status_id: await mvId('sales_status', p['Project Status']),
      dev_possession_date: p['Developer Possession'], rera_possession_date: p['RERA Possession'],
      land_parcel_acres: firstNumber(land),
      land_parcel_remarks: land && !/^[\d.]+\s*acres?$/i.test(String(land).trim()) ? land : null,
      open_space_acres: /acre/i.test(open || '') ? firstNumber(open) : null,
      open_space_remarks: open && !/acre/i.test(open) ? open : null,
      total_towers: towersTotal,
      basement_levels: p['Basement Parking Levels'], stilt_levels: p['Stilt Parking Levels'], podium_levels: p['Podium Parking Levels'],
      eoi_type_id: await mvId('eoi_type', eoiMap[p['EOI Type']]),
      eoi_remarks: p['EOI Remarks'],
      amenity_remarks: amenityRemarks.join('\n') || null,
      developer_remarks: about.replace(/rera\s*(number|no\.?)?\s*[-:]?/gi, '').replace(/\b[A-Z]{1,2}\d{8,}\b/g, '').replace(/[|\s]+/g, ' ').trim() || null,
      other_location_remarks: lines(p['Other Location Remarks']).join('\n') || null,
      other_remarks: lines(p['Other Remarks']).join('\n') || null,
      internal_notes: lines(p['Internal Notes']).join('\n') || null,
      data_source: p['Data Source'] || 'Migrated from Project Explorer workbook v5.2',
    };
    const created = await createRecord(c, {
      entity: 'project', values, user: admin, note: `Migrated from workbook row ${p['Project ID']}`,
      attributes: { legacy_ref: p['Project ID'], ...(clubhouseArea ? { clubhouse_area: clubhouseArea } : {}) },
      states: { ...(p['EOI Type'] === 'N/A' ? {} : {}) },
      extra: { record_status: 'published' },
    });
    const pid = created.id;
    ids[p['Project ID']] = pid;
    const migratedAt = '2026-09-11T10:00:00+05:30';
    await c.query('UPDATE projects SET created_at=$2, updated_at=$2, published_at=$2, published_by=$3 WHERE id=$1', [pid, migratedAt, admin.id]);

    let so = 10;
    for (const r of reraNos) { await createRecord(c, { entity: 'rera', projectId: pid, user: admin, values: { rera_number: r, rera_possession_date: p['RERA Possession'], sort_order: so } }); so += 10; }
    for (const name of matchedAmenities) await c.query('INSERT INTO project_amenities (project_id, amenity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [pid, amenityIds[name]]);
    const hl = [['connectivity', p.Connectivity], ['location_advantage', p['Location Advantages']], ['usp_residential', p['USPs - Resident']], ['usp_investment', p['USPs - Investment']]];
    for (const [kind, txt] of hl) {
      so = 10;
      for (const l of lines(txt)) {
        for (const part of l.split(/\s+,\s+/)) { // "Hill-facing / green surroundings , 🏔️ ..." were two items in one line
          await createRecord(c, { entity: 'highlight', projectId: pid, user: admin, values: { kind, text: part, travel_time_mins: kind === 'connectivity' ? travelMins(part) : null, sort_order: so } });
          so += 10;
        }
      }
    }
    so = 10;
    for (const l of lines(p['Payment Plans'])) {
      const structure = l.match(/\d+(?::\d+)+/)?.[0] ?? null;
      const forWho = l.match(/\(for ([^)]+)\)/i)?.[1] ?? null;
      await createRecord(c, { entity: 'payment_plan', projectId: pid, user: admin, values: { name: structure ? `${structure} plan` : l, structure, applicable_to: forWho, remarks: l, sort_order: so } });
      so += 10;
    }
    so = 10;
    for (const l of lines(p.Offers)) { await createRecord(c, { entity: 'offer', projectId: pid, user: admin, values: { name: l, sort_order: so, remarks: 'Migrated without dates — please add validity' } }); so += 10; }
    so = 10;
    for (const l of lines(p['Objection Handling'])) {
      const [obj, resp] = l.split(/:\s*/);
      await createRecord(c, { entity: 'objection', projectId: pid, user: admin, values: { objection: obj, response: resp && !/how to handle\??/i.test(resp) ? resp : null, sort_order: so } });
      so += 10;
    }
  }

  // Towers
  for (const pidKey of Object.keys(ids)) {
    const rows = data.towers.filter((t) => t['Project ID'] === pidKey);
    let so = 10;
    for (const t of rows) {
      const tn = towerName(t.Tower);
      const isAggregate = t['Information Scope'] === 'Project Level' && (tn.name === null || rows.length === 1) && Number(t['Total No. of Towers']) > 1;
      const name = isAggregate ? 'Typical tower' : tn.name || (rows.length === 1 ? 'Tower 1' : `Tower ${so / 10}`);
      const remarks = [tn.note && !isAggregate ? `Tower ${tn.note}` : null, t['Tower Remarks']].filter(Boolean).join('\n') || null;
      await createRecord(c, {
        entity: 'tower', projectId: ids[pidKey], user: admin,
        values: {
          name, phase: tn.phase, represents_count: isAggregate ? Number(t['Total No. of Towers']) : 1,
          flats_per_floor: t['No. of Flats on One Floor'], floors_above_ground: t['Above Ground Floors'], habitable_from_floor: t['Habitable Floor Starts From'],
          main_lifts: t['Main Lifts'], service_lifts: t['Service Lifts'], remarks, sort_order: so,
        },
      });
      so += 10;
    }
  }

  // Configurations
  const sortCounter = {};
  for (const r of data.configurations) {
    const pid = ids[r['Project ID']];
    if (!pid) continue;
    let label = String(r.Configuration).trim();
    let variant = null;
    if (/^office variant/i.test(label)) { variant = label.replace(/^office\s*/i, ''); label = 'Office'; }
    if (/^plots?$/i.test(label)) label = 'Plot';
    const typeId = typeByLabel[label.toLowerCase()];
    sortCounter[pid] = (sortCounter[pid] || 0) + 10;
    const remarks = r['Configuration Remarks'];
    await createRecord(c, {
      entity: 'configuration', projectId: pid, user: admin,
      values: {
        config_type_id: typeId, variant,
        carpet_from: r.Carpet, sbua_from: r['Super Builtup (Sqft.)'],
        price_from: r.Price, dev_psf: r['₹/Sqft. Developer'],
        parking_remarks: r.Parking, inventory_status_id: await mvId('inventory_status', r['Inventory Status']),
        inventory_details: r['Inventory Details'], inventory_remarks: r['Inventory Remarks'], remarks,
        sort_order: sortCounter[pid],
      },
      attributes: /balcony/i.test(remarks || '') ? { balcony: 'yes' } : {},
    });
  }
  log(`  ${Object.keys(ids).length} workbook projects migrated`);
  return ids;
}
