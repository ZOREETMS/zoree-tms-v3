// ═══════════════════════════════════════════════════════════════════
// Tender Accept Modal — frontend/src/components/shipments/TenderAcceptModal.jsx
//
// Unified two-tab modal that replaces the inline "Accept Tender" form
// previously buried in ShipmentsPage.jsx. Same shipment record is now
// edited by both actors:
//
//   ─ Carrier Response tab ─  driver, phone, truck, PRO, pickup, ETA,
//                             notes-to-shipper. Read-only mirror when
//                             the carrier has already responded via
//                             the carrier portal; editable fallback so
//                             a planner can record an off-portal
//                             response on the carrier's behalf.
//
//   ─ Internal Plan tab ─     service level, carrier ref / BOL,
//                             delivery date, dock door, loading
//                             window, seal number, internal notes.
//                             Always editable — these are shipper-
//                             owned operational fields.
//
// Header title adapts to which actor's gap we're filling:
//   • Carrier already accepted → "Confirm Dock Plan"
//   • Carrier hasn't responded → "Accept Tender on Behalf"
//
// State is fully local; the parent receives the merged payload via
// onConfirm and is responsible for the DB patch. This keeps the
// component testable in isolation and lets ShipmentsPage stay focused
// on orchestration (DB patch + propagateTenderAcceptance + toasts).
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import { parseCarrierResponse, hasCarrierAccepted } from "../../services/tenderService";

const SERVICE_LEVELS = ["Standard", "Expedited", "Economy", "White Glove", "Time-Critical"];

const TAB_CARRIER = "carrier";
const TAB_INTERNAL = "internal";

