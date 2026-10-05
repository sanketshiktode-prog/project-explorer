// End-to-end API tests against a real PostgreSQL test database (reset + seeded once).
// Run: npm test   (expects Postgres reachable via TEST_DATABASE_URL, default postgres://postgres@localhost:5432/explorer_test)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, agentFor, resetDb, pool, q1, qa, request } from './helpers.js';
import { setGoogleVerifier } from '../src/routes/auth.js';
import { invalidate } from '../src/services/meta.js';

let admin; let editor; let editor2; let reviewer; let sales;
const ids = {};

before(async () => {
  await resetDb();
  admin = await agentFor('admin@example.com');
  editor = await agentFor('abhay.editor@example.com');
  editor2 = await agentFor('riya.editor@example.com');
  reviewer = await agentFor('neha.reviewer@example.com');
  sales = await agentFor('sales@example.com');
  const t = async (label) => (await q1('SELECT id FROM configuration_types WHERE label=$1', [label])).id;
  ids.t2 = await t('2 BHK'); ids.t3 = await t('3 BHK'); ids.t4 = await t('4 BHK');
  ids.mumbai = (await q1("SELECT id FROM cities WHERE code='MUM'")).id;
  ids.navi = (await q1("SELECT id FROM locations WHERE name='Navi Mumbai'")).id;
  ids.kharghar = (await q1("SELECT id FROM sub_locations WHERE name='Kharghar'")).id;
  ids.saffron = (await q1("SELECT id FROM projects WHERE name='Saffron Heights Kharghar'")).id;
});
after(async () => { await pool.end(); });

const search = (agent, body) => agent.post('/api/explorer/search').send(body);
const names = (r) => r.body.results.map((x) => x.name);

describe('Authentication', () => {
  it('rejects unauthenticated API calls', async () => {
    const r = await request(app).get('/api/explorer/config');
    assert.equal(r.status, 401);
  });
  it('rejects state-changing requests without the CSRF header', async () => {
    const r = await sales.raw.post('/api/explorer/search').send({});
    assert.equal(r.status, 403);
  });
  it('signs in an approved Google account and refuses unknown or deactivated ones', async () => {
    setGoogleVerifier(async (tok) => ({ email: tok, email_verified: true, sub: `sub-${tok}`, name: 'Test' }));
    const ok = await request(app).post('/api/auth/google').set('x-requested-with', 'project-explorer').send({ credential: 'sales@example.com' });
    assert.equal(ok.status, 200);
    assert.match(ok.headers['set-cookie'][0], /pe_session=.*HttpOnly/);
    const unknown = await request(app).post('/api/auth/google').set('x-requested-with', 'project-explorer').send({ credential: 'stranger@gmail.com' });
    assert.equal(unknown.status, 403);
    assert.match(unknown.body.error, /not an approved user/);
    const gone = await request(app).post('/api/auth/google').set('x-requested-with', 'project-explorer').send({ credential: 'former.employee@example.com' });
    assert.equal(gone.status, 403);
  });
  it('rejects an invalid Google token', async () => {
    setGoogleVerifier(async () => { throw new Error('bad'); });
    const r = await request(app).post('/api/auth/google').set('x-requested-with', 'project-explorer').send({ credential: 'x' });
    assert.equal(r.status, 401);
  });
  it('deactivating a user ends their sessions immediately', async () => {
    const tmp = await admin.post('/api/admin/users').send({ email: 'temp.user@example.com', name: 'Temp', role_id: (await q1("SELECT id FROM roles WHERE key='sales'")).id });
    assert.equal(tmp.status, 201);
    const t = await agentFor('temp.user@example.com');
    assert.equal((await t.get('/api/explorer/config')).status, 200);
    assert.equal((await admin.patch(`/api/admin/users/${tmp.body.id}`).send({ is_active: false })).status, 200);
    assert.equal((await t.get('/api/explorer/config')).status, 401);
  });
});

