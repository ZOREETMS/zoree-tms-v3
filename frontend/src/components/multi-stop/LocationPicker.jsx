import { useState, useRef, useEffect, useMemo } from "react";

/**
 * LocationPicker — typeahead search dropdown for location master.
 * Props: value, locations (array), onChange({ location, lat, lng }), hasError
 */
export default function LocationPicker({ value, locations, onChange, hasError = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value || "");
  const ref = useRef(null);

  useEffect(() => {
    setSearch(value || "");
  }, [value]);

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return locations.slice(0, 20);
    const t = search.toLowerCase();
    return locations
      .filter(
        (l) =>
          String(l.name || "").toLowerCase().includes(t) ||
          String(l.address || "").toLowerCase().includes(t) ||
          String(l.city || "").toLowerCase().includes(t) ||
          String(l.state || "").toLowerCase().includes(t)
      )
      .slice(0, 20);
  }, [locations, search]);

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <input
        type="text"
        value={search}
        placeholder="Search city..."
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          onChange({ location: e.target.value, lat: null, lng: null });
        }}
        onFocus={() => setOpen(true)}
        style={{
          width: "100%",
          ...(hasError ? { borderColor: "#DC2626", boxShadow: "0 0 0 3px rgba(220,38,38,0.08)" } : {}),
        }}
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid var(--border2)",
            borderRadius: 8,
            maxHeight: 180,
            overflowY: "auto",
            zIndex: 999,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          {filtered.map((loc) => {
            const display = [loc.name, loc.city, loc.state].filter(Boolean).join(", ");
            return (
              <div
                key={loc.id || display}
                onClick={() => {
                  setSearch(display);
                  setOpen(false);
                  onChange({ location: display, lat: loc.lat || null, lng: loc.lng || null });
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border)",
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "var(--bg)")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ fontWeight: 600 }}>{loc.name}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>
                  {[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(", ")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
