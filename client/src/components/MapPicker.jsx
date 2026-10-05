import { useEffect, useRef } from 'react';
import L from 'leaflet';

/** Click or drag to set project coordinates. */
export default function MapPicker({ lat, lng, onChange, center, settings }) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const icon = L.divIcon({ className: '', html: '<div class="pin sel"></div>', iconSize: [32, 32], iconAnchor: [5, 32] });

  useEffect(() => {
    const start = lat != null ? [lat, lng] : center || settings?.default_center || [19.05, 73.02];
    const m = L.map(el.current).setView(start, lat != null ? 15 : 13);
    L.tileLayer(settings?.tile_url || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: settings?.attribution, maxZoom: 19 }).addTo(m);
    m.on('click', (e) => cb.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
    map.current = m;
    return () => m.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (lat == null || lng == null) { marker.current?.remove(); marker.current = null; return; }
    if (!marker.current) {
      marker.current = L.marker([lat, lng], { draggable: true, icon }).addTo(m);
      marker.current.on('dragend', (e) => { const p = e.target.getLatLng(); cb.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))); });
    } else marker.current.setLatLng([lat, lng]);
  }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (center && lat == null && map.current) map.current.setView(center, 14); }, [center?.[0], center?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} style={{ height: 300, borderRadius: 8, border: '1px solid var(--line)', position: 'relative', zIndex: 0 }} />;
}