describe('Authorization', () => {
  it('sales users cannot reach data entry or admin', async () => {
    assert.equal((await sales.get('/api/manage/projects')).status, 403);
    assert.equal((await sales.get('/api/admin/data-quality')).status, 403);
    assert.equal((await sales.post('/api/manage/projects').send({ values: { name: 'X', city_id: ids.mumbai } })).status, 403);
  });
  it('sales users only see published projects and never internal notes', async () => {
    const draft = await q1("SELECT id FROM projects WHERE record_status='draft' LIMIT 1");
    assert.equal((await sales.get(`/api/explorer/projects/${draft.id}`)).status, 404);
    const p = await sales.get('/api/explorer/projects/PRJ-MUM-000003');
    assert.equal(p.status, 200);
    assert.equal(p.body.values.internal_notes, undefined);
    const all = await search(sales, {});
    assert.ok(all.body.results.every((x) => ['published', 'needs_update'].includes(x.record_status)));
  });
  it('data editors cannot publish; reviewers can', async () => {
    const p = await q1("SELECT id FROM projects WHERE record_status='under_review' LIMIT 1");
    assert.equal((await editor.post(`/api/manage/projects/${p.id}/workflow`).send({ action: 'publish' })).status, 403);
    const r = await reviewer.post(`/api/manage/projects/${p.id}/workflow`).send({ action: 'publish' });
    assert.equal(r.status, 200);
    assert.equal(r.body.record_status, 'published');
  });
  it('only admins can manage configuration', async () => {
    assert.equal((await editor.patch('/api/admin/r/filters/1').send({ label: 'x' })).status, 403);
    assert.equal((await reviewer.put('/api/admin/settings/stale_after_days').send({ value: 10 })).status, 403);
  });
});

describe('Configuration-level matching', () => {
  it('does not treat a project as a match just because some configuration fits the budget', async () => {
    // Saffron Heights: 2 BHK ₹80L–1Cr, 3 BHK ₹1.5–2Cr, 4 BHK ₹3–4Cr. Customer: 3 BHK, ₹1–1.3 Cr.
    const r = await search(sales, { filters: { configuration: [ids.t3], price: { min: 10000000, max: 13000000 } } });
    assert.ok(!names(r).includes('Saffron Heights Kharghar'));
    // …but it does match 2 BHK under ₹1 Cr exactly
    const r2 = await search(sales, { filters: { configuration: [ids.t2], price: { min: 8000000, max: 10000000 } }, q: 'saffron' });
    const saff = r2.body.results.find((x) => x.name === 'Saffron Heights Kharghar');
    assert.equal(saff.match.status, 'exact');
    assert.ok(saff.configs.filter((c) => c.match !== 'none').every((c) => c.type === '2 BHK'));
  });
  it('reports overlapping ranges as partial matches with a reason', async () => {
    // Zenith Gachibowli has ranged prices around ₹2.1–2.5 Cr for 3 BHK
    const r = await search(sales, { filters: { price: { min: 10000000, max: 20000000 } }, page_size: 100 });
    assert.ok(r.body.partial > 0);
    const partial = r.body.results.filter((x) => x.match.status === 'partial');
    assert.ok(partial.length > 0);
    const reasons = partial.flatMap((x) => x.configs.flatMap((c) => c.reasons || [])).filter((x) => x.status === 'partial');
    assert.ok(reasons.some((x) => /above|below|overlaps/.test(x.text)));
    const exactOnly = await search(sales, { filters: { price: { min: 10000000, max: 20000000 } }, match: 'exact', page_size: 100 });
    assert.ok(exactOnly.body.results.every((x) => x.match.status === 'exact'));
    assert.equal(exactOnly.body.total, r.body.exact);
  });
  it('treats price on request as a partial match, not a hidden project', async () => {
    const r = await search(sales, { filters: { configuration: [ids.t3], price: { min: 10000000, max: 30000000 } }, q: 'meridian belapur' });
    assert.equal(r.body.results[0].match.status, 'partial');
    assert.ok(r.body.results[0].configs.some((c) => c.reasons.some((x) => x.text === 'Price on request')));
  });
  it('combines location, configuration, carpet and possession filters', async () => {
    const r = await search(sales, { filters: { city: [ids.mumbai], location: [ids.navi], configuration: [ids.t2], carpet: { min: 600, max: 800 }, possession_year: { min: 2028, max: 2030 } } });
    assert.ok(r.body.total > 0);
    for (const x of r.body.results) {
      assert.equal(x.location, 'Navi Mumbai');
      const y = Number(x.dev_possession_date?.slice(0, 4));
      assert.ok(y >= 2028 && y <= 2030, `possession ${x.dev_possession_date}`);
      assert.ok(x.configs.some((c) => c.type === '2 BHK' && c.match !== 'none'));
    }
  });
  it('filters by tower elevation band', async () => {
    const band = await q1("SELECT id FROM band_definitions WHERE band_set_key='elevation' AND label LIKE 'Skyscraper%'");
    const r = await search(sales, { filters: { elevation: { bands: [band.id] } } });
    assert.ok(r.body.total > 0);
    for (const x of r.body.results) {
      const t = await q1('SELECT max(floors_above_ground) m FROM towers WHERE project_id=$1 AND is_active', [x.id]);
      assert.ok(t.m >= 40);
    }
  });
  it('map points contain only filtered projects that have coordinates', async () => {
    const r = await search(sales, { filters: { city: [ids.mumbai] } });
    const allIds = (await qa("SELECT id FROM projects WHERE city_id=$1 AND record_status IN ('published','needs_update') AND latitude IS NOT NULL", [ids.mumbai])).map((x) => x.id).sort();
    assert.deepEqual(r.body.map.map((m) => m.id).sort(), allIds);
  });
  it('quick search finds projects by developer, area and previous name', async () => {
    assert.ok(names(await search(sales, { q: 'Hiranandani' })).includes('Fortune City'));
    assert.ok(names(await search(sales, { q: 'westwind heights' })).includes('Westwind Grand Residences'));
    assert.ok(names(await search(sales, { q: 'PRJ-MUM-000004' })).includes('L&T Panvel'));
  });
  it('responds fast enough for a live call', async () => {
    const t = Date.now();
    await search(sales, { filters: { city: [ids.mumbai], configuration: [ids.t2, ids.t3], price: { min: 8000000, max: 25000000 } } });
    assert.ok(Date.now() - t < 1000);
  });
});

