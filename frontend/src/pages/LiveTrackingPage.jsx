import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { resolveHereApiKey } from "../config/hereMaps";

/* ── City coordinates for map plotting ── */
const CITY_COORDS = {
  "chicago, il": { lat: 41.8781, lng: -87.6298 },
  "dallas, tx": { lat: 32.7767, lng: -96.797 },
  "atlanta, ga": { lat: 33.749, lng: -84.388 },
  "los angeles, ca": { lat: 34.0522, lng: -118.2437 },
  "new york, ny": { lat: 40.7128, lng: -74.006 },
  "houston, tx": { lat: 29.7604, lng: -95.3698 },
  "seattle, wa": { lat: 47.6062, lng: -122.3321 },
  "phoenix, az": { lat: 33.4484, lng: -112.074 },
  "columbus, oh": { lat: 39.9612, lng: -82.9988 },
  "miami, fl": { lat: 25.7617, lng: -80.1918 },
  "memphis, tn": { lat: 35.1495, lng: -90.049 },
  "denver, co": { lat: 39.7392, lng: -104.9903 },
  "kansas city, mo": { lat: 39.0997, lng: -94.5786 },
  "nashville, tn": { lat: 36.1627, lng: -86.7816 },
  "san francisco, ca": { lat: 37.7749, lng: -122.4194 },
  "portland, or": { lat: 45.5051, lng: -122.675 },
  "minneapolis, mn": { lat: 44.9778, lng: -93.265 },
  "st. louis, mo": { lat: 38.627, lng: -90.1994 },
  "detroit, mi": { lat: 42.3314, lng: -83.0458 },
  "philadelphia, pa": { lat: 39.9526, lng: -75.1652 },
  "boston, ma": { lat: 42.3601, lng: -71.0589 },
  "charlotte, nc": { lat: 35.2271, lng: -80.8431 },
  "indianapolis, in": { lat: 39.7684, lng: -86.1581 },
  "louisville, ky": { lat: 38.2527, lng: -85.7585 },
  "las vegas, nv": { lat: 36.1699, lng: -115.1398 },
  "san antonio, tx": { lat: 29.4241, lng: -98.4936 },
  "san diego, ca": { lat: 32.7157, lng: -117.1611 },
  "sacramento, ca": { lat: 38.5816, lng: -121.4944 },
};

const HERE_API_KEY = resolveHereApiKey();

function getCityCoords(city) {
  if (!city) return null;
  const key = city.toLowerCase().trim();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  for (const k in CITY_COORDS) {
    if (key.includes(k.split(",")[0]) || k.includes(key.split(",")[0]?.toLowerCase())) return CITY_COORDS[k];
  }
  return null;
}

function statusColor(status) {
  return status === "In Transit" ? "#3b82f6" : status === "Exception" ? "#ef4444" : status === "Delivered" ? "#22c55e" : status === "Tendered" ? "#f59e0b" : "#94a3b8";
}

function mkMarkerSvg(color, label) {
  return `<svg width="36" height="44" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg"><path d="M18 0C8.059 0 0 8.059 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.059 27.941 0 18 0z" fill="${color}"/><circle cx="18" cy="18" r="10" fill="white" opacity="0.95"/><text x="18" y="23" text-anchor="middle" font-size="11" font-weight="700" font-family="monospace" fill="${color}">${label}</text></svg>`;
}

