// Project detail sections in the order sales asked for. Used by the explorer drawer (compact)
// and the Detailed Overview page (full).
import { Fragment, useMemo } from 'react';
import { ago, date, fieldValue, inr, inrRange, num, psf, sqft } from '../format.js';
import { MatchBadge, StatusBadge } from './ui.jsx';

const HL = { connectivity: 'Connectivity', location_advantage: 'Location advantages', usp_residential: 'Residential USP', usp_investment: 'Investment USP' };

function useFieldRules(d) {
  return useMemo(() => {
    const by = new Map(d.fields.map((f) => [`${f.entity}.${f.key}`, f]));
    return {
      show: (entity, key, where = 'detail') => { const f = by.get(`${entity}.${key}`); return !f || f[`show_in_${where}`] !== false; },
      label: (entity, key, fallback) => by.get(`${entity}.${key}`)?.label || fallback,
      custom: (entity, where = 'detail', section) => d.fields.filter((f) => f.entity === entity && f.storage === 'attribute' && f[`show_in_${where}`] && (!section || f.section === section)),
    };
  }, [d.fields]);
}

export function renderAttr(f, v, ref) {
  if (v === null || v === undefined) return null;
  switch (f.data_type) {
    case 'money': return inr(v);
    case 'area': return `${num(v)} ${f.unit || 'sq.ft.'}`;
    case 'number': case 'integer': return `${num(v)}${f.unit ? ` ${f.unit}` : ''}`;
    case 'boolean': return v ? 'Yes' : 'No';
    case 'tristate': return { yes: 'Yes', no: 'No', na: 'Not applicable', unknown: 'Unknown' }[v];
    case 'date': return date(v, 'day');
    case 'select': return ref?.[v] ?? v;
    case 'multiselect': return (v || []).map((x) => ref?.[x] ?? x).join(', ');
    default: return String(v);
  }
}

function KV({ items }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <dl className="kv">
      {shown.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className={v?.missing || v?.muted ? 'missing' : ''}>{v?.text ?? v}</dd></Fragment>)}
    </dl>
  );
}

