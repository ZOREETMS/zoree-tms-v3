import { useState, useEffect, useMemo } from "react";
import {
  MATCH_TYPE_OPTIONS,
  MATCH_TYPE_VALUES,
  normalizeMatchType,
} from "../services/rateService";
// Equipment master is the source of truth for trailers; getEquipmentList
// falls back to the seed catalog when the DB table is empty so the
// dropdown is populated even on a fresh tenant.
import { getEquipmentList } from "../services/equipmentService";

const MODE_OPTIONS = ["TL", "LTL", "Intermodal", "Flatbed", "Reefer", "Air Freight"];
const STATUS_OPTIONS = ["Active", "Expiring", "Expired"];
const SERVICE_LEVEL_OPTIONS = ["Standard", "Express", "Expedited", "Economy"];
const UNIT_OPTIONS = [
  { value: "per mile", label: "PER MILE" },
  { value: "per cwt", label: "PER CWT" },
  { value: "flat", label: "FLAT" },
  { value: "container", label: "CONTAINER" },
];

/* ── Normalize unit value to match select options ── */
function normalizeUnit(raw) {
  if (!raw) return "per mile";
  const u = raw.toLowerCase().trim();
  if (u.includes("mile")) return "per mile";
  if (u.includes("cwt")) return "per cwt";
  if (u === "flat") return "flat";
  if (u.includes("container")) return "container";
  return "per mile";
}
const FREIGHT_CLASSES = [
  "50", "55", "60", "65", "70", "77.5", "85", "92.5",
  "100", "110", "125", "150", "175", "200", "250", "300",
];

/* ── Normalize helpers (handle both snake_case DB and camelCase) ── */
function getField(r, ...keys) {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== "") return r[k];
  }
  return "";
}

function parseLocation(str) {
  if (!str) return { city: "", state: "", zip: "" };
  let s = str;
  let zip = "";
  const m = s.match(/(\d{5})/);
  if (m) { zip = m[1]; s = s.replace(m[1], "").trim(); }
  const parts = s.split(",");
  return { city: (parts[0] || "").trim(), state: (parts[1] || "").trim().replace(/\s+/g, ""), zip };
}

// CzarLite weight breaks are an LTL tariff concept. Defaulting them
// to 500/9999 on a TL/Flatbed/Intermodal rate caps the lane at LTL
// volumes and silently breaks bulk planning (the matcher would skip
// the carrier on every >9999 lb TL group).
const isLtlMode = (mode) => String(mode || "").toUpperCase() === "LTL";

// Default trailer suggested when MODE flips. Mirrors migration 024
// backfill so a freshly-toggled rate matches what a backfilled row
// would carry. NULL master entry is fine — the planner falls back.
const DEFAULT_EQUIPMENT_BY_MODE = {
  LTL: "LTL",
  TL: "Dry Van 53ft",
};

// Append the expiry date suffix (YYYYMMDD) to a lane. If the lane already
// ends with an 8-digit date suffix that doesn't match the current expiry
// (i.e. the user changed the expiration date), strip it first so we don't
// double-append. Idempotent when the suffix already matches. Mirrors
// RateManagementPage.buildLaneId so modal, table, and DB stay in sync.
function appendExpirySuffix(lane, exp) {
  let base = String(lane || "").trim();
  if (!base) return base;
  const expCompact = String(exp || "").replace(/-/g, "");
  if (!expCompact) return base;
  if (base.endsWith(`-${expCompact}`)) return base;
  // Strip any stale trailing -YYYYMMDD (years 1900-2099) before re-appending.
  base = base.replace(/-(?:19|20)\d{6}$/, "");
  return `${base}-${expCompact}`;
}

