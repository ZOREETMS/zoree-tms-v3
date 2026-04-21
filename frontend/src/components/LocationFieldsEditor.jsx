import React from "react";
import LocationSearchDropdown from "./LocationSearchDropdown"; // REQ-29

// ═══════════════════════════════════════════════════════════════════
// REQ-24 — Shared Ship-From / Ship-To editor
//
// Renders the four editable fields (Location Name + City + State +
// ZIP) for a single side of a lane. Consumed by:
//   • NewOrderModal            (OMS — new order)
//   • OrderDetailModal         (OMS — edit order)
//   • NewShipmentModal         (TMS — new shipment)
//   • ShipmentsPage detail     (TMS — inline edit on a shipment)
//
// Caller owns the state; this component is intentionally a
// controlled input group with no data fetching. All four fields
// follow the `{ name, city, state, zip }` canonical shape defined
// in `src/types/location.js`.
//
// Two layouts:
//   • "stacked"  — label on top, Name on its own row, then
//                  City / State / ZIP in a 2:1:1 grid. Used by the
//                  large modals (new order / new shipment / edit).
//   • "compact"  — single-column stack sized for a narrow column
//                  (used by the inline editor on ShipmentDetailModal).
// ═══════════════════════════════════════════════════════════════════

const STACKED_INPUT = {
  width: "100%",
  padding: "8px 10px",
  border: "1.5px solid var(--border)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const COMPACT_INPUT = {
  padding: "5px 8px",
  fontSize: 12,
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontFamily: "inherit",
};

const STACKED_LABEL = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text3)",
  display: "block",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 5,
};

/**
 * @param {Object} props
 * @param {string} props.label                — "Ship From" | "Ship To" | etc.
 * @param {{name:string,city:string,state:string,zip:string}} props.value
 * @param {(next:{name:string,city:string,state:string,zip:string}) => void} props.onChange
 * @param {"stacked"|"compact"} [props.layout="stacked"]
 * @param {boolean} [props.required=false]    — marks City + State inputs required
 * @param {string}  [props.nameLabel="Location Name"]
 * @param {string}  [props.namePlaceholder]
 * @param {string}  [props.cityPlaceholder="City"]
 * @param {boolean} [props.enableSearch=false]     — REQ-29: when true,
 *                   the Name field becomes a searchable combobox with
 *                   inline "Create new location" affordance. Selecting
 *                   a result auto-populates City/State/ZIP so the
 *                   caller's three sibling inputs fill in automatically.
 * @param {"oms"|"tms"} [props.searchSource="oms"] — which master table
 *                   backs the search. OMS screens → oms_locations,
 *                   TMS screens → locations.
 */
export default function LocationFieldsEditor({
  label,
  value,
  onChange,
  layout = "stacked",
  required = false,
  nameLabel = "Location Name",
  namePlaceholder = "Location Name",
  cityPlaceholder = "City",
  enableSearch = false,
  searchSource = "oms",
}) {
  const v = value || { name: "", city: "", state: "", zip: "" };
  const set = (field, next) => onChange({ ...v, [field]: next });

  if (layout === "compact") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {label && (
          <div
            style={{
              fontSize: 10,
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: 0.8,
              fontWeight: 700,
            }}
          >
            {label}
          </div>
        )}
        <input
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={namePlaceholder}
          style={COMPACT_INPUT}
        />
        <input
          value={v.city}
          onChange={(e) => set("city", e.target.value)}
          placeholder={cityPlaceholder}
          style={COMPACT_INPUT}
          required={required}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <input
            value={v.state}
            onChange={(e) => set("state", e.target.value)}
            placeholder="State"
            maxLength={2}
            style={{ ...COMPACT_INPUT, textTransform: "uppercase" }}
            required={required}
          />
          <input
            value={v.zip}
            onChange={(e) => set("zip", e.target.value)}
            placeholder="ZIP"
            maxLength={5}
            style={COMPACT_INPUT}
          />
        </div>
      </div>
    );
  }

  // default: stacked
  const locked = enableSearch && !!v.name && !!v.city && !!v.state;
  return (
    <div>
      {label && (
        <label style={STACKED_LABEL}>
          {label}
          {required ? " *" : ""}
        </label>
      )}

      {enableSearch ? (
        // REQ-29: search + create combobox. Replaces the plain Name
        // input. Selecting a location calls onChange with the full
        // {name, city, state, zip} so sibling fields auto-populate.
        <div style={{ marginBottom: 8 }}>
          <LocationSearchDropdown
            source={searchSource}
            value={v}
            onSelect={(picked) => onChange({ ...v, ...picked })}
            placeholder={`${nameLabel} (e.g. Dallas DC)`}
          />
        </div>
      ) : (
        <input
          value={v.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={`${nameLabel} (e.g. Dallas DC)`}
          style={{ ...STACKED_INPUT, marginBottom: 8 }}
          aria-label={nameLabel}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
        <input
          value={v.city}
          onChange={(e) => set("city", e.target.value)}
          placeholder={required ? "City *" : cityPlaceholder}
          style={{
            ...STACKED_INPUT,
            background: locked ? "#f2f4f7" : undefined,
          }}
          required={required}
          readOnly={locked}
          aria-label="City"
        />
        <input
          value={v.state}
          onChange={(e) => set("state", e.target.value)}
          placeholder={required ? "ST *" : "ST"}
          maxLength={2}
          style={{
            ...STACKED_INPUT,
            textTransform: "uppercase",
            background: locked ? "#f2f4f7" : undefined,
          }}
          required={required}
          readOnly={locked}
          aria-label="State"
        />
        <input
          value={v.zip}
          onChange={(e) => set("zip", e.target.value)}
          placeholder="ZIP"
          maxLength={10}
          style={{
            ...STACKED_INPUT,
            background: locked ? "#f2f4f7" : undefined,
          }}
          readOnly={locked}
          aria-label="ZIP"
        />
      </div>
    </div>
  );
}
