import { useState, useEffect } from "react";

const MODE_OPTIONS = ["TL", "LTL", "Intermodal", "Flatbed", "Reefer", "Air Freight"];
const STATUS_OPTIONS = ["Active", "Expiring", "Expired"];
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

/* ── Lane distance lookup ── */
const LANE_DISTANCES = {
  "CHICAGO, IL|DALLAS, TX": 921, "COLUMBUS, OH|ATLANTA, GA": 640,
  "DALLAS, TX|ATLANTA, GA": 781, "HOUSTON, TX|ATLANTA, GA": 795,
  "ATLANTA, GA|NEW YORK, NY": 882, "DALLAS, TX|PHOENIX, AZ": 1072,
  "MEMPHIS, TN|DENVER, CO": 1069, "CHICAGO, IL|NEW YORK, NY": 790,
  "LOS ANGELES, CA|SEATTLE, WA": 1135, "MOUNTAIN VIEW, CA|SEATTLE, WA": 1300,
  "CHARLOTTE, NC|HOUSTON, TX": 1290, "SAN JOSE, CA|COLUMBUS, OH": 2390,
  "BOSTON, MA|PHOENIX, AZ": 2665, "MIAMI, FL|DENVER, CO": 2107,
  "PHOENIX, AZ|BOSTON, MA": 2665, "DENVER, CO|MIAMI, FL": 2107,
  "CHICAGO, IL|ATLANTA, GA": 720, "COLLEGE PARK, GA|DALLAS, TX": 781,
  "COLLEGE PARK, GA|CHICAGO, IL": 720, "COLLEGE PARK, GA|NEW YORK, NY": 882,
  "ATLANTA, GA|LOS ANGELES, CA": 2175, "ATLANTA, GA|DALLAS, TX": 781,
};
function getDist(o, d) {
  return LANE_DISTANCES[`${(o || "").toUpperCase()}|${(d || "").toUpperCase()}`] || null;
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

function buildInitialForm(rate) {
  if (!rate) return {};
  return {
    lane: rate.lane || "",
    mode: rate.mode || "TL",
    origin: rate.origin || "",
    dest: rate.dest || "",
    carrier: rate.carrier || "",
    status: rate.status || "Active",
    rate: String(getField(rate, "rate", "rate_per_mile")).replace(/[$]/g, ""),
    unit: normalizeUnit(getField(rate, "unit", "rate_unit")),
    fsc: String(getField(rate, "fsc", "fsc_pct")).replace(/%/g, ""),
    discount: getField(rate, "discount", "discount_pct"),
    discountFlat: getField(rate, "discountFlat", "discount_flat", "discount_amt"),
    eff: getField(rate, "eff", "effective", "effective_date", "effectiveDate"),
    exp: getField(rate, "exp", "expires", "expiry_date", "expiryDate"),
    transitDays: getField(rate, "transitDays", "transit_days"),
    serviceLevel: getField(rate, "serviceLevel", "service_level"),
    czarlite: !!rate.czarlite,
    czarliteClass: getField(rate, "czarliteClass", "czarlite_class", "freight_class") || "70",
    czarliteMinWt: getField(rate, "czarliteMinWt", "czarlite_min_wt", "czar_min_wt") || 500,
    czarliteMaxWt: getField(rate, "czarliteMaxWt", "czarlite_max_wt", "czar_max_wt") || 9999,
  };
}

function buildPayload(form) {
  // Format rate as "$X.XX" and FSC as "X.X%" to match DB convention
  const rateNum = parseFloat(String(form.rate).replace(/[^0-9.]/g, ""));
  const fscNum = parseFloat(String(form.fsc).replace(/[^0-9.]/g, ""));
  return {
    lane: form.lane,
    mode: form.mode,
    origin: form.origin,
    dest: form.dest,
    carrier: form.carrier,
    status: form.status,
    rate: isNaN(rateNum) ? form.rate : `$${rateNum.toFixed(2)}`,
    unit: form.unit,
    fsc: isNaN(fscNum) ? form.fsc : `${fscNum.toFixed(1)}%`,
    discount: form.discount ? parseFloat(form.discount) : null,
    discount_flat: form.discountFlat ? parseFloat(form.discountFlat) : null,
    eff: form.eff || null,
    exp: form.exp || null,
    transit_days: form.transitDays ? Number(form.transitDays) : null,
    service_level: form.serviceLevel || null,
    czarlite: form.czarlite,
    czarlite_class: form.czarlite ? Number(form.czarliteClass) : null,
    czarlite_min_wt: form.czarlite ? Number(form.czarliteMinWt) : null,
    czarlite_max_wt: form.czarlite ? Number(form.czarliteMaxWt) : null,
  };
}

export default function EditRateModal({ rate, onClose, onSave, isNew }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (rate) setForm(buildInitialForm(rate));
  }, [rate]);

  if (!rate) return null;

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.lane || !form.origin || !form.dest || !form.carrier) {
      alert("Lane, Origin, Destination, and Carrier are required.");
      return;
    }
    setBusy(true);
    try {
      await onSave(rate.id, buildPayload(form), isNew);
    } finally {
      setBusy(false);
    }
  }

  const title = isNew ? "ADD RATE" : `EDIT RATE \u2014 ${form.lane || ""}`;

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={() => !busy && onClose()}>✕</button>
        </div>
        <div className="modal-body">

          {/* Lane ID + Mode */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">LANE ID *</label>
              <input value={form.lane || ""} onChange={(e) => setField("lane", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">MODE *</label>
              <select value={form.mode || "TL"} onChange={(e) => setField("mode", e.target.value)}>
                {MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Origin + Destination */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">ORIGIN (CITY, ST) *</label>
              <input value={form.origin || ""} onChange={(e) => setField("origin", e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">DESTINATION (CITY, ST) *</label>
              <input value={form.dest || ""} onChange={(e) => setField("dest", e.target.value)} />
            </div>
          </div>

          {/* Carrier + Status */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">CARRIER *</label>
              <input value={form.carrier || ""} onChange={(e) => setField("carrier", e.target.value)} />
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

          {/* Transit Days + Miles */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">📅 TRANSIT DAYS</label>
              <input type="number" min="1" max="30" value={form.transitDays || ""} onChange={(e) => setField("transitDays", e.target.value)} />
              <span style={{ fontSize: 9, color: "var(--text3)", marginTop: 2 }}>BUSINESS DAYS, CARRIER-COMMITTED</span>
            </div>
            <div className="form-group">
              <label className="form-label">📏 DISTANCE (MILES)</label>
              {(() => {
                const miles = getDist(form.origin, form.dest);
                return (
                  <>
                    <input
                      type="text"
                      value={miles ? `${miles.toLocaleString()} mi` : "—"}
                      readOnly
                      style={{ background: "var(--bg2)", color: miles ? "var(--text)" : "var(--text3)", cursor: "default" }}
                    />
                    {!miles && <span style={{ fontSize: 9, color: "#b45309", marginTop: 2 }}>NO DISTANCE DATA FOR THIS LANE</span>}
                  </>
                );
              })()}
            </div>
          </div>

          {/* CzarLite Toggle */}
          <div style={{
            marginTop: 16, padding: "14px 16px", borderRadius: 12,
            background: form.czarlite ? "rgba(245,158,11,.06)" : "var(--bg2)",
            border: `1.5px solid ${form.czarlite ? "rgba(245,158,11,.3)" : "var(--border)"}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12 }}>⚠️ CZARLITE RATE</div>
                <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                  MARK THIS RATE AS CZARLITE-BASED — PLANNING ENGINE WILL FETCH LIVE TARIFF RATES AT BOOKING TIME
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: form.czarlite ? "#059669" : "var(--text3)" }}>
                  {form.czarlite ? "ON" : "OFF"}
                </span>
                <div
                  onClick={() => setField("czarlite", !form.czarlite)}
                  style={{
                    width: 44, height: 24, borderRadius: 12, cursor: "pointer",
                    background: form.czarlite ? "#059669" : "#d1d5db",
                    position: "relative", transition: "background .2s",
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: "50%", background: "#fff",
                    position: "absolute", top: 3,
                    left: form.czarlite ? 23 : 3,
                    transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                  }} />
                </div>
              </label>
            </div>

            {/* CzarLite sub-fields */}
            {form.czarlite && (
              <>
              <div className="form-row" style={{ marginTop: 14 }}>
                <div className="form-group">
                  <label className="form-label" style={{ color: "#059669" }}>💲 DISCOUNT % OFF CZARLITE BASE</label>
                  <input type="number" min="0" max="50" step="0.5" value={form.discount || ""} onChange={(e) => setField("discount", e.target.value)} placeholder="e.g. 10" />
                  <span style={{ fontSize: 9, color: "var(--text3)", marginTop: 2 }}>APPLIED AS % REDUCTION OFF CZARLITE BASE RATE BEFORE FSC</span>
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ color: "#059669" }}>💲 DISCOUNT $ FLAT OFF CZARLITE BASE</label>
                  <input type="number" min="0" value={form.discountFlat || ""} onChange={(e) => setField("discountFlat", e.target.value)} placeholder="e.g. 50" />
                  <span style={{ fontSize: 9, color: "var(--text3)", marginTop: 2 }}>FIXED $ DEDUCTION OFF CZARLITE BASE (APPLIED BEFORE FSC)</span>
                </div>
              </div>
              <div className="form-row-3" style={{ marginTop: 10 }}>
                <div className="form-group">
                  <label className="form-label">NMFC FREIGHT CLASS</label>
                  <select value={form.czarliteClass || "70"} onChange={(e) => setField("czarliteClass", e.target.value)}>
                    {FREIGHT_CLASSES.map((c) => <option key={c} value={c}>CLASS {c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">MIN WEIGHT (LBS)</label>
                  <input type="number" value={form.czarliteMinWt || 500} onChange={(e) => setField("czarliteMinWt", e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">MAX WEIGHT (LBS)</label>
                  <input type="number" value={form.czarliteMaxWt || 9999} onChange={(e) => setField("czarliteMaxWt", e.target.value)} />
                </div>
              </div>
              </>
            )}
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