export default function TenderAcceptModal({ shipment, onClose, onConfirm, busy = false }) {
  const carrierResponded = useMemo(() => hasCarrierAccepted(shipment), [shipment]);
  const existingResponse = useMemo(() => parseCarrierResponse(shipment?.notes) || {}, [shipment]);

  // Default tab: Internal Plan when carrier already responded (planner
  // just needs to fill their side); Carrier Response when not (planner
  // is acting on behalf and that's the larger gap).
  const [tab, setTab] = useState(carrierResponded ? TAB_INTERNAL : TAB_CARRIER);

  // ── Carrier-side fields ──
  const [driver, setDriver]           = useState("");
  const [phone, setPhone]             = useState("");
  const [truck, setTruck]             = useState("");
  const [pro, setPro]                 = useState("");
  const [pickup, setPickup]           = useState("");
  const [pickupEta, setPickupEta]     = useState("");
  const [carrierNotes, setCarrierNotes] = useState("");

  // ── Planner-side fields ──
  const [service, setService]         = useState("");
  const [bol, setBol]                 = useState("");
  const [delivery, setDelivery]       = useState("");
  const [dock, setDock]               = useState("");
  const [dockLoadStart, setLoadStart] = useState("");
  const [dockLoadEnd, setLoadEnd]     = useState("");
  const [seal, setSeal]               = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  useEffect(() => {
    if (!shipment) return;
    const today = new Date().toISOString().slice(0, 10);

    // Carrier-side: prefer the carrier's submitted response, fall back
    // to whatever's already on the shipment row.
    setDriver(existingResponse.driver || "");
    setPhone(existingResponse.phone || "");
    setTruck(existingResponse.truck || "");
    setPro(existingResponse.proNumber || shipment.pro_number || "");
    setPickup(existingResponse.carrierPickupDate || shipment.pickup_date || shipment.pickup || today);
    setPickupEta(existingResponse.pickupEta || "");
    setCarrierNotes(existingResponse.notes || "");

    // Planner-side: pre-fill from existing CP_RESPONSE first (we may
    // have saved planner data on a previous open), then shipment row,
    // then blank.
    setService(existingResponse.serviceLevel || shipment.service_level || "");
    setBol(existingResponse.bolNumber || shipment.bol_number || "");
    setDelivery(existingResponse.deliveryDate || shipment.delivery_date || shipment.delivery || "");
    setDock(existingResponse.dockDoor || shipment.dock_door || shipment.dock_assigned || "");
    setLoadStart(existingResponse.dockLoadStart || timeOf(shipment.loading_start || shipment.dock_load_start || shipment.dock_time));
    setLoadEnd(existingResponse.dockLoadEnd || timeOf(shipment.loading_end || shipment.dock_load_end));
    setSeal(existingResponse.sealNumber || shipment.seal_number || "");
    setInternalNotes("");
  }, [shipment, existingResponse]);

  if (!shipment) return null;

  const submitDisabled = busy || !pickup;

  function handleConfirm() {
    if (submitDisabled) return;
    onConfirm({
      // Carrier-side payload — planner edits go through too if the
      // carrier hasn't responded, otherwise these are read-only and
      // come from existingResponse via the inputs.
      driver, phone, truck,
      proNumber: pro,
      carrierPickupDate: pickup,
      pickupEta,
      carrierNotes,
      // Planner-side payload — always editable.
      serviceLevel: service,
      bolNumber: bol,
      deliveryDate: delivery,
      dockDoor: dock,
      dockLoadStart, dockLoadEnd,
      sealNumber: seal,
      internalNotes,
    });
  }

  const headerTitle = carrierResponded ? "Confirm Dock Plan" : "Accept Tender on Behalf";
  const headerSubtitle = carrierResponded
    ? `Carrier responded · ${shipment.carrier || "—"}`
    : `${shipment.carrier || "—"} · No carrier response yet`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        style={{
          background: "var(--bg)", borderRadius: 16, width: 560, maxWidth: "95vw",
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 24px 60px rgba(0,0,0,.4)",
          border: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg,#0f4c35,#16a34a)",
          padding: "20px 24px", borderRadius: "16px 16px 0 0",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>✅ {headerTitle}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.85)", marginTop: 3 }}>
              {shipment.id} · {headerSubtitle}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,.15)", border: "none", color: "#fff",
              width: 30, height: 30, borderRadius: "50%", fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >✕</button>
        </div>

        {/* Shipment summary */}
        <div style={{
          padding: "14px 24px", background: "var(--bg2)",
          borderBottom: "1px solid var(--border)",
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10,
        }}>
          <Cell label="Origin"      value={shipment.origin} />
          <Cell label="Destination" value={shipment.dest} />
          <Cell label="Weight"      value={`${(shipment.weight || 0).toLocaleString()} lbs`} />
        </div>

        {/* Banner: clarify what each tab is for */}
        {carrierResponded ? (
          <Banner color="#16a34a" bg="rgba(22,163,74,.08)">
            ✓ Carrier already submitted driver, PRO, and pickup details.
            Review below and add your internal dock plan — both will be
            saved together.
          </Banner>
        ) : (
          <Banner color="#3b82f6" bg="rgba(59,130,246,.08)">
            💡 No carrier response yet. You can record the carrier's
            details on their behalf (e.g. response received by phone)
            and your internal dock plan, or just fill in the dock plan.
          </Banner>
        )}

        {/* Tabs */}
        <div style={{
          display: "flex", borderBottom: "1px solid var(--border)",
          background: "var(--bg2)",
        }}>
          <Tab
            active={tab === TAB_CARRIER}
            onClick={() => setTab(TAB_CARRIER)}
            label={`📦 Carrier Response${carrierResponded ? " (submitted)" : ""}`}
          />
          <Tab
            active={tab === TAB_INTERNAL}
            onClick={() => setTab(TAB_INTERNAL)}
            label="🏭 Internal Plan"
          />
        </div>

        {/* Form body */}
        <div style={{ padding: "20px 24px" }}>
          {tab === TAB_CARRIER && (
            <CarrierTab
              readOnly={carrierResponded}
              driver={driver} setDriver={setDriver}
              phone={phone} setPhone={setPhone}
              truck={truck} setTruck={setTruck}
              pro={pro} setPro={setPro}
              pickup={pickup} setPickup={setPickup}
              pickupEta={pickupEta} setPickupEta={setPickupEta}
              carrierNotes={carrierNotes} setCarrierNotes={setCarrierNotes}
              respondedAt={existingResponse.respondedAt}
            />
          )}

          {tab === TAB_INTERNAL && (
            <InternalTab
              service={service} setService={setService}
              bol={bol} setBol={setBol}
              delivery={delivery} setDelivery={setDelivery}
              dock={dock} setDock={setDock}
              dockLoadStart={dockLoadStart} setLoadStart={setLoadStart}
              dockLoadEnd={dockLoadEnd} setLoadEnd={setLoadEnd}
              seal={seal} setSeal={setSeal}
              internalNotes={internalNotes} setInternalNotes={setInternalNotes}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 24px", borderTop: "1px solid var(--border)",
          display: "flex", gap: 10, justifyContent: "flex-end",
          background: "var(--bg2)", borderRadius: "0 0 16px 16px",
        }}>
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "10px 20px", background: "var(--bg)",
              border: "1.5px solid var(--border)", borderRadius: 8,
              fontSize: 13, fontWeight: 600, color: "var(--text2)",
              cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit",
            }}
          >Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={submitDisabled}
            style={{
              padding: "10px 24px", background: "#16a34a", border: "none",
              borderRadius: 8, fontSize: 13, fontWeight: 700, color: "#fff",
              cursor: submitDisabled ? "not-allowed" : "pointer",
              fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
              opacity: submitDisabled ? 0.55 : 1,
            }}
          >
            ✅ {carrierResponded ? "Confirm & Save Plan" : "Accept Tender"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Tab({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "12px 14px", background: active ? "var(--bg)" : "transparent",
        border: "none", borderBottom: active ? "2px solid #16a34a" : "2px solid transparent",
        fontSize: 12, fontWeight: 700, color: active ? "#16a34a" : "var(--text2)",
        cursor: "pointer", fontFamily: "inherit", letterSpacing: 0.3,
      }}
    >
      {label}
    </button>
  );
}