function buildInitialForm(rate) {
  if (!rate) return {};
  const oLoc = parseLocation(rate.origin);
  const dLoc = parseLocation(rate.dest);
  const ltl = isLtlMode(rate.mode);
  // Promote the full display lane (base + expiry suffix) into the editable
  // form value so the input shows the same ID the user clicked on in the
  // table. On save we re-append to defend against expiry-date changes.
  const expRaw = getField(rate, "exp", "expires", "expiry_date", "expiryDate");
  return {
    lane: appendExpirySuffix(rate.lane || "", expRaw),
    mode: rate.mode || "TL",
    equipment: rate.equipment || "",
    // Migration 021: controls how this rate is matched to shipments.
    matchType: normalizeMatchType(rate.match_type || rate.matchType),
    origin: rate.origin || "",
    originCity: rate.originCity || oLoc.city,
    originState: rate.originState || oLoc.state,
    // Prefer the structured origin_zip column; fall back to parsing the
    // legacy origin free-text so pre-migration-021 rows still edit cleanly.
    originZip: rate.origin_zip || rate.originZip || oLoc.zip,
    originCountry: rate.origin_country || rate.originCountry || "USA",
    dest: rate.dest || "",
    destCity: rate.destCity || dLoc.city,
    destState: rate.destState || dLoc.state,
    destZip: rate.dest_zip || rate.destZip || dLoc.zip,
    destCountry: rate.dest_country || rate.destCountry || "USA",
    carrier: rate.carrier || "",
    status: rate.status || "Active",
    rate: String(getField(rate, "rate", "rate_per_mile")).replace(/[$]/g, ""),
    unit: normalizeUnit(getField(rate, "unit", "rate_unit")),
    fsc: String(getField(rate, "fsc", "fsc_pct")).replace(/%/g, ""),
    discount: getField(rate, "discount", "discount_pct"),
    discountFlat: getField(rate, "discountFlat", "discount_flat", "discount_amt"),
    eff: getField(rate, "eff", "effective", "effective_date", "effectiveDate"),
    exp: getField(rate, "exp", "expires", "expiry_date", "expiryDate"),
    miles: getField(rate, "miles", "distance") || "",
    transitDays: getField(rate, "transitDays", "transit_days"),
    serviceLevel: getField(rate, "serviceLevel", "service_level"),
    czarlite: !!rate.czarlite,
    czarliteClass: getField(rate, "czarliteClass", "czarlite_class", "freight_class") || "70",
    czarliteMinWt: getField(rate, "czarliteMinWt", "czarlite_min_wt", "czar_min_wt") || (ltl ? 500 : ""),
    czarliteMaxWt: getField(rate, "czarliteMaxWt", "czarlite_max_wt", "czar_max_wt") || (ltl ? 9999 : ""),
  };
}

function buildPayload(form) {
  // Combine city/state/zip into origin/dest strings (kept for legacy
  // display / CSV export — the matcher reads the structured columns).
  const origin = [form.originCity, form.originState?.toUpperCase()].filter(Boolean).join(", ") + (form.originZip ? " " + form.originZip : "");
  const dest = [form.destCity, form.destState?.toUpperCase()].filter(Boolean).join(", ") + (form.destZip ? " " + form.destZip : "");
  // Format rate as "$X.XX" and FSC as "X.X%" to match DB convention
  const rateNum = parseFloat(String(form.rate).replace(/[^0-9.]/g, ""));
  const fscNum = parseFloat(String(form.fsc).replace(/[^0-9.]/g, ""));
  return {
    lane: form.lane,
    mode: form.mode,
    // Migration 024: soft reference to equipment_types.name so the
    // planner can resolve max_weight via the equipment master.
    equipment: form.equipment || null,
    // Migration 021 columns — promoted from the free-text origin/dest
    // so the LTL matcher can compare structured values (see
    // api/services/ltlRateMatcher.js).
    match_type:     normalizeMatchType(form.matchType),
    origin_zip:     form.originZip     || null,
    dest_zip:       form.destZip       || null,
    origin_country: (form.originCountry || "USA").toUpperCase(),
    dest_country:   (form.destCountry   || "USA").toUpperCase(),
    origin: origin || form.origin,
    dest: dest || form.dest,
    carrier: form.carrier,
    status: form.status,
    rate: isNaN(rateNum) ? form.rate : `$${rateNum.toFixed(2)}`,
    unit: form.unit,
    fsc: isNaN(fscNum) ? form.fsc : `${fscNum.toFixed(1)}%`,
    discount: form.discount ? parseFloat(form.discount) : null,
    discount_flat: form.discountFlat ? parseFloat(form.discountFlat) : null,
    eff: form.eff || null,
    exp: form.exp || null,
    miles: form.miles ? Number(form.miles) : null,
    transit_days: form.transitDays ? Number(form.transitDays) : null,
    service_level: form.serviceLevel || null,
    czarlite: form.czarlite,
    czarlite_class: form.czarliteClass ? Number(form.czarliteClass) : null,
    // CzarLite weight breaks only apply to LTL rates (see rateMatcher.js).
    // Persist null on non-LTL so the matcher never skips a TL carrier on
    // a stray LTL-tariff weight cap.
    czarlite_min_wt: isLtlMode(form.mode) && form.czarliteMinWt ? Number(form.czarliteMinWt) : null,
    czarlite_max_wt: isLtlMode(form.mode) && form.czarliteMaxWt ? Number(form.czarliteMaxWt) : null,
  };
}