describe('Project creation, duplicates and editing', () => {
  it('blocks a likely duplicate until the user confirms with a reason', async () => {
    const values = { name: 'Aurum Crest Residences', developer_id: (await q1("SELECT id FROM developers WHERE name='Aurum Crest Realty'")).id, city_id: ids.mumbai, location_id: ids.navi, sub_location_id: ids.kharghar };
    const r = await editor.post('/api/manage/projects').send({ values });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'possible_duplicate');
    assert.ok(r.body.candidates.some((c) => c.name === 'Aurum Crest Residences'));
    const noReason = await editor.post('/api/manage/projects').send({ values, confirm_not_duplicate: true });
    assert.equal(noReason.status, 400);
    const ok = await editor.post('/api/manage/projects').send({ values: { ...values, name: 'Aurum Crest Residences Phase 2' }, confirm_not_duplicate: true, duplicate_reason: 'Separate phase with its own RERA' });
    assert.equal(ok.status, 201);
    const note = await q1("SELECT note FROM audit_log WHERE entity='project' AND action='create' AND entity_id=$1", [String(ok.body.id)]);
    assert.match(note.note, /despite possible duplicate/);
  });
  it('creates a project with a permanent ID that survives renaming', async () => {
    const r = await editor.post('/api/manage/projects').send({ values: { name: 'Test Harbour View', city_id: ids.mumbai, location_id: ids.navi, sub_location_id: ids.kharghar } });
    assert.equal(r.status, 201);
    assert.match(r.body.public_id, /^PRJ-MUM-\d{6}$/);
    ids.p = r.body.id;
    ids.pub = r.body.public_id;
    const ren = await editor.patch(`/api/manage/projects/${ids.p}`).send({ changes: { name: { from: 'Test Harbour View', to: 'Test Harbour Grand Residences' } } });
    assert.equal(ren.status, 200);
    const row = await q1('SELECT public_id, name FROM projects WHERE id=$1', [ids.p]);
    assert.equal(row.public_id, ids.pub);
    assert.equal((await q1('SELECT name FROM project_aliases WHERE project_id=$1', [ids.p])).name, 'Test Harbour View');
  });
  it('stores N/A and Unknown separately from blank', async () => {
    const r = await editor.patch(`/api/manage/projects/${ids.p}`).send({ changes: { 'states.open_space_acres': { to: 'na' }, 'states.eoi_type_id': { to: 'unknown' } } });
    assert.equal(r.status, 200);
    const row = await q1('SELECT field_states, open_space_acres, eoi_type_id FROM projects WHERE id=$1', [ids.p]);
    assert.deepEqual(row.field_states, { open_space_acres: 'na', eoi_type_id: 'unknown' });
    assert.equal(row.open_space_acres, null);
    // Entering a value later clears the marker
    await editor.patch(`/api/manage/projects/${ids.p}`).send({ changes: { open_space_acres: { to: 3.5 } } });
    assert.equal((await q1('SELECT field_states FROM projects WHERE id=$1', [ids.p])).field_states.open_space_acres, undefined);
  });
  it('creates configurations, calculates ₹/sq.ft. and never overwrites the developer figure', async () => {
    const r = await editor.post(`/api/manage/projects/${ids.p}/configurations`).send({ values: { config_type_id: ids.t2, carpet_from: 700, price_from: 14000000, dev_psf: 21000 } });
    assert.equal(r.status, 201);
    assert.equal(r.body.row.calc_psf, 20000);
    assert.equal(r.body.row.dev_psf, 21000);
    assert.equal(r.body.row.psf.source, 'developer'); // default rule: developer first
    ids.cfg = r.body.row.id;
    const bad = await editor.post(`/api/manage/projects/${ids.p}/configurations`).send({ values: { config_type_id: ids.t3, price_from: 20000000, price_to: 15000000 } });
    assert.equal(bad.status, 400);
  });
  it('bulk-creates towers, applies shared details and keeps per-tower overrides', async () => {
    const c = await editor.post(`/api/manage/projects/${ids.p}/towers/bulk-create`).send({ count: 4, naming: 'letters', values: { floors_above_ground: 40, flats_per_floor: 4, main_lifts: 3, service_lifts: 1 } });
    assert.equal(c.status, 201);
    assert.deepEqual(c.body.map((t) => t.name), ['Tower A', 'Tower B', 'Tower C', 'Tower D']);
    const towerC = c.body[2].id;
    assert.equal((await editor.patch(`/api/manage/projects/${ids.p}/towers/${towerC}`).send({ changes: { floors_above_ground: { from: 40, to: 32 } } })).status, 200);
    const ap = await editor.post(`/api/manage/projects/${ids.p}/towers/apply`).send({ tower_ids: c.body.map((t) => t.id), values: { habitable_from_floor: 4 } });
    assert.equal(ap.status, 200);
    const rows = await qa('SELECT name, floors_above_ground, habitable_from_floor FROM towers WHERE project_id=$1 ORDER BY name', [ids.p]);
    assert.ok(rows.every((t) => t.habitable_from_floor === 4));
    assert.equal(rows.find((t) => t.name === 'Tower C').floors_above_ground, 32); // override preserved
    assert.equal(rows.find((t) => t.name === 'Tower A').floors_above_ground, 40);
    const dup = await editor.post(`/api/manage/projects/${ids.p}/towers/bulk-create`).send({ names: ['Tower A'] });
    assert.equal(dup.status, 409);
  });
  it('validates with errors, warnings and info and blocks submit only on errors', async () => {
    await editor.patch(`/api/manage/projects/${ids.p}`).send({ changes: { dev_possession_date: { to: '2031-06-01' }, rera_possession_date: { to: '2030-06-01' } } });
    const tw = await q1("SELECT id FROM towers WHERE project_id=$1 AND name='Tower D'", [ids.p]);
    await editor.patch(`/api/manage/projects/${ids.p}/towers/${tw.id}`).send({ changes: { habitable_from_floor: { to: 45 } } });
    const v = (await editor.get(`/api/manage/projects/${ids.p}/validation`)).body;
    assert.ok(v.some((x) => x.level === 'warning' && /later than RERA/.test(x.message)));
    assert.ok(v.some((x) => x.level === 'error' && /Tower D: habitable floor/.test(x.message)));
    assert.ok(v.some((x) => x.level === 'error' && /Developer is required/.test(x.message)));
    assert.ok(v.some((x) => x.level === 'info'));
    const sub = await editor.post(`/api/manage/projects/${ids.p}/workflow`).send({ action: 'submit' });
    assert.equal(sub.status, 400);
    // fix errors and submit
    await editor.patch(`/api/manage/projects/${ids.p}/towers/${tw.id}`).send({ changes: { habitable_from_floor: { to: 4 } } });
    const dev = (await q1("SELECT id FROM developers WHERE name='Meridian Spaces'")).id;
    const mv = async (l, c) => (await q1('SELECT id FROM master_values WHERE list_key=$1 AND code=$2', [l, c])).id;
    await editor.patch(`/api/manage/projects/${ids.p}`).send({ changes: { developer_id: { to: dev }, purpose_id: { to: await mv('purpose', 'RES') }, launch_stage_id: { to: await mv('launch_stage', 'PRE') }, sales_status_id: { to: await mv('sales_status', 'ACTIVE') }, latitude: { to: 19.05 }, longitude: { to: 73.07 } } });
    const ok = await editor.post(`/api/manage/projects/${ids.p}/workflow`).send({ action: 'submit' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.record_status, 'under_review');
    assert.equal((await reviewer.post(`/api/manage/projects/${ids.p}/workflow`).send({ action: 'verify' })).body.record_status, 'verified');
    assert.equal((await reviewer.post(`/api/manage/projects/${ids.p}/workflow`).send({ action: 'publish' })).body.record_status, 'published');
    const s = await search(sales, { q: 'harbour grand' });
    assert.deepEqual(names(s), ['Test Harbour Grand Residences']);
  });
  it('discontinued configurations stop matching but stay in history', async () => {
    const before = await search(sales, { filters: { configuration: [ids.t2] }, q: 'harbour grand' });
    assert.equal(before.body.total, 1);
    assert.equal((await editor.del(`/api/manage/projects/${ids.p}/configurations/${ids.cfg}`).send({ reason: 'Sold out' })).status, 200);
    const after = await search(sales, { filters: { configuration: [ids.t2] }, q: 'harbour grand' });
    assert.equal(after.body.total, 0);
    assert.equal((await q1('SELECT is_active FROM project_configurations WHERE id=$1', [ids.cfg])).is_active, false);
  });
});