/* ── Haversine distance ── */
function haversine(a, b) {
  const R = 3959;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

/* ── Load HERE Maps scripts ── */
const HERE_SCRIPTS = [
  "https://js.api.here.com/v3/3.1/mapsjs-core.js",
  "https://js.api.here.com/v3/3.1/mapsjs-service.js",
  "https://js.api.here.com/v3/3.1/mapsjs-ui.js",
  "https://js.api.here.com/v3/3.1/mapsjs-mapevents.js",
];
const HERE_CSS = "https://js.api.here.com/v3/3.1/mapsjs-ui.css";

let _hereLoading = false;
let _hereLoaded = false;
let _hereCallbacks = [];

function loadHereMaps(callback) {
  if (_hereLoaded && window.H) { callback(); return; }
  _hereCallbacks.push(callback);
  if (_hereLoading) return;
  _hereLoading = true;

  // Load CSS
  if (!document.querySelector(`link[href="${HERE_CSS}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = HERE_CSS;
    document.head.appendChild(link);
  }

  // Load scripts sequentially
  let idx = 0;
  function next() {
    if (idx >= HERE_SCRIPTS.length) {
      _hereLoaded = true;
      _hereCallbacks.forEach((cb) => cb());
      _hereCallbacks = [];
      return;
    }
    const src = HERE_SCRIPTS[idx++];
    if (document.querySelector(`script[src="${src}"]`)) { next(); return; }
    const script = document.createElement("script");
    script.src = src;
    script.onload = next;
    script.onerror = () => { console.warn("Failed to load HERE script:", src); next(); };
    document.head.appendChild(script);
  }
  next();
}

/* ── HERE Map Component ── */
function HereMapView({ shipments, onSelectShipment }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const platformRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [noApiKey, setNoApiKey] = useState(false);

  // Initialize map
  useEffect(() => {
    loadHereMaps(() => {
      if (!window.H || !containerRef.current) return;
      if (HERE_API_KEY === "YOUR_HERE_API_KEY") { setNoApiKey(true); return; }
      if (mapRef.current) return; // already initialized

      const platform = new window.H.service.Platform({ apikey: HERE_API_KEY });
      platformRef.current = platform;
      const layers = platform.createDefaultLayers();
      const map = new window.H.Map(containerRef.current, layers.vector.normal.map, {
        zoom: 4,
        center: { lat: 39.5, lng: -98.35 },
      });
      new window.H.mapevents.Behavior(new window.H.mapevents.MapEvents(map));
      window.H.ui.UI.createDefault(map, layers);
      mapRef.current = map;

      const resizeHandler = () => map.getViewPort().resize();
      window.addEventListener("resize", resizeHandler);
      setMapReady(true);

      return () => window.removeEventListener("resize", resizeHandler);
    });
  }, []);

  // Draw routes when shipments change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !shipments.length) return;

    map.removeObjects(map.getObjects());
    const bounds = [];

    shipments.forEach((s, i) => {
      const color = statusColor(s.status);
      const oC = getCityCoords(s.origin);
      const dC = getCityCoords(s.destination || s.dest);
      if (!oC || !dC) return;
      bounds.push(oC, dC);

      // Origin marker
      const oIcon = new window.H.map.Icon(
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(mkMarkerSvg(color, String(i + 1))),
        { size: { w: 36, h: 44 } }
      );
      const oMark = new window.H.map.Marker(oC, { icon: oIcon });
      map.addObject(oMark);

      // Destination marker
      const dSvg = `<svg width="22" height="22" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="10" fill="${color}" stroke="white" stroke-width="2"/><text x="11" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="white">D</text></svg>`;
      map.addObject(new window.H.map.Marker(dC, { icon: new window.H.map.Icon("data:image/svg+xml;charset=utf-8," + encodeURIComponent(dSvg), { size: { w: 22, h: 22 } }) }));

      // Curved route line
      const midLat = (oC.lat + dC.lat) / 2 + 2.5;
      const midLng = (oC.lng + dC.lng) / 2;
      const ls = new window.H.geo.LineString();
      for (let t = 0; t <= 1; t += 0.04) {
        ls.pushPoint({
          lat: (1 - t) * (1 - t) * oC.lat + 2 * (1 - t) * t * midLat + t * t * dC.lat,
          lng: (1 - t) * (1 - t) * oC.lng + 2 * (1 - t) * t * midLng + t * t * dC.lng,
        });
      }
      map.addObject(new window.H.map.Polyline(ls, { style: { lineWidth: 2.5, strokeColor: color, lineDash: [8, 4] } }));

      // Truck position for in-transit / exception
      if (s.status === "In Transit" || s.status === "Exception") {
        const p = 0.55;
        const tLat = (1 - p) * (1 - p) * oC.lat + 2 * (1 - p) * p * midLat + p * p * dC.lat;
        const tLng = (1 - p) * (1 - p) * oC.lng + 2 * (1 - p) * p * midLng + p * p * dC.lng;
        const tSvg = `<svg width="26" height="26" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="13" r="12" fill="${color}" stroke="white" stroke-width="2"/><text x="13" y="18" text-anchor="middle" font-size="13">🚛</text></svg>`;
        map.addObject(new window.H.map.Marker({ lat: tLat, lng: tLng }, { icon: new window.H.map.Icon("data:image/svg+xml;charset=utf-8," + encodeURIComponent(tSvg), { size: { w: 26, h: 26 } }) }));
      }

      // Click handler
      oMark.addEventListener("tap", () => {
        if (onSelectShipment) onSelectShipment(s);
      });
    });

    // Fit bounds
    if (bounds.length >= 2) {
      try {
        map.getViewModel().setLookAtData({
          bounds: new window.H.geo.Rect(
            Math.max(...bounds.map((b) => b.lat)),
            Math.min(...bounds.map((b) => b.lng)),
            Math.min(...bounds.map((b) => b.lat)),
            Math.max(...bounds.map((b) => b.lng))
          ),
        }, true);
      } catch (e) { /* ignore */ }
    }
  }, [shipments, mapReady, onSelectShipment]);

  if (noApiKey) {
    return (
      <div style={{ width: "100%", height: 520, borderRadius: 12, border: "1px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--text3)", background: "var(--bg3)" }}>
        <span style={{ fontSize: 36 }}>🗺️</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>HERE Maps API Key Required</span>
        <span style={{ fontSize: 12 }}>Get a free key at <a href="https://developer.here.com" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>developer.here.com</a></span>
        <span style={{ fontSize: 11, color: "var(--text3)", maxWidth: 320, textAlign: "center" }}>Replace YOUR_HERE_API_KEY in LiveTrackingPage.jsx, then reload</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: 520, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}
    />
  );
}

/* ── Route Info Bar ── */
function RouteInfoBar({ shipment }) {
  if (!shipment) return null;
  const oC = getCityCoords(shipment.origin);
  const dC = getCityCoords(shipment.destination || shipment.dest);
  const dist = oC && dC ? haversine(oC, dC) : "—";

  const items = [
    { label: "Shipment", value: shipment.id },
    { label: "Carrier", value: shipment.carrier || shipment.carrier_name || "—" },
    { label: "Route", value: `${shipment.origin || "—"} → ${shipment.destination || shipment.dest || "—"}` },
    { label: "Distance", value: typeof dist === "number" ? `${dist.toLocaleString()} mi` : dist },
    { label: "ETA", value: shipment.delivery_date || shipment.delivery || "—" },
    { label: "Status", value: shipment.status },
  ];

  return (
    <div style={{ display: "flex", gap: 20, padding: "10px 16px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, marginTop: 10, flexWrap: "wrap" }}>
      {items.map((item) => (
        <div key={item.label} style={{ fontSize: 12 }}>
          <div style={{ color: "var(--text3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 }}>{item.label}</div>
          <div style={{ fontWeight: 600, fontFamily: "'Courier New', monospace" }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Shipment Card ── */
function ShipmentCard({ s, isSelected, onClick }) {
  const pct = s.status === "Exception" ? 55 : 65;
  const color = statusColor(s.status);

  return (
    <div
      onClick={onClick}
      className="card"
      style={{
        marginBottom: 12,
        cursor: "pointer",
        border: isSelected ? `2px solid ${color}` : undefined,
        boxShadow: isSelected ? `0 4px 16px rgba(59,130,246,.12)` : undefined,
      }}
    >
      {/* Header */}
      <div className="card-header">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="mono" style={{ color: "var(--accent)", fontWeight: 700 }}>{s.id}</span>
          <span style={{
            padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: s.status === "In Transit" ? "rgba(59,130,246,.1)" : s.status === "Exception" ? "rgba(239,68,68,.1)" : s.status === "Delivered" ? "rgba(34,197,94,.1)" : "rgba(245,158,11,.1)",
            color: color,
          }}>{s.status}</span>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{s.carrier || s.carrier_name} · {s.mode}</span>
        </div>
        <span style={{ fontSize: 12, color: "var(--text3)" }}>ETA: {s.delivery_date || s.delivery || "—"}</span>
      </div>

      {/* Body */}
      <div className="card-body">
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>📍 {s.origin || "—"}</span>
          <span style={{ fontSize: 12, fontWeight: 600 }}>🏁 {s.destination || s.dest || "—"}</span>
        </div>
        <div style={{ height: 6, background: "var(--bg4)", borderRadius: 6, overflow: "hidden", marginBottom: 6 }}>
          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 6 }} />
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)" }}>
          {pct}% complete · {s.weight || "—"} · {s.commodity || s.equipment || ""}
        </div>
        {s.status === "Exception" && (
          <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(220,38,38,.08)", border: "1px solid rgba(220,38,38,.2)", fontSize: 12, color: "var(--red)", fontWeight: 600 }}>
            🚨 <strong>Delay Alert</strong> — Est. 6hrs behind schedule
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main Page ── */
export default function LiveTrackingPage() {
  const data = useOutletContext();
  const [selectedShipment, setSelectedShipment] = useState(null);

  const allShipments = data?.shipments || [];

  // Active shipments for tracking (In Transit, Exception, Tendered)
  const trackingShipments = useMemo(() => {
    return allShipments.filter((s) => ["In Transit", "Exception", "Tendered"].includes(s.status));
  }, [allShipments]);

  const handleMapSelect = useCallback((s) => {
    setSelectedShipment(s);
  }, []);

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Live Tracking</div>
          <div className="page-sub">Real-time visibility for all in-transit shipments</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--green)", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", display: "inline-block", animation: "pulse 1.5s infinite" }} />
            Live · Updated 1 min ago
          </span>
        </div>
      </div>

      <div className="page-content">
        {/* Map Legend */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "10px 14px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 12, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6" }} /> In Transit
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} /> Exception
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} /> Delivered
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text2)" }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} /> Tendered
          </div>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text3)" }}>
            {trackingShipments.length} shipment{trackingShipments.length !== 1 ? "s" : ""} shown
          </span>
        </div>

        {/* HERE Map */}
        <HereMapView shipments={trackingShipments} onSelectShipment={handleMapSelect} />

        {/* Selected shipment route info */}
        <RouteInfoBar shipment={selectedShipment} />

        {/* Shipment Cards */}
        <div style={{ marginTop: 16 }}>
          {trackingShipments.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--text3)" }}>
              No active shipments in transit
            </div>
          ) : (
            trackingShipments.map((s) => (
              <ShipmentCard
                key={s.id}
                s={s}
                isSelected={selectedShipment?.id === s.id}
                onClick={() => setSelectedShipment(selectedShipment?.id === s.id ? null : s)}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
