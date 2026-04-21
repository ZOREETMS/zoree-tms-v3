import React, { useEffect, useState } from "react";
import { LocationsApi } from "../lib/api";

// ═══════════════════════════════════════════════════════════════════
// REQ-29 — inline "Create new location" modal launched from the
// LocationSearchDropdown. Persists to oms_locations; the DB trigger
// propagates to TMS locations and mw_requests (REQ-30).
// ═══════════════════════════════════════════════════════════════════

// Must stay in sync with the oms_locations_type_check constraint.
const LOCATION_TYPES = [
  "Warehouse",
  "Distribution Center",
  "Cross-Dock",
  "Plant",
  "Store",
  "Shipper",
  "Consignee",
  "Customer",
  "Supplier",
  "Port",
  "Rail Yard",
  "Generic",
];

const labelSt = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text3)",
  display: "block",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 5,
};

const inputSt = {
  width: "100%",
  padding: "8px 10px",
  border: "1.5px solid var(--border)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function suggestIdFromName(name) {
  return String(name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export default function LocationCreateInlineModal({
  show,
  initialName = "",
  onClose,
  onCreated,
}) {
  const [form, setForm] = useState({
    id: "",
    name: "",
    type: "Warehouse",
    address: "",
    city: "",
    state: "",
    zip: "",
    country: "US",
    dockDoors: 4,
    active: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Reset whenever the modal re-opens — keep initialName as a seed.
  useEffect(() => {
    if (show) {
      setForm({
        id: suggestIdFromName(initialName) || "",
        name: initialName || "",
        type: "Warehouse",
        address: "",
        city: "",
        state: "",
        zip: "",
        country: "US",
        dockDoors: 4,
        active: true,
      });
      setError("");
    }
  }, [show, initialName]);

  if (!show) return null;

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { location } = await LocationsApi.create(form);
      onCreated?.(location);
    } catch (err) {
      setError(err?.message || "Failed to create location");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 60 }}>
      <div
        className="modal-card"
        style={{ width: 520, maxHeight: "92vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Create New Location</h3>
          <button className="modal-close" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div className="modal-body" style={{ overflowY: "auto", flex: 1 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={labelSt}>Location ID *</label>
                <input
                  value={form.id}
                  onChange={(e) => upd("id", e.target.value.toUpperCase())}
                  placeholder="WH-MIA-001"
                  style={inputSt}
                  required
                />
              </div>
              <div>
                <label style={labelSt}>Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => upd("name", e.target.value)}
                  placeholder="Miami DC"
                  style={inputSt}
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Type *</label>
              <select
                value={form.type}
                onChange={(e) => upd("type", e.target.value)}
                style={{ ...inputSt, background: "#fff" }}
              >
                {LOCATION_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelSt}>Address</label>
              <input
                value={form.address}
                onChange={(e) => upd("address", e.target.value)}
                placeholder="123 Shipping Ln"
                style={inputSt}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr",
                gap: 8,
                marginBottom: 12,
              }}
            >
              <div>
                <label style={labelSt}>City *</label>
                <input
                  value={form.city}
                  onChange={(e) => upd("city", e.target.value)}
                  style={inputSt}
                  required
                />
              </div>
              <div>
                <label style={labelSt}>State *</label>
                <input
                  value={form.state}
                  onChange={(e) => upd("state", e.target.value.toUpperCase())}
                  maxLength={2}
                  style={{ ...inputSt, textTransform: "uppercase" }}
                  required
                />
              </div>
              <div>
                <label style={labelSt}>ZIP *</label>
                <input
                  value={form.zip}
                  onChange={(e) => upd("zip", e.target.value)}
                  maxLength={10}
                  style={inputSt}
                  required
                />
              </div>
              <div>
                <label style={labelSt}>Country</label>
                <input
                  value={form.country}
                  onChange={(e) => upd("country", e.target.value.toUpperCase())}
                  maxLength={2}
                  minLength={2}
                  style={{ ...inputSt, textTransform: "uppercase" }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelSt}>Dock Doors</label>
                <input
                  type="number"
                  min={0}
                  value={form.dockDoors}
                  onChange={(e) => upd("dockDoors", Number(e.target.value))}
                  style={inputSt}
                />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 6 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => upd("active", e.target.checked)}
                  />
                  Active
                </label>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  padding: "8px 10px",
                  background: "#fef2f2",
                  color: "#b91c1c",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save Location"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