describe('Concurrent editing', () => {
  it('two users editing different fields both succeed', async () => {
    const p = await q1("SELECT id, possession_remarks, land_parcel_remarks FROM projects WHERE name='Vantage Bay Vashi'");
    const a = await editor.patch(`/api/manage/projects/${p.id}`).send({ changes: { land_parcel_remarks: { from: p.land_parcel_remarks, to: 'Includes 2 acre central park' } } });
    const b = await editor2.patch(`/api/manage/projects/${p.id}`).send({ changes: { possession_remarks: { from: p.possession_remarks, to: 'Tower B two quarters later' } } });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const row = await q1('SELECT land_parcel_remarks, possession_remarks FROM projects WHERE id=$1', [p.id]);
    assert.equal(row.land_parcel_remarks, 'Includes 2 acre central park');
    assert.equal(row.possession_remarks, 'Tower B two quarters later');
  });
  it('the same field changed by both users is a conflict, not a silent overwrite', async () => {
    const c = await q1("SELECT c.id, c.project_id, c.price_from FROM project_configurations c JOIN projects p ON p.id=c.project_id WHERE p.name='Vantage Bay Vashi' ORDER BY c.id LIMIT 1");
    const a = await editor.patch(`/api/manage/projects/${c.project_id}/configurations/${c.id}`).send({ changes: { price_from: { from: c.price_from, to: c.price_from + 500000 } } });
    assert.equal(a.status, 200);
    const b = await editor2.patch(`/api/manage/projects/${c.project_id}/configurations/${c.id}`).send({ changes: { price_from: { from: c.price_from, to: c.price_from + 900000 } } });
    assert.equal(b.status, 409);
    assert.equal(b.body.details.conflicts[0].field, 'price_from');
    assert.equal(b.body.details.conflicts[0].theirs, c.price_from + 500000);
    assert.equal((await q1('SELECT price_from FROM project_configurations WHERE id=$1', [c.id])).price_from, c.price_from + 500000);
  });
});