function Banner({ color, bg, children }) {
  return (
    <div style={{
      padding: "10px 24px", background: bg, borderBottom: "1px solid var(--border)",
      fontSize: 11, color, fontWeight: 600, lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{value || "—"}</div>
    </div>
  );
}

function CarrierTab({
  readOnly, driver, setDriver, phone, setPhone, truck, setTruck,
  pro, setPro, pickup, setPickup, pickupEta, setPickupEta,
  carrierNotes, setCarrierNotes, respondedAt,
}) {
  return (
    <>
      {readOnly && respondedAt && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 14 }}>
          Submitted {respondedAt}
        </div>
      )}
      <Row>
        <Field label="Driver Name" value={driver} onChange={setDriver} placeholder="Assigned driver" readOnly={readOnly} />
        <Field label="Driver Phone" value={phone} onChange={setPhone} placeholder="(555) 000-0000" readOnly={readOnly} />
      </Row>
      <Row>
        <Field label="Truck / Unit #" value={truck} onChange={setTruck} placeholder="Truck or trailer number" readOnly={readOnly} />
        <Field label="PRO Number" value={pro} onChange={setPro} placeholder="e.g. PRO-123456" mono />
      </Row>
      <Row>
        <Field label="Carrier Pickup Date *" type="date" value={pickup} onChange={setPickup} />
        <Field label="Estimated Pickup (ETA)" type="datetime-local" value={pickupEta} onChange={setPickupEta} readOnly={readOnly} />
      </Row>
      <Field
        label="Notes from Carrier"
        value={carrierNotes}
        onChange={setCarrierNotes}
        placeholder="Carrier-supplied notes / special instructions"
        readOnly={readOnly}
        textarea
      />
    </>
  );
}

function InternalTab({
  service, setService, bol, setBol, delivery, setDelivery,
  dock, setDock, dockLoadStart, setLoadStart, dockLoadEnd, setLoadEnd,
  seal, setSeal, internalNotes, setInternalNotes,
}) {
  return (
    <>
      <Row>
        <SelectField label="Service Level" value={service} onChange={setService}>
          <option value="">— Select —</option>
          {SERVICE_LEVELS.map((s) => <option key={s} value={s}>{s}</option>)}
        </SelectField>
        <Field label="Carrier Ref / BOL" value={bol} onChange={setBol} placeholder="e.g. BOL-2026-001" mono />
      </Row>
      <Row>
        <Field label="Delivery Date" type="date" value={delivery} onChange={setDelivery} />
        <Field label="Dock Assigned" value={dock} onChange={setDock} placeholder="e.g. Dock 4A" />
      </Row>
      <Row>
        <Field label="Dock Loading Start" type="time" value={dockLoadStart} onChange={setLoadStart} />
        <Field label="Dock Loading End"   type="time" value={dockLoadEnd}   onChange={setLoadEnd} />
      </Row>
      <Field label="Seal Number" value={seal} onChange={setSeal} placeholder="e.g. SEAL-998877" mono />
      <Field label="Internal Notes" value={internalNotes} onChange={setInternalNotes} placeholder="Notes for the loading dock / internal team" textarea />
    </>
  );
}

function Row({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", mono, textarea, readOnly }) {
  const baseInput = {
    width: "100%", padding: "9px 12px",
    border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13,
    background: readOnly ? "var(--bg3)" : "var(--bg2)",
    color: readOnly ? "var(--text2)" : "var(--text)",
    fontFamily: mono ? "monospace" : "inherit", boxSizing: "border-box",
  };
  return (
    <div style={{ marginBottom: textarea ? 0 : undefined }}>
      <Label>{label}</Label>
      {textarea ? (
        <textarea
          rows={2}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={!!readOnly}
          style={{ ...baseInput, resize: "none" }}
        />
      ) : (
        <input
          type={type}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={!!readOnly}
          style={baseInput}
        />
      )}
    </div>
  );
}

function SelectField({ label, value, onChange, children }) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", padding: "9px 12px",
          border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13,
          background: "var(--bg2)", color: "var(--text)", boxSizing: "border-box",
        }}
      >
        {children}
      </select>
    </div>
  );
}

function Label({ children }) {
  return (
    <label style={{
      fontSize: 11, fontWeight: 700, color: "var(--text2)",
      textTransform: "uppercase", letterSpacing: 0.5,
      display: "block", marginBottom: 5,
    }}>
      {children}
    </label>
  );
}

/** Pull "HH:mm" off a stored "YYYY-MM-DD HH:mm" timestamp so a
 *  <input type="time"> can render it. Returns "" if no time present. */
function timeOf(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}