export default function EditRateModal({ rate, onClose, onSave, isNew, carriers = [], equipmentTypes = [], existingLanes = [] }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  // Resolve equipment list once: DB rows when present, seed catalog
  // otherwise. Then strip Inactive entries for the dropdown.
  const activeEquipment = useMemo(
    () => getEquipmentList(equipmentTypes).filter((eq) => (eq.status || "Active") === "Active"),
    [equipmentTypes]
  );

  useEffect(() => {
    if (rate) setForm(buildInitialForm(rate));
  }, [rate]);


  if (!rate) return null;

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    // Auto-generate lane ID if empty. The trailing date code is the
    // expiry date (YYYYMMDD) so the auto-gen value matches the suffix
    // we'll re-append below — otherwise we'd end up with two date
    // chunks on the same lane.
    if (!form.lane && form.carrier && form.originCity && form.destCity) {
      const carrierCode = (form.carrier || "").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 4);
      const oCode = (form.originCity || "").slice(0, 3).toUpperCase();
      const dCode = (form.destCity || "").slice(0, 3).toUpperCase();
      const modeCode = (form.mode || "TL").toUpperCase();
      const svcCode = (form.serviceLevel || "STD").slice(0, 3).toUpperCase();
      const dateCode = String(form.exp || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
      const generated = `${carrierCode}-${oCode}-${dCode}-${modeCode}-${svcCode}-${dateCode}`;
      setField("lane", generated);
      form.lane = generated;
    }
    if (!form.lane) {
      alert("Lane ID is required.");
      return;
    }
    // Always persist the lane with the expiry suffix so the DB matches
    // the table and modal display. appendExpirySuffix is a no-op when
    // the suffix is already present (e.g. user typed it manually).
    const finalLane = appendExpirySuffix(form.lane, form.exp);
    if (finalLane !== form.lane) {
      setField("lane", finalLane);
      form.lane = finalLane;
    }
    if (isNew && existingLanes.includes(finalLane)) {
      alert(`Duplicate Lane ID: "${finalLane}" already exists. Please use a unique Lane ID.`);
      return;
    }
    if (!(form.originCity || form.origin) || !(form.destCity || form.dest) || !form.carrier) {
      alert("Origin, Destination, and Carrier are required.");
      return;
    }
    setBusy(true);
    try {
      const payload = buildPayload({ ...form, lane: finalLane });
      await onSave(rate.id, payload, isNew);
    } finally {
      setBusy(false);
    }
  }

  // Title uses the same suffix-appending helper as buildInitialForm/save,
  // so the title stays in sync if the user changes the expiry date in the
  // form before saving. No-op when form.lane already carries the suffix.
  const displayLane = appendExpirySuffix(form.lane, form.exp);
  const title = isNew ? "ADD RATE" : `EDIT RATE \u2014 ${displayLane}`;

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ alignItems: "flex-start", gap: 12 }}>
          {/* Long lane IDs (e.g. AVRT-CHI-ATL-LTL-CZ-STD) were getting clipped
              by the close button. Allow the title to wrap and break on
              hyphens, and pin the close button so it never shrinks away. */}
          <h3 style={{ flex: 1, minWidth: 0, margin: 0, wordBreak: "break-word", overflowWrap: "anywhere", lineHeight: 1.3 }}>
            {title}
          </h3>
          <button
            className="modal-close"
            style={{ flexShrink: 0 }}
            onClick={() => !busy && onClose()}
          >
            ✕
          </button>
        </div>
        <div className="modal-body">

          {/* Lane ID + Mode */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">LANE ID *</label>
              <input value={form.lane || ""} onChange={(e) => setField("lane", e.target.value)} placeholder="Auto-generated if empty" />
            </div>
            <div className="form-group">
              <label className="form-label">MODE *</label>
              <select value={form.mode || "TL"} onChange={(e) => {
                const next = e.target.value;
                setField("mode", next);
                if (isLtlMode(next)) {
                  setField("czarlite", true);
                  // Restore LTL CzarLite weight-break defaults if cleared.
                  if (!form.czarliteMinWt) setField("czarliteMinWt", 500);
                  if (!form.czarliteMaxWt) setField("czarliteMaxWt", 9999);
                } else {
                  // Clear LTL-tariff weight breaks on TL/Flatbed/etc. so
                  // the matcher doesn't accidentally cap the lane.
                  setField("czarliteMinWt", "");
                  setField("czarliteMaxWt", "");
                }
                // Suggest a default equipment for the new mode if the
                // user hasn't already pinned one. Mirrors migration 024
                // backfill so freshly-toggled rates match backfilled rows.
                const suggested = DEFAULT_EQUIPMENT_BY_MODE[String(next).toUpperCase()];
                if (suggested && !form.equipment) setField("equipment", suggested);
              }}>
                {MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Equipment — soft reference to equipment_types.name. Drives
              the planner's max_weight lookup when binning shipment groups. */}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">EQUIPMENT</label>
            <select
              value={form.equipment || ""}
              onChange={(e) => setField("equipment", e.target.value)}
            >
              <option value="">— Select Equipment —</option>
              {activeEquipment.map((eq) => (
                <option key={eq.id || eq.name} value={eq.name}>
                  {eq.name}{eq.max_weight ? ` (${Number(eq.max_weight).toLocaleString()} lb max)` : ""}
                </option>
              ))}
              {/* Preserve a backfilled / legacy value not present in master */}
              {form.equipment &&
                !activeEquipment.some((eq) => eq.name === form.equipment) && (
                <option value={form.equipment}>{form.equipment}</option>
              )}
            </select>
            <span style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
              Trailer this rate was negotiated against — planner reads max_weight from the equipment master.
            </span>
          </div>

          {/* Match Type — controls how this rate is paired with shipments */}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label">MATCH TYPE *</label>
            <select
              value={form.matchType || MATCH_TYPE_VALUES.CITY}
              onChange={(e) => setField("matchType", e.target.value)}
            >
              {MATCH_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label.toUpperCase()}</option>
              ))}
            </select>
            <span style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
              {(MATCH_TYPE_OPTIONS.find((o) => o.value === (form.matchType || MATCH_TYPE_VALUES.CITY)) || {}).hint}
            </span>
          </div>

          {/* Origin */}
          <div style={{ marginBottom: 12 }}>
            <label className="form-label">ORIGIN *</label>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8 }}>
              <input value={form.originCity || ""} onChange={(e) => setField("originCity", e.target.value)} placeholder="City (e.g. Chicago)" />
              <input value={form.originState || ""} onChange={(e) => setField("originState", e.target.value)} placeholder="ST" maxLength={2} style={{ textTransform: "uppercase" }} />
              <input value={form.originZip || ""} onChange={(e) => setField("originZip", e.target.value)} placeholder="ZIP (opt)" maxLength={5} />
              <input value={form.originCountry || ""} onChange={(e) => setField("originCountry", e.target.value)} placeholder="USA" maxLength={3} style={{ textTransform: "uppercase" }} />
            </div>
          </div>
          {/* Destination */}
          <div style={{ marginBottom: 12 }}>
            <label className="form-label">DESTINATION *</label>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 8 }}>
              <input value={form.destCity || ""} onChange={(e) => setField("destCity", e.target.value)} placeholder="City (e.g. Dallas)" />
              <input value={form.destState || ""} onChange={(e) => setField("destState", e.target.value)} placeholder="ST" maxLength={2} style={{ textTransform: "uppercase" }} />
              <input value={form.destZip || ""} onChange={(e) => setField("destZip", e.target.value)} placeholder="ZIP (opt)" maxLength={5} />
              <input value={form.destCountry || ""} onChange={(e) => setField("destCountry", e.target.value)} placeholder="USA" maxLength={3} style={{ textTransform: "uppercase" }} />
            </div>
          </div>

          {/* Carrier + Status */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">CARRIER *</label>
              {carriers.length > 0 ? (<>
                <select value={form.carrier || ""} onChange={(e) => setField("carrier", e.target.value)}>
                  <option value="">— Select Carrier —</option>
                  {carriers.map((c) => {
                    const name = c.name || c;
                    return <option key={name} value={name}>{name}</option>;
                  })}
                  {/* If current carrier not in list, show it as an option */}
                  {form.carrier && !carriers.some((c) => (c.name || c) === form.carrier) && (
                    <option value={form.carrier}>{form.carrier}</option>
                  )}
                </select>
              </>) : (
                <input value={form.carrier || ""} onChange={(e) => setField("carrier", e.target.value)} placeholder="e.g. Werner Enterprises" />
              )}
            </div>
            <div className="form-group">
              <label className="form-label">STATUS</label>
              <select value={form.status || "Active"} onChange={(e) => setField("status", e.target.value)}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          {/* Rate + Rate Unit + FSC */}
          <div className="form-row-3">
            <div className="form-group">
              <label className="form-label">RATE *</label>
              <input value={form.rate || ""} onChange={(e) => setField("rate", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">RATE UNIT</label>
              <select value={form.unit || "per mile"} onChange={(e) => setField("unit", e.target.value)}>
                {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">FSC %</label>
              <input value={form.fsc || ""} onChange={(e) => setField("fsc", e.target.value)} />
            </div>
          </div>


          {/* Effective + Expiration */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">EFFECTIVE DATE</label>
              <input type="date" value={form.eff || ""} onChange={(e) => setField("eff", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">EXPIRATION DATE</label>
              <input type="date" value={form.exp || ""} onChange={(e) => setField("exp", e.target.value)} />
            </div>
          </div>

          {/* Service Level + Transit Days + Miles */}
          <div className="form-row-3">
            <div className="form-group">
              <label className="form-label">⭐ SERVICE LEVEL</label>
              <select value={form.serviceLevel || ""} onChange={(e) => setField("serviceLevel", e.target.value)}>
                <option value="">— Select —</option>
                {SERVICE_LEVEL_OPTIONS.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">📅 TRANSIT DAYS</label>
              <input type="number" min="1" max="30" value={form.transitDays || ""} onChange={(e) => setField("transitDays", e.target.value)} />
              <span style={{ fontSize: 9, color: "var(--text3)", marginTop: 2 }}>BUSINESS DAYS, CARRIER-COMMITTED</span>
            </div>
            <div className="form-group">
              <label className="form-label">📏 DISTANCE (MILES)</label>
              <input
                type="number"
                min="1"
                max="99999"
                placeholder="Manual or from PC*MILER"
                value={form.miles || ""}
                onChange={(e) => setField("miles", e.target.value ? Number(e.target.value) : "")}
              />
              <span style={{ fontSize: 9, color: "var(--text3)", marginTop: 2 }}>EDITABLE — PC*MILER FILLS DURING RATING</span>
            </div>
          </div>

          {/* CzarLite / LTL Rate Fields — always visible */}
          <div style={{
            marginTop: 16, padding: "14px 16px", borderRadius: 12,
            background: "rgba(99,102,241,.04)",
            border: "1.5px solid rgba(99,102,241,.15)",
          }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10 }}>📊 LTL / CZARLITE RATE CONFIGURATION</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" style={{ color: "#059669" }}>💲 DISCOUNT % OFF CZARLITE BASE</label>
                <input type="number" min="0" max="50" step="0.5" value={form.discount || ""} onChange={(e) => setField("discount", e.target.value)} placeholder="e.g. 10" />
                <span style={{ fontSize: 9, color: "var(--text3)", marginTop: 2 }}>% REDUCTION OFF CZARLITE BASE RATE BEFORE FSC</span>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: "#059669" }}>💲 DISCOUNT $ FLAT OFF BASE</label>
                <input type="number" min="0" value={form.discountFlat || ""} onChange={(e) => setField("discountFlat", e.target.value)} placeholder="e.g. 50" />
                <span style={{ fontSize: 9, color: "var(--text3)", marginTop: 2 }}>FIXED $ DEDUCTION OFF BASE (APPLIED BEFORE FSC)</span>
              </div>
            </div>
            <div className="form-row-3" style={{ marginTop: 10 }}>
              <div className="form-group">
                <label className="form-label">NMFC FREIGHT CLASS</label>
                <select value={form.czarliteClass || "70"} onChange={(e) => setField("czarliteClass", e.target.value)}>
                  {FREIGHT_CLASSES.map((c) => <option key={c} value={c}>CLASS {c}</option>)}
                </select>
              </div>
              {isLtlMode(form.mode) ? (
                <>
                  <div className="form-group">
                    <label className="form-label">MIN WEIGHT (LBS)</label>
                    <input type="number" value={form.czarliteMinWt || 500} onChange={(e) => setField("czarliteMinWt", e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">MAX WEIGHT (LBS)</label>
                    <input type="number" value={form.czarliteMaxWt || 9999} onChange={(e) => setField("czarliteMaxWt", e.target.value)} />
                  </div>
                </>
              ) : (
                <div className="form-group" style={{ gridColumn: "span 2", color: "var(--text3)", fontSize: 11 }}>
                  Weight breaks apply to LTL rates only — switch MODE to LTL to configure.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-green" onClick={handleSave} disabled={busy}>
            {busy ? "Saving..." : "💾 Save Rate"}
          </button>
        </div>
      </div>
    </div>
  );
}