describe('Audit trail', () => {
  it('records who changed which field from what to what', async () => {
    const c = await q1("SELECT c.id FROM project_configurations c JOIN projects p ON p.id=c.project_id WHERE p.name='Vantage Bay Vashi' ORDER BY c.id LIMIT 1");
    const a = await q1("SELECT a.*, u.email FROM audit_log a JOIN users u ON u.id=a.user_id WHERE entity='configuration' AND entity_id=$1 AND field='price_from' ORDER BY id DESC LIMIT 1", [String(c.id)]);
    assert.equal(a.email, 'abhay.editor@example.com');
    assert.equal(a.action, 'update');
    assert.ok(Number(a.new_value) - Number(a.old_value) === 500000);
    const h = await reviewer.get(`/api/manage/projects/${(await q1("SELECT id FROM projects WHERE name='Vantage Bay Vashi'")).id}/history`);
    assert.equal(h.status, 200);
    assert.ok(h.body.some((x) => x.field === 'possession_remarks' && x.user_email === 'riya.editor@example.com'));
  });
});

describe('Archive and deletion', () => {
  it('archived projects disappear from search, cannot be edited, and can be restored', async () => {
    const r = await reviewer.post(`/api/manage/projects/${ids.p}/workflow`).send({ action: 'archive', remarks: 'Test archive' });
    assert.equal(r.body.record_status, 'archived');
    assert.equal((await search(sales, { q: 'harbour grand' })).body.total, 0);
    assert.equal((await editor.patch(`/api/manage/projects/${ids.p}`).send({ changes: { landmark: { to: 'x' } } })).status, 409);
    assert.equal((await editor.post(`/api/manage/projects/${ids.p}/workflow`).send({ action: 'restore' })).status, 403);
    assert.equal((await reviewer.post(`/api/manage/projects/${ids.p}/workflow`).send({ action: 'restore' })).body.record_status, 'draft');
  });
  it('published projects cannot be permanently deleted', async () => {
    const r = await admin.del(`/api/manage/projects/${ids.p}`).send({ confirm_name: 'Test Harbour Grand Residences' });
    assert.equal(r.status, 409);
  });
});

