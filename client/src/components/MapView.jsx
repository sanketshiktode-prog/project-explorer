import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import { inr } from '../format.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pinIcon(status, selected) {
  return L.divIcon({ className: '', html: `<div class="pin ${selected ? 'sel' : status}"></div>`, iconSize: [26, 26], iconAnchor: [4, 26], popupAnchor: [9, -24] });
}

/**
 * Filtered projects on a map with clustering.
 * points: [{id, name, lat, lng, status, developer, price_from}]
 * cardFor(id) → Promise<{html}> builds the compact card shown in the popup.
 */
export default function MapView({ points, selectedId, onSelect, settings, cardFor, fitKey }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const markers = useRef(new Map());
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const cardRef = useRef(cardFor);
  cardRef.current = cardFor;

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: false })
      .setView(settings?.default_center || [19.05, 73.02], settings?.default_zoom || 10);
    L.tileLayer(settings?.tile_url || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: settings?.attribution || '&copy; OpenStreetMap contributors', maxZoom: settings?.max_zoom || 19,
    }).addTo(m);
    layer.current = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const s = n < 10 ? 34 : n < 50 ? 40 : 48;
        return L.divIcon({ html: `<div class="cluster" style="width:${s}px;height:${s}px">${n}</div>`, className: '', iconSize: [s, s] });
      },
    });
    m.addLayer(layer.current);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); };
  }, [settings]);

  // (Re)draw markers when the result set changes
  useEffect(() => {
    const lg = layer.current;
    if (!lg) return;
    lg.clearLayers();
    markers.current.clear();
    for (const p of points) {
      const mk = L.marker([p.lat, p.lng], { icon: pinIcon(p.status, p.id === selectedId), title: p.name, keyboard: true, riseOnHover: true });
      mk.bindTooltip(`${esc(p.name)}${p.price_from ? ` · from ${inr(p.price_from)}` : ''}`, { direction: 'top', offset: [9, -22] });
      mk.on('click', async () => {
        onSelectRef.current?.(p.id, 'map');
        mk.bindPopup('<div class="small muted">Loading…</div>', { maxWidth: 320 }).openPopup();
        try {
          const html = await cardRef.current(p.id);
          mk.setPopupContent(html);
          const btn = mk.getPopup()?.getElement()?.querySelector('[data-open]');
          btn?.addEventListener('click', () => { mk.closePopup(); onSelectRef.current?.(p.id, 'details'); });
        } catch { mk.setPopupContent('<div class="small">Could not load project</div>'); }
      });
      markers.current.set(p.id, mk);
      lg.addLayer(mk);
    }
    if (points.length && map.current) {
      const b = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.current.fitBounds(b, { padding: [40, 40], maxZoom: 14 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, fitKey]);

  // Highlight selection without rebuilding everything
  useEffect(() => {
    for (const [id, mk] of markers.current) {
      const p = points.find((x) => x.id === id);
      if (p) mk.setIcon(pinIcon(p.status, id === selectedId));
    }
    const mk = markers.current.get(selectedId);
    if (mk && map.current && layer.current) {
      layer.current.zoomToShowLayer(mk, () => {});
    }
  }, [selectedId, points]);

  return <div ref={el} style={{ position: 'absolute', inset: 0 }} />;
}

export { esc };