export function ConfigTable({ configs, showMatch }) {
  if (!configs.length) return <div className="small muted">No configurations entered yet.</div>;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr>{showMatch && <th />}<th>Configuration</th><th className="num">Area</th><th className="num">Price</th><th className="num">₹/sq.ft.</th><th>Inventory</th><th>Parking</th></tr></thead>
        <tbody>
          {configs.map((c) => (
            <tr key={c.id} className={showMatch && c.match === 'none' ? 'dim' : ''}>
              {showMatch && <td title={c.reasons?.map((r) => r.text).join('\n')}>{c.match && <span className={`dot ${c.match}`} />}</td>}
              <td><b>{c.type}</b>{c.variant && <div className="small muted">{c.variant}</div>}{c.remarks && <div className="small muted">{c.remarks}</div>}</td>
              <td className="num">{c.carpet_from || c.carpet_to ? sqft(c.carpet_from, c.carpet_to) : <span className="muted">—</span>}{c.area_label !== 'Carpet' && <div className="small muted">{c.area_label}</div>}{c.sbua_from && <div className="small muted">SBUA {sqft(c.sbua_from, c.sbua_to)}</div>}</td>
              <td className="num"><b>{c.price_on_request ? 'On request' : inrRange(c.price_from, c.price_to)}</b></td>
              <td className="num">{c.psf ? <>{psf(c.psf.value)}<div className="small muted">{c.psf.source === 'developer' ? 'Developer' : `Calc. on ${c.psf_basis === 'sbua' ? 'SBUA' : 'carpet'}`}</div></> : '—'}</td>
              <td>{c.inventory_status || <span className="muted">—</span>}{c.inventory_details && <div className="small muted">{c.inventory_details}</div>}</td>
              <td>{c.parking_count != null ? `${c.parking_count}` : ''}{c.parking_remarks && <div className="small muted">{c.parking_remarks}</div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TowerTable({ towers }) {
  if (!towers.length) return null;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>Tower</th><th className="num">Floors</th><th className="num">Habitable from</th><th className="num">Flats / floor</th><th className="num">Lifts</th><th>Elevation</th></tr></thead>
        <tbody>
          {towers.map((t) => (
            <tr key={t.id}>
              <td><b>{t.name}</b>{t.represents_count > 1 && <span className="badge" style={{ marginLeft: 6 }}>× {t.represents_count}</span>}{t.phase && <div className="small muted">{t.phase}</div>}{t.remarks && <div className="small muted" style={{ whiteSpace: 'pre-line' }}>{t.remarks}</div>}</td>
              <td className="num">{t.floors_above_ground != null ? `G+${t.floors_above_ground}` : '—'}</td>
              <td className="num">{t.habitable_from_floor ?? '—'}</td>
              <td className="num">{t.flats_per_floor ?? '—'}</td>
              <td className="num">{t.main_lifts ?? '—'}{t.service_lifts ? ` + ${t.service_lifts} service` : ''}</td>
              <td>{t.elevation_band || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ProjectDetail({ d, full, masterLabels, matchConfigs }) {
  const rules = useFieldRules(d);
  const v = d.values;
  const st = d.field_states || {};
  const cfgs = matchConfigs || d.configurations;
  const priced = d.configurations.filter((c) => c.price_from || c.price_to);
  const carpets = d.configurations.filter((c) => c.carpet_from || c.carpet_to);
  const priceSpan = priced.length ? inrRange(Math.min(...priced.map((c) => c.price_from ?? c.price_to)), Math.max(...priced.map((c) => c.price_to ?? c.price_from))) : null;
  const carpetSpan = carpets.length ? sqft(Math.min(...carpets.map((c) => c.carpet_from ?? c.carpet_to)), Math.max(...carpets.map((c) => c.carpet_to ?? c.carpet_from))) : null;
  const psfs = d.configurations.map((c) => c.psf?.value).filter(Boolean);
  const psfSpan = psfs.length ? (Math.min(...psfs) === Math.max(...psfs) ? psf(psfs[0]) : `${psf(Math.min(...psfs))}–${num(Math.round(Math.max(...psfs)))}`) : null;
  const types = [...new Set(d.configurations.map((c) => c.type))].join(', ');
  const fv = (key, render) => fieldValue(v[key], st[key], render);
  const hl = (kind) => d.highlights.filter((h) => h.kind === kind);
  const purposeMeta = d.purpose?.code === 'RES' ? { r: true } : d.purpose?.code === 'INV' ? { i: true } : { r: true, i: true };
  const amenByCat = d.amenities.reduce((m, a) => { (m[a.category] ||= []).push(a); return m; }, {});
  const customSummary = rules.custom('project', 'summary');

  const snap = [
    ['Developer', d.developer?.name], ['Location', [d.sub_location?.name, d.location?.name].filter(Boolean).join(', ') || null],
    ['Purpose', d.purpose?.label], ['Launch stage', d.launch_stage?.label], ['Status', d.sales_status?.label],
    rules.show('project', 'dev_possession_date', 'summary') && ['Developer possession', fieldValue(v.dev_possession_date, st.dev_possession_date, date).text],
    rules.show('project', 'rera_possession_date', 'summary') && ['RERA possession', fieldValue(v.rera_possession_date, st.rera_possession_date, date).text],
    ['Configurations', types || null], ['Price', priceSpan, true], ['Carpet', carpetSpan], ['₹/sq.ft.', psfSpan],
    rules.show('project', 'land_parcel_acres', 'summary') && ['Land parcel', fieldValue(v.land_parcel_acres, st.land_parcel_acres, (x) => `${num(x)} acres`).text],
    ...customSummary.map((f) => [f.label, renderAttr(f, d.attributes[f.key], masterLabels)]),
  ].filter(Boolean);

  const parkingLevels = [v.basement_levels && `${v.basement_levels} basement`, v.stilt_levels && `${v.stilt_levels} stilt`, v.podium_levels && `${v.podium_levels} podium`].filter(Boolean).join(' + ');
  const eoiNA = d.eoi_type?.code === 'NA';

  return (
    <div>
      <div className="snap-grid">
        {snap.map(([k, val, big]) => (
          <div key={k}><div className="k">{k}</div><div className={`v ${big ? 'big' : ''} ${val == null || val === 'Not provided' ? 'missing' : ''}`}>{val ?? 'Not provided'}</div></div>
        ))}
      </div>
      {(d.freshness.stale || d.freshness.unverified_changes) && (
        <div className="notice warn" style={{ marginTop: 10 }}>
          <div>{d.freshness.stale ? `Information may require verification — last updated ${ago(d.freshness.updated_at)}.` : 'Changed since it was last verified.'} Confirm critical details (price, possession) with the developer before committing to the customer.</div>
        </div>
      )}

      <section className="dsec"><h3>Configurations</h3><ConfigTable configs={cfgs} showMatch={!!matchConfigs} /></section>

      <section className="dsec">
        <h3>Towers {d.tower_summary && <span className="small muted" style={{ fontWeight: 500 }}>{d.tower_summary.towers_recorded}{d.tower_summary.total_towers ? ` of ${d.tower_summary.total_towers}` : ''} towers recorded{d.tower_summary.elevation_bands.length ? ` · ${d.tower_summary.elevation_bands.join(', ')}` : ''}</span>}</h3>
        {d.towers.length ? <TowerTable towers={d.towers} /> : <div className="small muted">No tower information yet.</div>}
      </section>

      <section className="dsec">
        <h3>Parking</h3>
        <KV items={[
          ['Parking', v.has_parking ? { yes: 'Available', no: 'No parking', na: 'Not applicable', unknown: 'Unknown' }[v.has_parking] : (parkingLevels ? 'Available' : fieldValue(null, st.has_parking))],
          parkingLevels && ['Structure', parkingLevels],
          v.parking_remarks && ['Remarks', v.parking_remarks],
          ...d.configurations.filter((c) => c.parking_count != null).slice(0, 6).map((c) => [`${c.type}${c.variant ? ` ${c.variant}` : ''}`, `${c.parking_count} per unit`]),
        ]} />
      </section>

      {rules.show('project', 'land_parcel_acres') && (
        <section className="dsec">
          <h3>Land &amp; open space</h3>
          <KV items={[
            ['Land parcel', fv('land_parcel_acres', (x) => `${num(x)} acres`)], v.land_parcel_remarks && ['', v.land_parcel_remarks],
            rules.show('project', 'open_space_acres') && ['Open space', v.open_space_acres != null ? `${num(v.open_space_acres)} acres` : v.open_space_pct != null ? `${num(v.open_space_pct)}%` : fieldValue(v.open_space_remarks, st.open_space_acres)],
            v.open_space_remarks && v.open_space_acres != null && ['', v.open_space_remarks],
            ...rules.custom('project', 'detail', 'land').map((f) => [f.label, fieldValue(d.attributes[f.key], st[f.key], (x) => renderAttr(f, x, masterLabels))]),
          ]} />
        </section>
      )}

      <section className="dsec">
        <h3>Amenities</h3>
        {d.amenities.length ? <div className="amen-cats">{Object.entries(amenByCat).map(([cat, list]) => <div key={cat}><h4>{cat}</h4>{list.map((a) => <div key={a.id}>{a.name}{a.remarks && <span className="muted"> — {a.remarks}</span>}</div>)}</div>)}</div> : <div className="small muted">Not provided</div>}
        {v.amenity_remarks && <div className="small" style={{ whiteSpace: 'pre-line', marginTop: 8 }}>{v.amenity_remarks}</div>}
        {rules.custom('project', 'detail', 'amenities').map((f) => d.attributes[f.key] != null && <div key={f.key} className="small" style={{ marginTop: 6 }}><span className="muted">{f.label}:</span> <b>{renderAttr(f, d.attributes[f.key], masterLabels)}</b></div>)}
      </section>

      {['connectivity', 'location_advantage', purposeMeta.r && 'usp_residential', purposeMeta.i && 'usp_investment'].filter(Boolean).map((k) => (
        <section className="dsec" key={k}>
          <h3>{HL[k]}</h3>
          {hl(k).length ? <ul className="bul">{hl(k).map((h) => <li key={h.id}>{h.text}{h.distance_km != null && <span className="tm"> · {num(h.distance_km)} km</span>}</li>)}</ul> : <div className="small muted">Not provided</div>}
          {k === 'location_advantage' && v.other_location_remarks && <div className="small" style={{ whiteSpace: 'pre-line', marginTop: 6 }}>{v.other_location_remarks}</div>}
        </section>
      ))}

      <section className="dsec">
        <h3>Payment plans</h3>
        {d.payment_plans.length ? <ul className="bul">{d.payment_plans.map((p) => <li key={p.id}><b>{p.name}</b>{p.applicable_to && <span className="muted"> · for {p.applicable_to}</span>}{p.remarks && p.remarks !== p.name && <div className="muted">{p.remarks}</div>}</li>)}</ul> : <div className="small muted">Not provided</div>}
      </section>

      <section className="dsec">
        <h3>Current offers</h3>
        {d.offers.length ? <ul className="bul">{d.offers.map((o) => <li key={o.id}><b>{o.name}</b>{o.state === 'upcoming' && <span className="badge info" style={{ marginLeft: 6 }}>Starts {date(o.start_date, 'day')}</span>}{o.end_date && <span className="muted"> · valid till {date(o.end_date, 'day')}</span>}{!o.end_date && <span className="muted"> · no end date given</span>}{o.description && <div className="muted">{o.description}</div>}</li>)}</ul> : <div className="small muted">No current offers</div>}
        {d.expired_offers_hidden > 0 && <div className="help" style={{ marginTop: 4 }}>{d.expired_offers_hidden} expired offer(s) hidden.</div>}
      </section>

      <section className="dsec">
        <h3>EOI</h3>
        <KV items={[
          ['EOI type', d.eoi_type ? d.eoi_type.label : fieldValue(null, st.eoi_type_id)],
          !eoiNA && ['Amount', fv('eoi_amount', inr)],
          !eoiNA && v.eoi_date && ['From', date(v.eoi_date, 'day')],
          !eoiNA && ['Valid until', fv('eoi_valid_until', (x) => date(x, 'day'))],
          v.eoi_remarks && ['Remarks', v.eoi_remarks],
        ]} />
      </section>

      <section className="dsec">
        <h3>Developer</h3>
        <div style={{ fontWeight: 600 }}>{d.developer?.name || 'Not provided'}</div>
        {d.developer?.about && <p className="small" style={{ marginTop: 4 }}>{d.developer.about}</p>}
        {v.developer_remarks && <p className="small" style={{ whiteSpace: 'pre-line' }}>{v.developer_remarks}</p>}
        {d.rera.length > 0 && <div className="small"><span className="muted">RERA:</span> {d.rera.map((r) => `${r.rera_number}${r.phase_label ? ` (${r.phase_label})` : ''}`).join(', ')}</div>}
      </section>

      <section className="dsec">
        <h3>Objection handling</h3>
        {d.objections.filter((o) => o.response).map((o) => <div className="qa" key={o.id}><div className="q">“{o.objection}”</div><div>{o.response}</div></div>)}
        {d.objections.filter((o) => !o.response).length > 0 && <div className="help" style={{ marginBottom: 8 }}>Open questions without an agreed answer: {d.objections.filter((o) => !o.response).map((o) => o.objection).join('; ')}</div>}
        {full && d.generic_objections?.map((o) => <div className="qa generic" key={o.id}><div className="q">“{o.objection}” <span className="badge" style={{ marginLeft: 4 }}>General</span></div><div>{o.response}</div></div>)}
        {!d.objections.length && !full && <div className="small muted">No project-specific answers yet. See Objection handling for general answers.</div>}
      </section>

      {(v.other_remarks || rules.custom('project', 'detail', 'remarks').length > 0) && (
        <section className="dsec"><h3>Other remarks</h3><div className="small" style={{ whiteSpace: 'pre-line' }}>{v.other_remarks}</div></section>
      )}

      {full && (
        <>
          {rules.custom('project', 'detail').filter((f) => !['amenities', 'land', 'remarks'].includes(f.section) && d.attributes[f.key] != null).length > 0 && (
            <section className="dsec"><h3>More details</h3><KV items={rules.custom('project', 'detail').filter((f) => !['amenities', 'land', 'remarks'].includes(f.section)).map((f) => [f.label, fieldValue(d.attributes[f.key], st[f.key], (x) => renderAttr(f, x, masterLabels))])} /></section>
          )}
          <section className="dsec">
            <h3>Location</h3>
            <KV items={[['City', d.city?.name], ['Location', d.location?.name], ['Sub-location', d.sub_location?.name], ['Locality', fv('locality')], ['Landmark', fv('landmark')], ['Address', fv('address')],
              ['Coordinates', v.latitude != null ? `${Number(v.latitude).toFixed(5)}, ${Number(v.longitude).toFixed(5)} (${v.coords_status})` : fieldValue(null)]]} />
          </section>
          {(d.parent || d.phases?.length > 0 || d.aliases?.length > 0) && (
            <section className="dsec">
              <h3>Phases &amp; previous names</h3>
              {d.parent && <div className="small">Part of <a href={`/p/${d.parent.public_id}`}>{d.parent.name}</a></div>}
              {d.phases?.map((p) => <div className="small" key={p.id}>Phase: <a href={`/p/${p.public_id}`}>{p.name}</a></div>)}
              {d.aliases?.length > 0 && <div className="small">Previously known as: {d.aliases.map((a) => a.name).join(', ')}</div>}
            </section>
          )}
        </>
      )}
      <div className="fresh" style={{ marginTop: 18 }}>
        <span>{d.public_id}</span>
        <span>Updated {ago(d.freshness.updated_at)}{d.freshness.updated_by ? ` by ${d.freshness.updated_by}` : ''}</span>
        <span>{d.freshness.verified_at ? `Verified ${date(d.freshness.verified_at, 'day')}${d.freshness.verified_by ? ` by ${d.freshness.verified_by}` : ''}` : 'Not yet verified'}</span>
        {full && <span>Created {date(d.freshness.created_at, 'day')}{d.freshness.created_by ? ` by ${d.freshness.created_by}` : ''}</span>}
      </div>
    </div>
  );
}

export function DetailHeader({ d, match, children }) {
  return (
    <div className="grow">
      <div className="row wrap" style={{ gap: 6, marginBottom: 4 }}>
        {match && <MatchBadge status={match} />}
        {d.record_status !== 'published' && <StatusBadge status={d.record_status} />}
        {d.sales_status && <span className="badge">{d.sales_status.label}</span>}
      </div>
      <h2 style={{ fontSize: 'var(--step-2)' }}>{d.name}</h2>
      <div className="small muted" style={{ marginTop: 2 }}>{[d.developer?.name, d.sub_location?.name, d.location?.name, d.city?.name].filter(Boolean).join(', ')}{d.values.landmark ? ` — ${d.values.landmark}` : ''}</div>
      {children}
    </div>
  );
}