describe('Admin configuration changes take effect without code changes', () => {
  it('adding a city and location makes them available immediately', async () => {
    const c = await admin.post('/api/admin/r/cities').send({ code: 'AMD', name: 'Ahmedabad', state: 'Gujarat', latitude: 23.0225, longitude: 72.5714 });
    assert.equal(c.status, 201);
    const l = await admin.post('/api/admin/r/locations').send({ city_id: c.body.id, name: 'SG Highway' });
    assert.equal(l.status, 201);
    const cfg = await sales.get('/api/explorer/config');
    const city = cfg.body.filters.find((f) => f.key === 'city');
    assert.ok(city.options.some((o) => o.label === 'Ahmedabad'));
    assert.ok(cfg.body.filters.find((f) => f.key === 'location').options.some((o) => o.label === 'SG Highway' && o.parent_id === c.body.id));
    const p = await editor.post('/api/manage/projects').send({ values: { name: 'Gujarat Test Towers', city_id: c.body.id } });
    assert.match(p.body.public_id, /^PRJ-AMD-/);
  });
  it('master values in use cannot be deleted, only deactivated', async () => {
    const del = await admin.del(`/api/admin/r/configuration-types/${ids.t2}`);
    assert.equal(del.status, 409);
    const t = await admin.post('/api/admin/r/configuration-types').send({ code: 'PH', label: 'Penthouse', category: 'residential', bedrooms: 4 });
    assert.equal(t.status, 201);
    const cfg = await sales.get('/api/explorer/config');
    assert.ok(cfg.body.filters.find((f) => f.key === 'configuration').options.some((o) => o.label === 'Penthouse'));
    assert.equal((await admin.del(`/api/admin/r/configuration-types/${t.body.id}`)).status, 200);
  });
  it('changing a band from ₹1–1.5 Cr to ₹1–1.25 Cr changes search results', async () => {
    const band = await q1("SELECT id FROM band_definitions WHERE band_set_key='price' AND lower_bound=10000000");
    const before = await search(sales, { filters: { price: { bands: [band.id] } }, match: 'exact' });
    const r = await admin.patch(`/api/admin/r/bands/${band.id}`).send({ label: '₹1 – 1.25 Cr', upper_bound: 12500000 });
    assert.equal(r.status, 200);
    const after = await search(sales, { filters: { price: { bands: [band.id] } }, match: 'exact' });
    assert.ok(after.body.total < before.body.total);
    for (const x of after.body.results) for (const c of x.configs.filter((y) => y.match === 'exact')) assert.ok(c.price_from < 12500000);
    const cfg = await sales.get('/api/explorer/config');
    assert.ok(cfg.body.filters.find((f) => f.key === 'price').bands.some((b) => b.label === '₹1 – 1.25 Cr'));
    await admin.patch(`/api/admin/r/bands/${band.id}`).send({ label: '₹1 – 1.5 Cr', upper_bound: 15000000 });
  });
  it('adds "Floor Preference" as a custom configuration field and filter', async () => {
    const list = await admin.post('/api/admin/r/master-lists').send({ key: 'floor_preference', name: 'Floor Preference' });
    assert.equal(list.status, 201);
    const low = await admin.post('/api/admin/r/master-values').send({ list_key: 'floor_preference', code: 'LOW', label: 'Lower floors' });
    const high = await admin.post('/api/admin/r/master-values').send({ list_key: 'floor_preference', code: 'HIGH', label: 'Higher floors' });
    const f = await admin.post('/api/admin/r/fields').send({ entity: 'configuration', key: 'floor_preference', label: 'Floor Preference', data_type: 'select', master_list_key: 'floor_preference', section: 'configuration' });
    assert.equal(f.status, 201);
    const fl = await admin.post('/api/admin/r/filters').send({ key: 'floor_preference', label: 'Floor Preference', control: 'multiselect', source_key: 'config.attr.floor_preference', match_mode: 'hard', sort_order: 65 });
    assert.equal(fl.status, 201, JSON.stringify(fl.body));
    // tag one Vantage Bay configuration as "Higher floors"
    const c = await q1("SELECT c.id, c.project_id FROM project_configurations c JOIN projects p ON p.id=c.project_id WHERE p.name='Vantage Bay Vashi' AND c.is_active LIMIT 1");
    const up = await editor.patch(`/api/manage/projects/${c.project_id}/configurations/${c.id}`).send({ changes: { 'attributes.floor_preference': { to: high.body.id } } });
    assert.equal(up.status, 200);
    const cfg = await sales.get('/api/explorer/config');
    const def = cfg.body.filters.find((x) => x.key === 'floor_preference');
    assert.deepEqual(def.options.map((o) => o.label), ['Lower floors', 'Higher floors']);
    const r = await search(sales, { filters: { floor_preference: [high.body.id] }, match: 'exact' });
    assert.deepEqual(names(r), ['Vantage Bay Vashi']);
    assert.equal((await search(sales, { filters: { floor_preference: [low.body.id] }, match: 'exact' })).body.total, 0);
    // projects with no configuration data at all are offered as possible (partial) matches, never hidden
    const all = await search(sales, { filters: { floor_preference: [high.body.id] } });
    assert.ok(all.body.results.filter((x) => x.match.status === 'partial').every((x) => x.configs.length === 0));
  });
  it('rejects a filter pointing at an unknown source or with an incompatible control', async () => {
    assert.equal((await admin.post('/api/admin/r/filters').send({ key: 'bad1', label: 'Bad', control: 'multiselect', source_key: 'project.does_not_exist' })).status, 400);
    assert.equal((await admin.post('/api/admin/r/filters').send({ key: 'bad2', label: 'Bad', control: 'toggle', source_key: 'config.price' })).status, 400);
  });
  it('deactivating a filter removes it from the explorer and ignores it in search', async () => {
    const f = await q1("SELECT id FROM filter_definitions WHERE key='purpose'");
    await admin.patch(`/api/admin/r/filters/${f.id}`).send({ is_active: false });
    const cfg = await sales.get('/api/explorer/config');
    assert.ok(!cfg.body.filters.some((x) => x.key === 'purpose'));
    const all = await search(sales, {});
    const withIgnored = await search(sales, { filters: { purpose: [99999] } });
    assert.equal(withIgnored.body.total, all.body.total);
    await admin.patch(`/api/admin/r/filters/${f.id}`).send({ is_active: true });
  });
  it('hiding Land Parcel from the quick card keeps it in the detailed view', async () => {
    const fd = await q1("SELECT id FROM field_definitions WHERE entity='project' AND key='land_parcel_acres'");
    assert.equal((await admin.patch(`/api/admin/r/fields/${fd.id}`).send({ show_in_card: false })).status, 200);
    const cfg = await sales.get('/api/explorer/config');
    const lp = cfg.body.fields.find((x) => x.entity === 'project' && x.key === 'land_parcel_acres');
    assert.equal(lp.show_in_card, false);
    assert.equal(lp.show_in_detail, true);
    // core field types are fixed by the schema
    assert.equal((await admin.patch(`/api/admin/r/fields/${fd.id}`).send({ data_type: 'text' })).status, 400);
  });
  it('adds "Clubhouse Area"-style custom project fields without breaking existing projects', async () => {
    const f = await admin.post('/api/admin/r/fields').send({ entity: 'project', key: 'balcony_area_note', label: 'Balcony Note', data_type: 'text', section: 'other' });
    assert.equal(f.status, 201);
    const d = await sales.get('/api/explorer/projects/PRJ-MUM-000001');
    assert.equal(d.status, 200);
    assert.ok(d.body.fields.some((x) => x.key === 'balcony_area_note'));
  });
  it('matching rules are configurable (tolerance 0 removes near-miss partials)', async () => {
    const body = { filters: { price: { min: 10000000, max: 13000000 }, configuration: [ids.t3] } };
    const before = await search(sales, body);
    await admin.put('/api/admin/settings/matching').send({ value: { range_exact_rule: 'contained', tolerance_pct: 0, missing_value: 'exclude', show_partial_default: true } });
    const after = await search(sales, body);
    assert.ok(after.body.partial < before.body.partial);
    await admin.put('/api/admin/settings/matching').send({ value: { range_exact_rule: 'contained', tolerance_pct: 10, missing_value: 'partial', show_partial_default: true } });
  });
  it('the ₹/sq.ft. display rule switches between developer and calculated figures', async () => {
    await admin.put('/api/admin/settings/psf_display_rule').send({ value: 'calculated_first' });
    const d = await sales.get('/api/explorer/projects/PRJ-MUM-000004');
    const c = d.body.configurations.find((x) => x.dev_psf);
    assert.equal(c.psf.source, 'calculated');
    await admin.put('/api/admin/settings/psf_display_rule').send({ value: 'developer_first' });
    invalidate();
  });
  it('merging duplicate developers moves their projects and keeps the old name as an alias', async () => {
    const dup = await admin.post('/api/admin/r/developers').send({ name: 'Hiranandani Group Developers', confirm_not_duplicate: true });
    assert.ok([201, 409].includes(dup.status));
    if (dup.status === 409) return; // normalisation already treats it as the same developer — also acceptable
    const p = await editor.post('/api/manage/projects').send({ values: { name: 'Merge Test Project', city_id: ids.mumbai, developer_id: dup.body.id } });
    const target = (await q1("SELECT id FROM developers WHERE name='Hiranandani'")).id;
    assert.equal((await admin.post(`/api/admin/developers/${dup.body.id}/merge`).send({ into_id: target })).status, 200);
    assert.equal((await q1('SELECT developer_id FROM projects WHERE id=$1', [p.body.id])).developer_id, target);
    assert.ok((await q1('SELECT aliases FROM developers WHERE id=$1', [target])).aliases.includes('Hiranandani Group Developers'));
  });
});

describe('Data quality dashboard', () => {
  it('flags missing and suspicious data', async () => {
    const r = await reviewer.get('/api/admin/data-quality');
    assert.equal(r.status, 200);
    const by = Object.fromEntries(r.body.checks.map((c) => [c.key, c]));
    assert.ok(by.missing_coords.items.some((x) => x.name === 'Lotus Bloom Enclave'));
    assert.ok(by.suspect_coords.items.some((x) => x.name === 'Coral Coast Bay'));
    assert.ok(by.missing_configs.items.some((x) => x.name === 'Granite Peak Towers'));
    assert.ok(by.invalid_towers.items.some((x) => x.name === 'Indus Horizon Kokapet'));
    assert.ok(by.stale.items.some((x) => x.name === 'Cedarwood Nerul Square'));
    assert.ok(by.possible_duplicates.items.some((x) => /Aurum Crest/.test(x.name)));
    assert.ok(by.expired_offers.items.some((x) => x.name === 'Cedarwood Noida 150'));
    assert.ok(by.eoi_conflict.items.some((x) => x.name === 'L&T Panvel'));
  });
  it('expired offers are hidden from sales', async () => {
    const d = await sales.get(`/api/explorer/projects/${(await q1("SELECT public_id FROM projects WHERE name='Cedarwood Noida 150'")).public_id}`);
    assert.ok(d.body.offers.every((o) => o.state !== 'expired'));
    assert.ok(d.body.expired_offers_hidden >= 1);
  });
});

describe('Bulk import', () => {
  it('upload → map → validate (errors + duplicates) → commit as drafts', async () => {
    const csv = [
      'Project Name,Developer,City,Location,Sub-Location,Launch Stage,Price Hint',
      'Import Test Gardens,Meridian Spaces,Mumbai,Navi Mumbai,Vashi,Launched,x',
      'Fortune City,Hiranandani,Mumbai,Navi Mumbai,Panvel,Launched,x',
      'Broken Row,Unknown Builder,Atlantis,,,Launched,x',
      'Import Test Gardens,Meridian Spaces,Mumbai,Navi Mumbai,Vashi,Launched,x',
    ].join('\n');
    const up = await editor.raw.post('/api/import/upload').set('x-requested-with', 'project-explorer').field('entity', 'projects').attach('file', Buffer.from(csv), 'projects.csv');
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.equal(up.body.mapping['Project Name'], 'name');
    assert.equal(up.body.mapping['Sub-Location'], 'sub_location');
    assert.equal(up.body.mapping['Price Hint'], null);
    // nothing written yet
    assert.equal((await q1("SELECT count(*)::int n FROM projects WHERE name='Import Test Gardens'")).n, 0);
    const v = await editor.post(`/api/import/${up.body.id}/validate`).send({ mapping: up.body.mapping });
    assert.equal(v.status, 200);
    const st = v.body.rows.map((r) => r.status);
    assert.deepEqual(st, ['warning', 'duplicate', 'error', 'error']); // row 1 warns: no map coordinates
    assert.ok(v.body.rows[2].messages.some((m) => /Developer "Unknown Builder" not found/.test(m.message)));
    assert.ok(v.body.rows[3].messages.some((m) => /appears earlier in this file/.test(m.message)));
    const rep = await editor.raw.get(`/api/import/${up.body.id}/report.csv`);
    assert.match(rep.text, /Unknown Builder/);
    const c = await editor.post(`/api/import/${up.body.id}/commit`).send({});
    assert.equal(c.status, 200);
    assert.equal(c.body.created.length, 1);
    assert.equal(c.body.skipped.length, 3);
    const p = await q1("SELECT record_status, public_id FROM projects WHERE name='Import Test Gardens'");
    assert.equal(p.record_status, 'draft');
    const audit = await q1("SELECT count(*)::int n FROM audit_log WHERE batch_id=$1", [up.body.id]);
    assert.ok(audit.n >= 2);
    assert.equal((await editor.post(`/api/import/${up.body.id}/commit`).send({})).status, 409);
  });
  it('imports configurations with Indian money formats', async () => {
    const csv = 'Project ID,Configuration,Carpet,Price\nPRJ-MUM-000003,4 BHK,1450,"2.85 Cr"\nPRJ-MUM-000003,Duplex,1600,3 Cr\n';
    const up = await editor.raw.post('/api/import/upload').set('x-requested-with', 'project-explorer').field('entity', 'configurations').attach('file', Buffer.from(csv), 'cfg.csv');
    const v = await editor.post(`/api/import/${up.body.id}/validate`).send({ mapping: up.body.mapping });
    assert.deepEqual(v.body.rows.map((r) => r.status), ['ok', 'error']);
    const c = await editor.post(`/api/import/${up.body.id}/commit`).send({});
    assert.equal(c.body.created.length, 1);
    const row = await q1("SELECT price_from, calc_psf FROM project_configurations WHERE id=$1", [c.body.created[0].id]);
    assert.equal(row.price_from, 28500000);
  });
});
