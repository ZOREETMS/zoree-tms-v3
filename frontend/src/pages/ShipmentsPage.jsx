import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from "react-leaflet";
import { DbApi, TenderApi, OrdersApi, BulkPlanApi } from "../lib/api";
import { sendTenderEmailIfAvailable, gatherOrderDetails, withMergedTenderNotes } from "../services/tenderService";
import { effectiveShipmentStatus } from "../services/carrierPortalService";
import { getShipmentHistory } from "../services/historyService";
import {
  derivePhaseTimestamps,
  formatTimelineTs,
} from "../services/shipmentTimelineService";
import { getHereApiKey, hereRasterTileUrl, resolveHereApiKey } from "../config/hereMaps";
import "leaflet/dist/leaflet.css";
import TenderResultModal from "../components/shipments/TenderResultModal";
import NewShipmentModal from "../components/shipments/NewShipmentModal";
import { createShipment, copyShipment, deleteShipmentById, updateShipmentLocations, recordShipmentEvent, deriveShipmentEquipment, changeShipmentCarrier } from "../services/shipmentService";
import LocationFieldsEditor from "../components/LocationFieldsEditor";
import { locationFromShipmentOrigin, locationFromShipmentDest } from "../types/location";
import { unassignOrderFromShipment, updateOrderStatus } from "../services/orderWriteService";
import { confirmOrdersForShipment, unassignOrderAndCleanupShipment, unplanOrdersForShipmentRemoval } from "../services/shipmentOrderService";
import { propagateTenderAcceptance } from "../services/tenderAcceptanceNotifier";
import LocationFilter from "../components/ui/LocationFilter";
import { matchesLocation } from "../utils/locationFilter";
import { deriveShipmentCostBreakdown, formatUSD } from "../utils/shipmentCost";
import { deriveCommodityFromOrders } from "../utils/shipmentFromOrders";
import { getRateByLane, summarizeDiscount } from "../services/rateService";
import { fetchOmsSyncForShipmentIds } from "../services/omsSyncStatusService";
import { deriveOmsSyncStatus } from "../utils/omsSyncStatus";
import OmsSyncPill from "../components/shipments/OmsSyncPill";
import TenderAcceptModal from "../components/shipments/TenderAcceptModal";
import { buildLaneKey } from "../utils/laneUtils";
import { TOAST_DURATIONS } from "../constants/toast";
import ExportButton from "../components/ui/ExportButton";
import { useRowSelection } from "../hooks/useRowSelection";
import { SelectionHeaderCheckbox, SelectionRowCheckbox } from "../components/ui/SelectionCheckbox";
import SelectionBar from "../components/ui/SelectionBar";

const STATUS_BADGES = {
  Planned: "badge badge-teal",
  Tendered: "badge badge-purple",
  "Tender Rejected": "badge badge-red",
  // Shared label with orders.status (migration 014) so the shipment badge
  // and the order badge both read "Tender Accepted" after a carrier accept.
  "Tender Accepted": "badge badge-green",
  Confirmed: "badge badge-green",
  "In Transit": "badge badge-blue",
  Delivered: "badge badge-green",
  Exception: "badge badge-red",
  Cancelled: "badge badge-red",
};

const STATE_CENTROIDS = {
  AL: [32.8, -86.8], AZ: [34.2, -111.7], AR: [34.9, -92.4], CA: [37.1, -119.7],
  CO: [39.0, -105.5], CT: [41.6, -72.7], FL: [27.8, -81.7], GA: [32.7, -83.3],
  IA: [42.1, -93.5], ID: [44.2, -114.4], IL: [40.0, -89.2], IN: [39.9, -86.3],
  KS: [38.5, -98.3], KY: [37.6, -85.3], LA: [31.1, -91.9], MA: [42.2, -71.8],
  MD: [39.0, -76.7], MI: [44.3, -85.4], MN: [46.4, -94.6], MO: [38.5, -92.6],
  MS: [32.7, -89.7], NC: [35.5, -79.4], NE: [41.5, -99.8], NJ: [40.1, -74.7],
  NM: [34.5, -106.0], NV: [39.3, -116.6], NY: [43.0, -75.0], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.6], SC: [33.8, -80.9],
  TN: [35.7, -86.4], TX: [31.4, -99.3], UT: [39.3, -111.7], VA: [37.5, -78.6],
  WA: [47.4, -120.5], WI: [44.6, -89.6],
};

function hashInt(value) {
  let h = 0;
  const str = String(value || "");
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) - h) + str.charCodeAt(i);
  return Math.abs(h);
}

function stateFromLocation(location) {
  const m = String(location || "").toUpperCase().match(/,\s*([A-Z]{2})\b/);
  return m ? m[1] : "";
}

function coordForLocation(location) {
  const st = stateFromLocation(location);
  const base = STATE_CENTROIDS[st];
  if (base) {
    const jitter = ((hashInt(location) % 20) - 10) * 0.04;
    return [Number((base[0] + jitter).toFixed(4)), Number((base[1] - jitter).toFixed(4))];
  }
  return null;
}

function statusColor(status) {
  if (status === "In Transit") return "#3b82f6";
  if (status === "Exception") return "#ef4444";
  if (status === "Delivered") return "#22c55e";
  return "#f59e0b";
}

function parseMissingColumn(errorMessage) {
  const msg = String(errorMessage || "");
  const patterns = [
    /column\s+"?([a-zA-Z0-9_]+)"?\s+does\s+not\s+exist/i,
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i,
    /unknown column ['"]?([a-zA-Z0-9_]+)['"]?/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) return m[1];
  }
  return "";
}

async function patchShipmentWithFallback(shipmentId, payload) {
  const patch = { ...payload };
  const maxAttempts = Math.max(1, Object.keys(patch).length + 2);
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return await DbApi.patch("shipments", shipmentId, patch);
    } catch (err) {
      const missing = parseMissingColumn(err.message);
      if (!missing || !Object.prototype.hasOwnProperty.call(patch, missing)) throw err;
      delete patch[missing];
      if (!Object.keys(patch).length) throw err;
    }
  }
  return DbApi.patch("shipments", shipmentId, patch);
}

// CP_RESPONSE notes serialization is owned by services/tenderService —
// withMergedTenderNotes preserves carrier-supplied fields (driver,
// truck, etc.) when a planner submits the dock plan after the carrier
// has already responded via the carrier portal. Replaces an earlier
// inline helper that overwrote the entire payload.

/* ── InfoBox helper ── */
function InfoBox({ icon, label, value }) {
  return (
    <div style={{ padding: "10px 14px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{value || "—"}</div>
    </div>
  );
}

/* ── Shipment Detail Modal ── */
function ShipmentDetailModal({ ds, onClose, onTender, onWithdraw, onUnassign, onNavigate, STATUS_BADGES, shipments, onChangeCarrier, onShipmentPatched }) {
  const linked = ds._linkedOrders || [];
  // Derive commodity from linked orders so it stays correct even when ds
  // was opened before the parent's `orders` list picked up the new
  // shipment_id link (race on first open after shipment creation).
  const commodityFromLinked = deriveCommodityFromOrders(linked);
  const displayStatus = effectiveShipmentStatus(ds);
  const [lines, setLines] = useState([]);
  const [linesLoading, setLinesLoading] = useState(true);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({ type: "", note: "", date: new Date().toISOString().slice(0, 10) });
  const [eventSaving, setEventSaving] = useState(false);
  const [showChangeCarrier, setShowChangeCarrier] = useState(false);
  const [carrierQuotes, setCarrierQuotes] = useState([]);
  const [carrierLoading, setCarrierLoading] = useState(false);
  const [selectedCarrierIdx, setSelectedCarrierIdx] = useState(0);
  // REQ-20: real change_history rows for this shipment (edit / tender /
  // add-order / unassign / invoice / status). Fetched on open.
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Rate lookup for discount / FSC% visibility. Fetched on open so the
  // cost breakdown can show "how was $total_cost built up?" — discount
  // lives on the rates table, not the shipment row.
  const [rateRow, setRateRow] = useState(null);

  // REQ-24: inline edit state for the ship-from / ship-to blocks. The
  // canonical {name, city, state, zip} shape lives in types/location.js;
  // we hydrate it from the shipment row on every render so reopening
  // the modal after an external refresh picks up the latest values.
  const [locEdit, setLocEdit] = useState(false);
  const [locSaving, setLocSaving] = useState(false);
  const [fromLoc, setFromLoc] = useState(() => locationFromShipmentOrigin(ds));
  const [toLoc,   setToLoc]   = useState(() => locationFromShipmentDest(ds));

  async function saveLocations() {
    setLocSaving(true);
    try {
      // Service layer owns the DB call — components don't touch DbApi
      // directly (CLAUDE_RULES #3 / #4).
      await updateShipmentLocations(ds.id, fromLoc, toLoc);
      setLocEdit(false);
      // Reuse the change-carrier refresh callback so the list reflects
      // the new values. Falls through gracefully if not wired.
      if (typeof onChangeCarrier === "function") { onClose(); onChangeCarrier(); }
    } catch (err) {
      alert("Failed to save locations: " + err.message);
    } finally {
      setLocSaving(false);
    }
  }

  function cancelLocationEdit() {
    setFromLoc(locationFromShipmentOrigin(ds));
    setToLoc(locationFromShipmentDest(ds));
    setLocEdit(false);
  }

  // Load line items for the modal's Line Items table.
  //
  // Two paths (post-migration 032):
  //   1. Linked orders present → live-fetch from /orders/:id/lines
  //      per linked order. Authoritative — picks up post-plan edits
  //      to any order's lines without waiting for a re-snapshot.
  //   2. No linked orders BUT ds.line_items has entries → render
  //      directly from the snapshot column. This is the Copy Shipment
  //      / detached-shipment case: the copy intentionally doesn't
  //      duplicate orders, so there's nothing to live-fetch, and
  //      without the snapshot fallback the table would render
  //      "No line items" even though the source had a full freight
  //      composition.
  useEffect(() => {
    const ids = linked.map((o) => o.id).filter(Boolean);
    if (!ids.length) {
      const snap = Array.isArray(ds.line_items) ? ds.line_items : [];
      setLines(snap);
      setLinesLoading(false);
      return;
    }
    Promise.all(ids.map((oid) =>
      OrdersApi.lines(oid)
        .then((res) => (Array.isArray(res) ? res : res?.lines || res?.data || []))
        .catch(() => [])
    )).then((results) => {
      setLines(results.flat());
      setLinesLoading(false);
    }).catch(() => setLinesLoading(false));
  }, [ds.id]);

  // REQ-20: pull shipment change history whenever the modal opens for
  // a new id. Exposed as a callback so the Add-Event handler can refetch
  // after a new event is recorded — otherwise the timeline rungs keep
  // rendering against a stale snapshot until the user closes and
  // reopens the modal.
  const reloadHistory = useCallback(() => {
    let cancelled = false;
    setHistoryLoading(true);
    getShipmentHistory(ds.id, { limit: 200 })
      .then((rows) => { if (!cancelled) { setHistoryRows(rows || []); setHistoryLoading(false); } })
      .catch(() => { if (!cancelled) { setHistoryRows([]); setHistoryLoading(false); } });
    return () => { cancelled = true; };
  }, [ds.id]);

  useEffect(() => reloadHistory(), [reloadHistory]);

  // Load the rate row referenced by this shipment so we can display
  // discount %, discount $, and FSC % alongside the cost breakdown.
  useEffect(() => {
    let cancelled = false;
    const lane = ds.rate_id;
    if (!lane) { setRateRow(null); return; }
    getRateByLane(lane).then((row) => { if (!cancelled) setRateRow(row); });
    return () => { cancelled = true; };
  }, [ds.rate_id]);
  const consolidated = linked.length > 1;
  const pct = displayStatus === "Delivered" ? 100
    : displayStatus === "In Transit" ? 62
    : (displayStatus === "Tender Accepted" || displayStatus === "Confirmed") ? 32
    : displayStatus === "Tendered" ? 20
    : displayStatus === "Exception" ? 55
    : 5;
  const barCol = displayStatus === "Exception" ? "var(--red)" : displayStatus === "Delivered" ? "var(--green)" : "var(--accent)";
  const isTendered = displayStatus !== "Planned" && displayStatus !== "Tender Rejected";
  // REQ-19: separate "tender accepted" from "tendered" so the timeline can
  // show both rungs. The effective display status flips to "Confirmed"
  // (or "Tender Accepted") once the carrier portal records the accept.
  const isTenderAccepted = ["Confirmed", "Tender Accepted", "In Transit", "Delivered"].includes(displayStatus);
  const isPickedUp = ["In Transit", "Delivered", "Exception"].includes(ds.status);
  const isInTransit = ["In Transit", "Delivered"].includes(ds.status);
  const isDelivered = ds.status === "Delivered";

  async function fetchChangeCarrierQuotes() {
    setShowChangeCarrier(true);
    setCarrierLoading(true);
    try {
      const originZip = String(ds.origin_zip || ds.origin || "").match(/\b(\d{5})\b/)?.[1] || "";
      const destZip = String(ds.dest_zip || ds.dest || "").match(/\b(\d{5})\b/)?.[1] || "";
      const lane = {
        laneKey: buildLaneKey(ds),
        origin: ds.origin || "", destination: ds.dest || "",
        originZip, destZip, freightClass: "70",
        totalWeight: ds.weight || 0, totalPieces: ds.pieces || 0,
        orderIds: Array.isArray(ds.order_ids) ? ds.order_ids : [],
      };
      const rateRes = await BulkPlanApi.rate([lane], "cost");
      const results = Array.isArray(rateRes?.results) ? rateRes.results : [];
      const quotes = results[0]?.quotes || [];
      setCarrierQuotes(quotes.filter((q) => q.transitDays > 0).sort((a, b) => (a.totalCharge || 0) - (b.totalCharge || 0)));
    } catch (err) {
      setCarrierQuotes([]);
    } finally {
      setCarrierLoading(false);
    }
  }

  async function confirmChangeCarrier() {
    const chosen = carrierQuotes[selectedCarrierIdx];
    if (!chosen) return;
    try {
      // Service layer owns the API call (CLAUDE_RULES #3 / #4). The
      // dedicated /change-carrier endpoint writes change_history rows
      // and broadcasts SHIPMENT_UPDATED — neither of which the previous
      // generic /db/shipments PATCH did. The response carries the new
      // shipment row so we can update the modal in place rather than
      // closing it and racing a background refresh.
      const { shipment: nextShip, patch } = await changeShipmentCarrier(ds.id, chosen, ds);
      setShowChangeCarrier(false);

      const merged = { ...ds, ...(nextShip || {}), ...(patch || {}) };
      // Keep the resolved display name (`_carrier`) and the raw column
      // (`carrier`) in lock-step so every read site in the modal — the
      // header chip, the Carrier InfoBox, the badge — flips immediately.
      merged._carrier = (nextShip && nextShip.carrier) || chosen.carrier;
      merged.carrier  = (nextShip && nextShip.carrier) || chosen.carrier;

      if (typeof onShipmentPatched === "function") {
        // Updates the parent's detailShipment state in place AND triggers
        // a background refreshData() — the modal stays open and the user
        // sees the new carrier without a reopen-and-pray cycle.
        onShipmentPatched(merged);
      } else if (typeof onChangeCarrier === "function") {
        // Fallback for any older wiring that still expects the
        // close-and-refresh dance.
        onClose();
        onChangeCarrier();
      }
      // The audited /change-carrier endpoint just wrote one
      // change_history row per actually-changed field (carrier, mode,
      // total_cost, …). The History tab here is loaded by reloadHistory,
      // which is keyed on [ds.id] and therefore does NOT re-run when
      // onShipmentPatched merges the new shipment row in place. Without
      // this explicit refetch the user sees the stale "1 EVENT" snapshot
      // from when the modal opened — which is exactly what made it look
      // like Change Carrier wasn't being captured at all.
      reloadHistory();
    } catch (err) {
      alert("Failed: " + err.message);
    }
  }
  const transitDays = (() => {
    const pu = ds.pickup_date, du = ds.delivery_date;
    if (!pu || !du) return "—";
    const d1 = new Date(pu), d2 = new Date(du);
    if (isNaN(d1) || isNaN(d2)) return "—";
    return Math.max(1, Math.round((d2 - d1) / 86400000)) + " days";
  })();
  // Derive the actual timestamp at which each phase fired from the
  // change_history rows we already loaded for the audit drawer. Falls
  // back to the shipment's planned date only when no history row exists
  // for that phase yet (e.g. an in-flight transition).
  const phaseTimestamps = derivePhaseTimestamps(historyRows);
  const phaseLine = (phase, fallbackTsRaw, doneFallback) => {
    const fromHistory = formatTimelineTs(phaseTimestamps[phase]);
    if (fromHistory) return fromHistory;
    const fromRow = formatTimelineTs(fallbackTsRaw);
    if (fromRow) return fromRow;
    return doneFallback;
  };
  const timelineEvents = [
    { icon: "📋", label: "Order Created & Rate Confirmed", done: true, time: phaseLine("created", ds.created_at, "Confirmed") },
    { icon: "📤", label: "Tendered to Carrier", done: isTendered, time: isTendered ? phaseLine("tendered", ds.tendered_at, "Confirmed") : "Pending" },
    // REQ-19: surface the tender-accepted event in the shipment timeline.
    // Previously the timeline jumped straight from "Tendered" to "Picked Up",
    // leaving the accept step invisible to the planner.
    { icon: "🤝", label: "Tender Accepted", done: isTenderAccepted, time: isTenderAccepted ? phaseLine("accepted", null, "Confirmed") : "Pending" },
    // shipped_at is stamped by the OMS ship-confirm path even when no
    // "status → Picked Up / In Transit" audit row was written, so use it
    // as the row-level fallback for both rungs (pick-up is the load-out
    // moment, transit starts immediately after).
    { icon: "🚛", label: "Picked Up", done: isPickedUp, time: isPickedUp ? phaseLine("pickedUp", ds.shipped_at, "Confirmed") : "Pending" },
    { icon: "📍", label: "In Transit", done: isInTransit, time: isInTransit ? phaseLine("inTransit", ds.shipped_at, "En route") : "Pending" },
    { icon: "✅", label: "Delivered", done: isDelivered, time: isDelivered ? phaseLine("delivered", ds.delivered_at, "Confirmed") : "Pending" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 680, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: 1 }}>SHIPMENT DETAILS</div>
            <h3>{ds.id}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>

          {/* Status bar */}
          <div style={{ padding: "14px 20px", background: "#f8faff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className={STATUS_BADGES[displayStatus] || "badge"}>{displayStatus}</span>
              <span style={{ fontSize: 13, color: "var(--text2)" }}>{ds._carrier || "—"} · <span className={`badge ${ds.mode === "LTL" ? "badge-blue" : "badge-green"}`} style={{ fontSize: 11 }}>{ds.mode || "—"}</span></span>
              {consolidated && <span style={{ fontSize: 11, background: "rgba(99,102,241,.1)", color: "#6366f1", border: "1px solid rgba(99,102,241,.2)", padding: "2px 9px", borderRadius: 10, fontWeight: 600 }}>🔗 Consolidated · {linked.length} orders</span>}
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--green)" }}>${(ds.total_cost || 0).toLocaleString()}</span>
          </div>

          {/* Progress / Origin → Destination */}
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
            {/* Multi-stop route path for MBOL */}
            {ds.bol_type === "MBOL" && (() => {
              const childDests = (shipments || [])
                .filter((s) => s.master_shipment_id === ds.id && s.bol_type === "CBOL")
                .sort((a, b) => (a.stop_to || 0) - (b.stop_to || 0))
                .map((s) => (s.dest || "").split(",")[0].trim())
                .filter(Boolean);
              const originCity = (ds.origin || "").split(",")[0].trim();
              const routePath = [originCity, ...childDests].filter(Boolean);
              return routePath.length > 2 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, padding: "8px 12px", background: "rgba(99,102,241,.05)", borderRadius: 8, border: "1px solid rgba(99,102,241,.15)" }}>
                  <span className="badge badge-blue" style={{ fontSize: 9 }}>MULTI-STOP</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>
                    {routePath.map((city, i) => (
                      <span key={i}>{i > 0 && <span style={{ color: "var(--text3)", margin: "0 4px" }}>→</span>}{city}</span>
                    ))}
                  </span>
                </div>
              ) : null;
            })()}
            {/* REQ-24: ship-from / ship-to. Read-only view renders the
                Name on its own line above the address; clicking ✏️ Edit
                swaps in the shared LocationFieldsEditor and persists via
                the service layer. */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8 }}>SHIP FROM</div>
                  {!locEdit && (
                    <button onClick={() => setLocEdit(true)} title="Edit ship-from and ship-to" style={{ background: "transparent", border: "1px solid var(--border)", borderRadius: 6, fontSize: 10, color: "var(--text3)", cursor: "pointer", padding: "2px 8px", fontFamily: "inherit" }}>✏️ Edit</button>
                  )}
                </div>
                {locEdit ? (
                  <div style={{ marginTop: 4 }}>
                    <LocationFieldsEditor value={fromLoc} onChange={setFromLoc} layout="compact" />
                  </div>
                ) : (
                  <>
                    {ds.ship_from_name && <div style={{ fontWeight: 700, fontSize: 13, marginTop: 3 }}>{ds.ship_from_name}</div>}
                    <div style={{ fontWeight: ds.ship_from_name ? 500 : 700, fontSize: ds.ship_from_name ? 12 : 14, marginTop: 2, color: ds.ship_from_name ? "var(--text2)" : "inherit" }}>{ds.origin || "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Pickup: {ds.pickup_date || "—"}</div>
                  </>
                )}
              </div>
              <div style={{ textAlign: "center", paddingTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>{(ds.miles || 750).toLocaleString()} mi</div>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{pct}% complete</span>
              </div>
              <div style={{ flex: 1, textAlign: locEdit ? "left" : "right" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8 }}>SHIP TO</div>
                {locEdit ? (
                  <div style={{ marginTop: 4 }}>
                    <LocationFieldsEditor value={toLoc} onChange={setToLoc} layout="compact" />
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                      <button onClick={cancelLocationEdit} disabled={locSaving} style={{ flex: 1, padding: "5px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, fontWeight: 600, color: "var(--text2)", cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                      <button onClick={saveLocations} disabled={locSaving} style={{ flex: 1, padding: "5px 10px", background: "#2563eb", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "inherit", opacity: locSaving ? 0.6 : 1 }}>{locSaving ? "Saving…" : "Save"}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {ds.ship_to_name && <div style={{ fontWeight: 700, fontSize: 13, marginTop: 3 }}>{ds.ship_to_name}</div>}
                    <div style={{ fontWeight: ds.ship_to_name ? 500 : 700, fontSize: ds.ship_to_name ? 12 : 14, marginTop: 2, color: ds.ship_to_name ? "var(--text2)" : "inherit" }}>{ds.dest || "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>Delivery: {ds.delivery_date || "—"}</div>
                  </>
                )}
              </div>
            </div>
            <div style={{ height: 10, background: "var(--bg3)", borderRadius: 8 }}>
              <div style={{ width: `${pct}%`, height: 10, background: barCol, borderRadius: 8 }} />
            </div>
          </div>

          {/* Details grid - 3 columns */}
          <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, borderBottom: "1px solid var(--border)" }}>
            {/* Status as a first-class field in the grid — the status bar above
                is a quick glance but users expect to see it alongside Carrier/Mode. */}
            <InfoBox icon="🚦" label="Status" value={displayStatus} />
            <InfoBox icon="🚛" label="Carrier" value={ds._carrier || "—"} />
            <InfoBox icon="📦" label="Mode" value={ds.mode || "—"} />
            {(() => {
              const eq = deriveShipmentEquipment(ds, rateRow);
              return (
                <InfoBox
                  icon="🛻"
                  label={eq.source === "rate" ? "Equipment (from rate)" : "Equipment"}
                  value={eq.value || "—"}
                />
              );
            })()}
            <InfoBox icon="⚖️" label="Weight" value={`${(ds.weight || 0).toLocaleString()} lbs`} />
            <InfoBox icon="🔢" label="Pieces" value={String(ds.pieces || 0)} />
            <InfoBox icon="🏷️" label="Commodity" value={commodityFromLinked || ds._commodity || ds.commodity || "—"} />
            {ds.rate_id && (
              <div className="sd-field">
                <div className="sd-field-label">📄 Rate ID</div>
                <div className="sd-field-value">
                  <a href={`/rate-management?q=${encodeURIComponent(ds.rate_id)}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/rate-management?q=${encodeURIComponent(ds.rate_id)}`; }} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600, cursor: "pointer" }}>{ds.rate_id}</a>
                </div>
              </div>
            )}
            {/* Cost breakdown — always rendered so the planner can see how
                total_cost was built up. deriveShipmentCostBreakdown() fills
                in the base from the total when legacy/OMS rows only stored
                total_cost. Discount / FSC% come from the rate row
                (shipment doesn't persist them). */}
            {(() => {
              const cost = deriveShipmentCostBreakdown(ds);
              const disc = summarizeDiscount(rateRow, cost.base);
              const fscPct = rateRow?.fsc || "";
              return (
                <>
                  <InfoBox icon="📊" label={cost.baseIsDerived ? "Base / Linehaul (derived)" : "Base / Linehaul"} value={formatUSD(cost.base)} />
                  <InfoBox
                    icon="🎟️"
                    label={disc.hasDiscount ? `Discount (${disc.pct}%${disc.flat ? ` + ${formatUSD(disc.flat)}` : ""})` : "Discount"}
                    value={disc.hasDiscount ? `− ${formatUSD(disc.amount)}` : "No discount applied"}
                  />
                  <InfoBox
                    icon="⛽"
                    label={fscPct ? `Fuel Surcharge (${fscPct})` : "Fuel Surcharge"}
                    value={formatUSD(cost.fuel)}
                  />
                  <InfoBox
                    icon="📦"
                    label="Accessorials"
                    value={cost.accessorials > 0 ? formatUSD(cost.accessorials) : "$0 (none billed)"}
                  />
                  <InfoBox icon="💰" label="Est. Cost (Total)" value={formatUSD(cost.total)} />
                </>
              );
            })()}
            <InfoBox icon="📅" label="Pickup Date" value={ds.pickup_date || ds.pickup || "—"} />
            <InfoBox icon="🏁" label="Delivery Date" value={ds.delivery_date || ds.delivery || "—"} />
            <InfoBox icon="🚚" label="Transit Days" value={transitDays} />
            <InfoBox icon="🔖" label="PRO Number" value={ds.pro_number || "—"} />
            <InfoBox icon="📋" label="BOL / Carrier Ref" value={ds.bol_number || "—"} />
            {/* REQ-22: trailer seal number captured at tender acceptance */}
            <InfoBox icon="🔒" label="Seal Number" value={ds.seal_number || "—"} />
            <InfoBox icon="⭐" label="Service Level" value={ds.service_level || "—"} />
            <InfoBox icon="🚪" label="Dock Door" value={ds.dock_door || ds.dock_assigned || "—"} />
            <InfoBox icon="🕐" label="Dock Time" value={ds.dock_time || "—"} />
            <InfoBox icon="▶️" label="Loading Start" value={ds.loading_start || "—"} />
            <InfoBox icon="⏹️" label="Loading End" value={ds.loading_end || "—"} />
          </div>

          {/* Consolidated Orders */}
          {linked.length > 0 && (
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                {linked.length > 1 ? `Consolidated Orders (${linked.length})` : "Associated Order"}
              </div>
              {linked.map((o) => (
                <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", background: "#f8faff", borderRadius: 8, marginBottom: 6, border: "1px solid var(--border)" }}>
                  <a href={`/orders?id=${o.id}`} onClick={(e) => { e.preventDefault(); window.location.href = `/orders?id=${o.id}`; }} className="mono" style={{ color: "var(--accent)", fontSize: 12, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>{o.id}</a>
                  <span style={{ fontSize: 12, color: "var(--text2)" }}>{o.customer || ""}</span>
                  <span style={{ fontSize: 12, color: "var(--text3)" }}>· {o.commodity || ""}</span>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>· {(o.origin || "").split(",")[0]} → {(o.dest || "").split(",")[0]}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, fontFamily: "monospace", color: "var(--text2)" }}>{(o.weight || 0).toLocaleString()} lbs</span>
                  {ds.status === "Planned" && (
                    <button onClick={() => onUnassign(o.id, ds.id)} style={{ padding: "3px 10px", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 7, fontSize: 11, fontWeight: 600, color: "#b45309", cursor: "pointer", fontFamily: "inherit" }}>🔓 Unplan</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Line Items */}
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📦 Line Items</div>
            {linesLoading ? (
              <div style={{ color: "var(--text3)", fontSize: 12, fontStyle: "italic" }}>Loading…</div>
            ) : lines.length === 0 ? (
              <div style={{ color: "var(--text3)", fontSize: 12, fontStyle: "italic" }}>No line items</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "var(--bg3)" }}>
                    {["Order", "#", "Item ID", "Description", "Qty", "Unit Wt", "Total Wt"].map((h) => (
                      <th key={h} style={{ padding: "5px 8px", textAlign: ["Qty", "Unit Wt", "Total Wt"].includes(h) ? "right" : "left", fontSize: 10, color: "var(--text3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, borderBottom: "1px solid var(--border)" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 10, color: "var(--text3)" }}>{l.order_id || ""}</td>
                      <td style={{ padding: "5px 8px", fontSize: 11, color: "var(--text3)" }}>{i + 1}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: 11, color: "var(--accent)" }}>{l.item_id || "—"}</td>
                      <td style={{ padding: "5px 8px", fontSize: 12 }}>{l.description || "—"}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{l.qty_ordered || 0}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>{l.unit_weight || l.unit_value || 0} lbs</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace", fontWeight: 600 }}>{l.total_weight || l.total_value || 0} lbs</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Shipment Timeline */}
          <div style={{ padding: "16px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Shipment Timeline</span>
              <button onClick={() => setShowAddEvent(!showAddEvent)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ Add Event</button>
            </div>

            {/* Add Event Form */}
            {showAddEvent && (
              <div style={{ padding: "12px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border)", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <select value={newEvent.type} onChange={(e) => setNewEvent({ ...newEvent, type: e.target.value })} style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }}>
                    <option value="">— Select Event Type —</option>
                    <option value="Picked Up">Picked Up</option>
                    <option value="In Transit">In Transit</option>
                    <option value="Departed">Departed Terminal</option>
                    <option value="Arrived">Arrived at Destination</option>
                    <option value="Delivered">Delivered</option>
                    <option value="Exception">Exception</option>
                    <option value="Delay">Delay Notification</option>
                    <option value="Note">General Note</option>
                  </select>
                  <input type="date" value={newEvent.date} onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }} />
                </div>
                <input placeholder="Add a note (optional)" value={newEvent.note} onChange={(e) => setNewEvent({ ...newEvent, note: e.target.value })} style={{ width: "100%", padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button disabled={eventSaving} onClick={async () => {
                    if (!newEvent.type || eventSaving) return;
                    setEventSaving(true);
                    try {
                      const res = await recordShipmentEvent(ds.id, {
                        type: newEvent.type,
                        note: newEvent.note,
                        date: newEvent.date,
                      });
                      setNewEvent({ type: "", note: "", date: new Date().toISOString().slice(0, 10) });
                      setShowAddEvent(false);
                      // Keep the modal open — merge the status/date patch from the
                      // API response into the parent's detailShipment so the badge,
                      // timeline rungs, and action footer reflect the new state
                      // without tearing down the dialog.
                      const patch = res?.shipmentPatch || {};
                      if (typeof onShipmentPatched === "function" && Object.keys(patch).length) {
                        onShipmentPatched(patch);
                      }
                      // Refresh the audit drawer + timeline timestamps so the
                      // newly-recorded event appears without a modal close/open.
                      reloadHistory();
                    } catch (err) {
                      alert("Failed to save event: " + err.message);
                    } finally {
                      setEventSaving(false);
                    }
                  }} style={{ padding: "5px 14px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: eventSaving ? "wait" : "pointer", fontFamily: "inherit", opacity: eventSaving ? 0.6 : 1 }}>{eventSaving ? "Saving…" : "Save Event"}</button>
                  <button onClick={() => setShowAddEvent(false)} style={{ padding: "5px 14px", background: "var(--bg3)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Default Timeline */}
            {timelineEvents.map((ev, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 4 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: ev.done ? "var(--accent)" : "var(--bg3)", border: ev.done ? "2px solid var(--accent)" : "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
                    {ev.done ? <span style={{ color: "#fff", fontSize: 12 }}>{ev.icon}</span> : <span style={{ opacity: 0.4, fontSize: 12 }}>{ev.icon}</span>}
                  </div>
                  {i < 4 && <div style={{ width: 2, height: 20, background: ev.done ? "var(--accent)" : "var(--border)" }} />}
                </div>
                <div style={{ paddingTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: ev.done ? "var(--text)" : "var(--text3)" }}>{ev.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>{ev.time || (ev.done ? "Confirmed" : "Pending")}</div>
                </div>
              </div>
            ))}
          </div>

          {/* REQ-20: Shipment Change History — surfaces every audit row from
              change_history (edit / tender / status / add-order / unassign /
              invoice) so planners and finance can see exactly what happened
              and when, similar to the order history drawer. */}
          <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>Shipment Change History</span>
              <span style={{ fontSize: 10, color: "var(--text3)" }}>{historyLoading ? "loading…" : `${historyRows.length} event${historyRows.length === 1 ? "" : "s"}`}</span>
            </div>
            {!historyLoading && historyRows.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic", padding: "8px 0" }}>No history recorded yet.</div>
            )}
            {historyRows.map((row, i) => {
              // historyService.shapeHistoryRows already produced: { type, action,
              // user, userRole, ts, tsRaw, changes: [{ label, old, new }],
              // metadata }. Edits are bucketed so multiple field changes in
              // the same request become a single entry. Note: the change
              // objects use { label, old, new } — NOT { field, before, after }.
              // An earlier version of this renderer read the wrong keys and
              // silently dropped every EDIT summary, so a Change Carrier
              // landed in the DB but the row rendered as a bare "EDIT".
              const action = (row.action || row.type || "").toLowerCase();
              const icon =
                action === "tender" ? "📤"
                : action === "status" ? "🔁"
                : action === "plan" || action === "add" || action === "add-order" ? "➕"
                : action === "unassign" || action === "remove" ? "➖"
                : action === "invoice" || action === "invoice_approve" || action === "invoice_reject" ? "🧾"
                : action === "edit" ? "✏️"
                : action === "create" ? "📋"
                : action === "delete" ? "🗑️"
                : "📌";
              const color =
                action === "tender" ? "#7c3aed"
                : action === "unassign" || action === "remove" || action === "delete" ? "#dc2626"
                : action === "plan" || action === "add" || action === "add-order" ? "#059669"
                : action === "status" ? "#2563eb"
                : action === "invoice" ? "#d97706"
                : "#475569";
              const changes = Array.isArray(row.changes) ? row.changes : [];
              const changeSummary = changes
                .map((c) => {
                  if (!c) return null;
                  const label = c.label || c.field; // historyService emits `label`; tolerate `field` for any future caller
                  if (!label) return null;
                  const oldVal = c.old ?? c.before;
                  const newVal = c.new ?? c.after;
                  return `${label}: ${oldVal ?? "—"} → ${newVal ?? "—"}`;
                })
                .filter(Boolean)
                .join(" · ");
              const meta = row.metadata && typeof row.metadata === "object"
                ? Object.entries(row.metadata)
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
                  .join(" · ")
                : "";
              return (
                <div key={`hist-${i}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: i === historyRows.length - 1 ? "none" : "1px dashed var(--border)" }}>
                  <span style={{ fontSize: 16, lineHeight: 1, marginTop: 1 }}>{icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
                      <span style={{ color, textTransform: "uppercase", letterSpacing: 0.4 }}>{action || "event"}</span>
                      {changeSummary && <span style={{ color: "var(--text3)", fontWeight: 400 }}> · {changeSummary}</span>}
                    </div>
                    {meta && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2, wordBreak: "break-word" }}>{meta}</div>}
                    <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                      {row.ts || (row.tsRaw ? new Date(row.tsRaw).toLocaleString() : "")}{row.user ? ` · ${row.user}` : ""}{row.userRole ? ` (${row.userRole})` : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Footer */}
                <div style={{ padding: "14px 20px", background: "#f8faff", borderTop: "1px solid var(--border)", display: "flex", gap: 8, flexWrap: "wrap", borderRadius: "0 0 16px 16px" }}>
          {["Planned", "Tender Rejected"].includes(displayStatus) && (
            <button className="btn btn-primary btn-sm" onClick={() => onTender(ds)}>📤 Tender to Carrier</button>
          )}
          {displayStatus === "Tendered" && (
            <button style={{ background: "#ea580c", color: "#fff", border: "none", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} onClick={() => onWithdraw(ds)}>📤 Withdraw Tender</button>
          )}
          {["Planned", "Tendered", "Tender Rejected", "In Transit"].includes(displayStatus) && (
            <button className="btn btn-secondary btn-sm" onClick={fetchChangeCarrierQuotes}>🔄 Change Carrier</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => { onClose(); onNavigate("/dock-scheduling"); }}>🚪 Dock schedule</button>
          <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onNavigate(`/documents?shipmentId=${encodeURIComponent(ds.id)}`); onClose(); }}>📄 Documents</button>
          <button className="btn btn-secondary btn-sm" onClick={() => { onClose(); onNavigate(`/messaging`); }}>📧 Contact Carrier</button>
          {/* REQ-18: Send-to-WMS is only meaningful after the carrier has
             accepted the tender. Pre-accept (Planned / Tendered / Tender
             Rejected) the button is hidden. effectiveShipmentStatus()
             promotes a Tendered+accept-in-notes shipment to "Tender
             Accepted", so isTenderAccepted captures portal-side accepts
             even before the DB status row is rewritten. */}
          {isTenderAccepted && (
            <button className="btn btn-secondary btn-sm" onClick={() => { onClose(); onNavigate("/messaging"); }}>📨 Send to WMS</button>
          )}
        </div>
      </div>

      {/* Change Carrier Modal */}
      {showChangeCarrier && (
        <div className="modal-overlay" onClick={() => setShowChangeCarrier(false)} style={{ zIndex: 1001 }}>
          <div className="modal-card" style={{ width: 580, maxHeight: "80vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔄 Change Carrier — {ds.id}</h3>
              <button className="modal-close" onClick={() => setShowChangeCarrier(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
                📍 {(ds.origin || "").split(",")[0]} → {(ds.dest || "").split(",")[0]} · {(ds.weight || 0).toLocaleString()} lbs
                <br />Current: <strong>{ds.carrier || "None"}</strong> · ${(ds.total_cost || 0).toLocaleString()}
              </div>
              {carrierLoading && (
                <div style={{ textAlign: "center", padding: 30, color: "var(--text3)" }}>
                  <div className="spinner" style={{ margin: "0 auto 8px" }} />
                  <div style={{ fontSize: 12 }}>Fetching carrier rates...</div>
                </div>
              )}
              {!carrierLoading && carrierQuotes.length === 0 && (
                <div style={{ textAlign: "center", padding: 20, color: "var(--text3)", fontSize: 12 }}>No carrier quotes available for this lane.</div>
              )}
              {carrierQuotes.map((q, i) => {
                const isSelected = selectedCarrierIdx === i;
                const isCurrent = q.carrier === ds.carrier;
                return (
                  <div key={i} onClick={() => setSelectedCarrierIdx(i)} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 4,
                    borderRadius: 8, cursor: "pointer",
                    border: isSelected ? "2px solid rgba(16,185,129,.4)" : "1px solid var(--border)",
                    background: isSelected ? "rgba(16,185,129,.06)" : isCurrent ? "rgba(59,130,246,.04)" : "var(--bg4)",
                  }}>
                    <input type="radio" checked={isSelected} readOnly style={{ accentColor: "var(--accent)" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: isSelected ? 700 : 500, fontSize: 13 }}>{q.carrier}</span>
                        <span className={`badge ${q.mode === "LTL" ? "badge-blue" : "badge-green"}`} style={{ fontSize: 9 }}>{q.mode || "TL"}</span>
                        {q.serviceLevel && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "rgba(107,114,128,.1)", color: "#6b7280", fontWeight: 700 }}>{(q.serviceLevel || "").toUpperCase()}</span>}
                        {isCurrent && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "rgba(59,130,246,.1)", color: "#3b82f6", fontWeight: 700 }}>CURRENT</span>}
                        {q.czarlite && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "rgba(99,102,241,.1)", color: "#4f46e5", fontWeight: 600 }}>CZARLITE</span>}
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 3, fontSize: 10, color: "var(--text3)" }}>
                        <span>🚚 {q.transitDays}D</span>
                        {q.miles && <span>📏 {q.miles.toLocaleString()} mi</span>}
                        <span>Base: ${(q.czarBaseGross || q.czarBase || 0).toLocaleString()}</span>
                        <span>Fuel: ${(q.fscCharge || 0).toLocaleString()}</span>
                      </div>
                    </div>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: isSelected ? 800 : 600, fontSize: 14, color: isSelected ? "var(--green)" : "var(--text2)" }}>
                      ${(q.totalCharge || 0).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowChangeCarrier(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={carrierQuotes.length === 0} onClick={confirmChangeCarrier}
                style={{ background: "linear-gradient(135deg,#059669,#10b981)", border: "none" }}>
                ✅ Confirm Carrier Change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ShipmentsPage() {
  const { shipments, orders, carriers, equipmentTypes, setData, refreshData, refreshShipmentsAndOrders } = useOutletContext();
  // Lightweight refresh for tender-path mutations (shipments + orders only).
  // Falls back to full refresh if the lighter helper isn't provided.
  const refreshTender = refreshShipmentsAndOrders || refreshData;
  const navigate = useNavigate();
  const [shipView, setShipView] = useState("list");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [modeFilter, setModeFilter] = useState("All");
  const [shipFromFilter, setShipFromFilter] = useState("");
  const [shipToFilter, setShipToFilter] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [idsFilter, setIdsFilter] = useState(null); // Set from ?ids= URL param for bulk plan filtering
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [detailShipment, setDetailShipment] = useState(null);

  // Direct WS subscription for the open modal — belt-and-suspenders
  // alongside the outlet-context sync below. The standard chain is:
  // backend bus.emit(SHIPMENT_UPDATED) → server.js wsBroadcast → App.jsx
  // onMessage → refreshData → setData → outlet context → the useEffect
  // below picks up the new status and re-derives detailShipment. That's
  // five hops; any one of them being slow or stalled (WS reconnect
  // window, Supabase replica lag, render batching) leaves the open
  // modal showing stale rungs (e.g. "Tender Accepted" filled while the
  // OMS ship-confirm already moved status to "In Transit"). Subscribing
  // directly here folds the WS payload's own status fields into
  // detailShipment immediately, so the rungs flip the moment the
  // message arrives — no API roundtrip required.
  useEffect(() => {
    if (!detailShipment?.id) return;
    let unsub = () => {};
    let cancelled = false;
    import("../lib/wsClient.js").then(({ connect, onMessage }) => {
      if (cancelled) return;
      connect(); // idempotent — App.jsx already connected at mount
      unsub = onMessage((msg) => {
        if (!msg || msg.event !== "shipment.updated") return;
        const payload = msg.data || {};
        if (!payload.id || payload.id !== detailShipment.id) return;
        // Merge the WS-supplied fields into the live snapshot so the
        // status badge, the rungs (isPickedUp / isInTransit), and the
        // dates flip without waiting for the parent's refreshData →
        // outlet-context cascade. The reloadHistory effect re-fires on
        // every detailShipment change because it's keyed on [ds.id]
        // through useCallback, so the History tab catches up too.
        setDetailShipment((prev) => {
          if (!prev || prev.id !== payload.id) return prev;
          return { ...prev,
            status:        payload.status        ?? prev.status,
            shipped_at:    payload.shipped_at    ?? prev.shipped_at,
            delivered_at:  payload.delivered_at  ?? prev.delivered_at,
            pickup_date:   payload.pickup_date   ?? prev.pickup_date,
            delivery_date: payload.delivery_date ?? prev.delivery_date,
          };
        });
      });
    });
    return () => { cancelled = true; unsub(); };
  }, [detailShipment?.id]);

  // Re-hydrate the open detail modal whenever the outlet `shipments` /
  // `orders` lists change (e.g. WMS ship-confirm → App.jsx WS refresh).
  // This is the slow path that catches everything (carrier/cost/linked
  // orders/etc.); the WS subscription above is the fast path for status
  // and date fields.
  useEffect(() => {
    if (!detailShipment?.id) return;
    const fresh = (shipments || []).find((s) => s.id === detailShipment.id);
    if (!fresh) return; // shipment was deleted — leave snapshot alone
    const linkedOrders = (orders || []).filter(
      (o) => String(o.shipment_id || "") === String(fresh.id || "")
    );
    // Use the same resolver the row map uses, so the modal's display
    // name and the list's display name can never diverge. Crucially this
    // never falls back to the OLD detailShipment._carrier — that fallback
    // was the bug that pinned the previous carrier in the modal after a
    // change-carrier write.
    const nextCarrier = resolveCarrierName(fresh);
    // Only patch when something actually moved, otherwise React bails
    // the diff and we avoid re-rendering the heavy modal body.
    const statusChanged      = fresh.status        !== detailShipment.status;
    const pickupChanged      = fresh.pickup_date   !== detailShipment.pickup_date;
    const deliveryChanged    = fresh.delivery_date !== detailShipment.delivery_date;
    const carrierChanged     = nextCarrier         !== (detailShipment._carrier || "");
    const linkedChanged      = linkedOrders.length !== (detailShipment._linkedOrders?.length || 0);
    if (!(statusChanged || pickupChanged || deliveryChanged || carrierChanged || linkedChanged)) return;
    setDetailShipment({ ...fresh, _linkedOrders: linkedOrders, _carrier: nextCarrier });
  }, [shipments, orders, detailShipment?.id]);

  // REQ-24: per-shipment OMS-sync status. Populated by fetchOmsSyncForShipmentIds
  // whenever the shipments list changes. Shape: Map<tmsShipmentId, oms_orders[]>.
  const [omsSyncByShipment, setOmsSyncByShipment] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const ids = (shipments || []).map((s) => s.id).filter(Boolean);
    if (ids.length === 0) { setOmsSyncByShipment(new Map()); return; }
    fetchOmsSyncForShipmentIds(ids).then((m) => {
      if (!cancelled) setOmsSyncByShipment(m);
    });
    return () => { cancelled = true; };
  }, [shipments]);

  // Auto-open shipment detail from URL ?id=SHP-xxxx (run once on mount)
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    if (autoOpened) return;
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("id");
    const idsParam = params.get("ids");
    if (idParam && shipments.length > 0) {
      const ship = shipments.find((s) => s.id === idParam);
      if (ship) {
        const linkedOrders = orders.filter((o) => String(o.shipment_id || "") === String(ship.id || ""));
        setDetailShipment({ ...ship, _linkedOrders: linkedOrders, _carrier: ship.carrier || "" });
      }
      setAutoOpened(true);
      window.history.replaceState({}, "", "/shipments");
    }
    if (idsParam && shipments.length > 0) {
      setIdsFilter(new Set(idsParam.split(",")));
      setAutoOpened(true);
      window.history.replaceState({}, "", "/shipments");
    }
  }, [shipments]);
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(false);

  function toast(text, type = "info") {
    setMessage({ text, type });
    // Single source of truth for toast hold time — see constants/toast.js.
    // Lets the user actually read action confirmations like
    // "Shipment copied as SHP-2026-9999" before they vanish.
    setTimeout(() => setMessage({ text: "", type: "" }), TOAST_DURATIONS.DEFAULT);
  }

  async function unassignOrder(orderId, shipmentId) {
    if (!window.confirm(`Unplan order ${orderId}?`)) return;
    try {
      const msg = await unassignOrderAndCleanupShipment(orderId, shipmentId, orders, shipments);
      toast(msg, msg.includes("deleted") ? "info" : "success");
      await refreshData();
      setDetailShipment(null);
    } catch (e) {
      toast(`Unassign failed: ${e.message}`, "error");
    }
  }

  function resolveCarrierName(s) {
    if (s?.carrier) return s.carrier;
    const linked = orders.filter(
      (o) => String(o.shipment_id || "") === String(s.id || "")
    );
    for (const o of linked) {
      if (o.preferred_carrier) return o.preferred_carrier;
    }
    return "";
  }

  const sel = useRowSelection();

  const rows = useMemo(() => {
    let list = shipments.map((s) => {
      const linkedOrders = orders.filter(
        (o) => String(o.shipment_id || "") === String(s.id || "")
      );
      return {
        ...s,
        _carrier: resolveCarrierName(s),
        _displayStatus: effectiveShipmentStatus(s),
        _linkedOrders: linkedOrders,
        _orderCount: linkedOrders.length,
        _commodity: deriveCommodityFromOrders(linkedOrders) || s.commodity || "",
      };
    });
    if (idsFilter) list = list.filter((s) => idsFilter.has(s.id));
    if (statusFilter !== "All") list = list.filter((s) => s._displayStatus === statusFilter);
    if (modeFilter !== "All") list = list.filter((s) => (s.mode || "").toUpperCase() === modeFilter);
    if (shipFromFilter) list = list.filter((s) => matchesLocation(s, "from", shipFromFilter));
    if (shipToFilter) list = list.filter((s) => matchesLocation(s, "to", shipToFilter));
    if (createdFrom) list = list.filter((s) => (s.created_at || "") >= createdFrom);
    if (createdTo) list = list.filter((s) => (s.created_at || "") <= createdTo + "T23:59:59");
    if (q.trim()) {
      const terms = q.split(",").map((s) => s.toLowerCase().trim()).filter(Boolean);
      list = list.filter((s) => {
        // Include shipment fields + linked order IDs for search
        const orderIdStr = (s._linkedOrders || []).map((o) => o.id).join(" ");
        const orderIdsArr = Array.isArray(s.order_ids) ? s.order_ids.join(" ") : "";
        const fields = [s.id, s._carrier, s.origin, s.dest, s.mode, s.status, s._displayStatus, orderIdStr, orderIdsArr]
          .map((v) => String(v || "").toLowerCase());
        return terms.some((t) => fields.some((f) => f.includes(t)));
      });
    }
    return [...list].sort((a, b) => {
      const av = String((sortCol === "status" ? a._displayStatus : a[sortCol]) || "").toLowerCase();
      const bv = String((sortCol === "status" ? b._displayStatus : b[sortCol]) || "").toLowerCase();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [shipments, orders, q, statusFilter, modeFilter, shipFromFilter, shipToFilter, createdFrom, createdTo, idsFilter, sortCol, sortAsc]);


  const laneRoutes = useMemo(() => {
    const lanes = new Map();
    rows.forEach((s) => {
      const origin = String(s.origin || "");
      const dest = String(s.dest || "");
      const os = stateFromLocation(origin) || "NA";
      const ds = stateFromLocation(dest) || "NA";
      const key = `${os}->${ds}`;
      if (!lanes.has(key)) {
        lanes.set(key, {
          key,
          from: os,
          to: ds,
          origin,
          dest,
          count: 0,
          statuses: {},
          originCoord: coordForLocation(origin),
          destCoord: coordForLocation(dest),
        });
      }
      const lane = lanes.get(key);
      lane.count += 1;
      lane.statuses[s._displayStatus] = (lane.statuses[s._displayStatus] || 0) + 1;
    });

    return [...lanes.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 18)
      .map((lane) => {
        const topStatus = Object.entries(lane.statuses).sort((a, b) => b[1] - a[1])[0]?.[0] || "Planned";
        return {
          ...lane,
          topStatus,
          color: statusColor(topStatus),
          hasCoords: Array.isArray(lane.originCoord) && Array.isArray(lane.destCoord),
        };
      });
  }, [rows]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  const [tenderResult, setTenderResult] = useState(null); // { shipment, result }

  async function onTender(row) {
    const carrierName = row._carrier || row.carrier || "";
    // Close detail modal and show tender result modal
    setDetailShipment(null);
    setTenderResult({ shipment: row, result: null }); // show "sending" phase
    setBusyId(row.id);
    try {
      const isMbol = row.bol_type === "MBOL";
      const children = isMbol
        ? shipments
            .filter((s) => s.master_shipment_id === row.id && s.bol_type === "CBOL")
            .sort((a, b) => (a.stop_to || 0) - (b.stop_to || 0))
        : [];

      const allLinkedOrders = [
        ...(row._linkedOrders || []),
        ...children.flatMap((c) =>
          orders.filter((o) => String(o.shipment_id || "") === String(c.id))
        ),
      ];

      // Perf: run independent work in parallel — master PATCH, child PATCHes,
      // and the best-effort order-details fetch don't depend on each other.
      const [, , orderDetails] = await Promise.all([
        DbApi.patch("shipments", row.id, { status: "Tendered", carrier: carrierName }),
        isMbol
          ? Promise.all(children.map((c) => DbApi.patch("shipments", c.id, { status: "Tendered", carrier: carrierName })))
          : Promise.resolve(),
        gatherOrderDetails(allLinkedOrders),
      ]);

      const origin = row.origin || "";
      const dest = row.dest || "";
      const refNum =
        "TND-" + String(row.id || "").replace(/^SHP-/i, "") + "-" + String(Math.floor(Math.random() * 9000 + 1000));

      // Build full route for subject (Origin → Stop1 → Stop2 → FinalDest)
      let routeDisplay = `${origin} → ${dest}`;
      if (isMbol && children.length) {
        const stops = [origin, ...children.map((c) => (c.dest || "").split(",")[0].trim()).filter(Boolean)];
        routeDisplay = stops.join(" → ");
      }

      const tenderPayload = {
        shipmentId: row.id,
        refNum,
        subject: `Load Tender: ${row.id} — ${routeDisplay}`,
        origin,
        dest,
        pickup: row.pickup_date || "",
        delivery: row.delivery_date || row.shipment_end_date || "",
        mode: row.mode || "",
        cost: row.total_cost ?? row.cost ?? "",
        weight: row.weight ?? "",
        pieces: row.pieces || "",
        commodity: row.commodity || row._commodity || "",
        specialInstructions: row.special_instructions || row.specialInstructions || row.notes || "",
        dockDoor: row.dock_door || "Door 1",
        dockTime: row.dock_time || "06:00–08:00",
        ...orderDetails,
        childShipments: isMbol ? children.map((c, i) => ({
          id: c.id,
          stop: i + 1,
          origin: c.origin || "",
          dest: c.dest || "",
          delivery: c.delivery_date || c.shipment_end_date || "",
          weight: c.weight || "",
          pieces: c.pieces || "",
        })) : [],
      };
      // Perf: fire-and-forget the email. Backend responds 202 after queueing;
      // we don't block the UI on SMTP. Result modal shows "queued" success;
      // a background failure is recorded in change_history (tender_failed).
      let emailSent = false;
      let emailTo = "";
      try {
        const result = await sendTenderEmailIfAvailable({
          carriers,
          carrierName,
          tenderPayload,
        });
        emailSent = !!result.sent;
        emailTo = result.to || "";
      } catch (emailErr) {
        console.warn("Tender email failed:", emailErr);
      }
      // Perf: refresh only shipments + orders (the tables this flow mutates),
      // not the full 14-table data set.
      await refreshTender();
      setTenderResult({ shipment: row, result: { refNum, emailSent, to: emailTo } });
    } catch (err) {
      setTenderResult({ shipment: row, result: { error: true, errorMessage: err.message } });
    } finally {
      setBusyId("");
    }
  }

  /* ── Accept Tender Modal ──
   *
   * The modal (TenderAcceptModal) owns its own form state. We just
   * track which shipment row is being edited; the modal hands back a
   * single payload via its onConfirm prop and confirmAcceptTender does
   * the DB patch + downstream propagation.
   */
  const [acceptModal, setAcceptModal] = useState(null); // { shipment } | null
  const [showNewShipment, setShowNewShipment] = useState(false);

  // Re-attach a date prefix to a "HH:mm" time input so we can write it
  // back into the loading_start / loading_end "YYYY-MM-DD HH:mm"
  // columns (migration 20260324120000_shipments_loading_times).
  function combineDateTime(date, time) {
    const d = String(date || "").trim();
    const t = String(time || "").trim();
    if (!d || !t) return "";
    return `${d} ${t}`;
  }

  function openAcceptTender(row) {
    setAcceptModal({ shipment: row });
  }

  async function confirmAcceptTender(formData) {
    if (!acceptModal) return;
    const row = acceptModal.shipment;
    const {
      driver, phone, truck,
      proNumber, carrierPickupDate, pickupEta, carrierNotes,
      serviceLevel, bolNumber, deliveryDate,
      dockDoor, dockLoadStart, dockLoadEnd, sealNumber, internalNotes,
    } = formData || {};

    if (!carrierPickupDate) { toast("Pickup date is required", "warning"); return; }
    setBusyId(row.id);
    try {
      // Build the addition for the [CP_RESPONSE] merge. Empty values
      // are dropped by mergeTenderResponse, so this never wipes a
      // carrier-supplied field the planner happens to leave blank.
      const responseAddition = {
        action: "accept",
        // Carrier-supplied
        driver: driver || "",
        phone: phone || "",
        truck: truck || "",
        proNumber: proNumber || "",
        carrierPickupDate: carrierPickupDate || "",
        pickupEta: pickupEta || "",
        // The carrier's own free-text "notes to shipper" lives here.
        notes: carrierNotes || "",
        // Planner-supplied
        serviceLevel: serviceLevel || "",
        bolNumber: bolNumber || "",
        deliveryDate: deliveryDate || "",
        dockDoor: dockDoor || "",
        dockLoadStart: dockLoadStart || "",
        dockLoadEnd: dockLoadEnd || "",
        sealNumber: sealNumber || "",
        internalNotes: internalNotes || "",
        respondedAtIso: new Date().toISOString(),
      };
      // 1. Update shipment in DB. Use canonical column names — see
      // 20260406_shipments_dock_fields (dock_door, dock_time) and
      // 20260324120000 (loading_start, loading_end). dock_time is kept
      // as the human-readable window string for display parity.
      const loadingStartFull = combineDateTime(carrierPickupDate, dockLoadStart);
      const loadingEndFull   = combineDateTime(carrierPickupDate, dockLoadEnd);
      await patchShipmentWithFallback(row.id, {
        status: "Tendered",
        pro_number: proNumber || null,
        pickup_date: carrierPickupDate || null,
        delivery_date: deliveryDate || null,
        service_level: serviceLevel || null,
        bol_number: bolNumber || null,
        dock_door: dockDoor || null,
        dock_time: dockLoadStart && dockLoadEnd ? `${dockLoadStart}–${dockLoadEnd}` : (dockLoadStart || null),
        loading_start: loadingStartFull || null,
        loading_end:   loadingEndFull   || null,
        // REQ-22: persist trailer seal on the shipment row.
        seal_number: sealNumber || null,
        notes: withMergedTenderNotes(row.notes, responseAddition),
      });
      // 1b. If MBOL, cascade Confirmed to child CBOLs
      if (row.bol_type === "MBOL") {
        const children = shipments.filter((s) => s.master_shipment_id === row.id && s.bol_type === "CBOL");
        await Promise.all(children.map((c) => DbApi.patch("shipments", c.id, { status: "Tendered" })));
      }
      // 2. Update linked orders (master + children)
      const linkedOrders = await confirmOrdersForShipment(row, shipments, orders);
      // 3. Propagate accept → OMS mirror (oms_orders) + WS broadcast.
      //    The service encapsulates both side-effects so the Shipments
      //    and Carrier-Portal accept paths cannot drift out of sync
      //    (see services/tenderAcceptanceNotifier.js).
      const propagation = await propagateTenderAcceptance({
        shipment: row,
        response: {
          proNumber: proNumber, carrierPickupDate: carrierPickupDate, serviceLevel: serviceLevel,
          bolNumber: bolNumber, sealNumber: sealNumber, dockDoor: dockDoor,
          dockLoadStart, dockLoadEnd,
          // Concatenate carrier and internal notes so the OMS mirror
          // sees both — keeps parity with the carrier-portal flow which
          // only emits a single `notes` field.
          notes: [carrierNotes, internalNotes].filter(Boolean).join(" · "),
        },
        orderIds: linkedOrders.map((o) => o.id),
      });
      // REQ-24 toast: honest tender-accept feedback. `sent` is true only
      // when at least one oms_orders row actually updated. When skipped
      // for a non-benign reason (column_missing / table_missing /
      // permission_denied) — typically migration 023 not applied — warn
      // the ops user that the OMS mirror did NOT update.
      const omsResult = propagation.omsResult;
      if (propagation.omsError || !omsResult) {
        toast(`✅ Tender confirmed — ${row.id} · PRO: ${proNumber || "pending"} · Pickup: ${carrierPickupDate} · OMS push failed (non-blocking)`, "success");
      } else {
        const benignSkipReasons = new Set(["no_oms_row"]);
        const skipReasons = omsResult.omsSync && omsResult.omsSync.skippedByReason
          ? Object.keys(omsResult.omsSync.skippedByReason)
          : [];
        const hasBadSkip = skipReasons.some((r) => !benignSkipReasons.has(r));
        if (omsResult.sent) {
          toast(`✅ Tender confirmed & sent to OMS — ${row.id}`, "success");
        } else if (hasBadSkip) {
          toast(
            `⚠ Tender confirmed locally — ${row.id} · OMS sync FAILED (${skipReasons.join(", ")}). Shipment info did not reach OMS. ${omsResult.message || ""}`,
            "warning"
          );
        } else {
          toast(`✅ Tender confirmed — ${row.id} · PRO: ${proNumber || "pending"} · Pickup: ${carrierPickupDate} · OMS: ${omsResult.message || "not configured"}`, "success");
        }
      }
      setAcceptModal(null);
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function rejectTender(row) {
    if (!window.confirm(`Reject tender for ${row.id}? Shipment will return to Planned.`)) return;
    setBusyId(row.id);
    try {
      await DbApi.patch("shipments", row.id, { status: "Planned" });
      // If MBOL, cascade reject to child CBOLs
      if (row.bol_type === "MBOL") {
        const children = shipments.filter((s) => s.master_shipment_id === row.id && s.bol_type === "CBOL");
        await Promise.all(children.map((c) => DbApi.patch("shipments", c.id, { status: "Planned" })));
      }
      toast(`Tender rejected for ${row.id}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function withdrawTender(row) {
    if (!window.confirm(`Withdraw tender for ${row.id}?`)) return;
    setBusyId(row.id);
    try {
      await DbApi.patch("shipments", row.id, { status: "Planned" });
      // If MBOL, cascade withdraw to child CBOLs
      if (row.bol_type === "MBOL") {
        const children = shipments.filter((s) => s.master_shipment_id === row.id && s.bol_type === "CBOL");
        await Promise.all(children.map((c) => DbApi.patch("shipments", c.id, { status: "Planned" })));
      }
      toast(`Tender withdrawn for ${row.id}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function handleCreateShipment(formData) {
    try {
      const shipment = await createShipment(formData);
      toast(`Shipment ${shipment.id} created`, "success");
      setShowNewShipment(false);
      await refreshData();
    } catch (err) {
      toast(`Failed to create shipment: ${err.message}`, "error");
    }
  }

  async function handleCopyShipment(sourceShipment) {
    if (!window.confirm(`Copy shipment ${sourceShipment.id}? A new shipment will be created with the same details.`)) return;
    setBusyId(sourceShipment.id);
    try {
      const copy = await copyShipment(sourceShipment);
      toast(`Shipment copied as ${copy.id}`, "success");
      await refreshData();
    } catch (err) {
      toast(`Failed to copy: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  async function deleteShipment(row) {
    if (effectiveShipmentStatus(row) === "Tendered") {
      toast("Withdraw tender first before deleting", "warning");
      return;
    }
    if (!window.confirm(`Delete shipment ${row.id}? Linked orders will be unplanned.`)) return;
    setBusyId(row.id);
    try {
      await unplanOrdersForShipmentRemoval(row, shipments, orders);
      await deleteShipmentById(row.id);
      // If CBOL, check if MBOL has remaining children
      if (row.bol_type === "CBOL" && row.master_shipment_id) {
        const siblingCbols = shipments.filter((s) => s.master_shipment_id === row.master_shipment_id && s.id !== row.id);
        if (siblingCbols.length === 0) {
          await deleteShipmentById(row.master_shipment_id);
          toast(`Shipment ${row.id} and master ${row.master_shipment_id} deleted`, "success");
        } else {
          toast(`Shipment ${row.id} deleted`, "success");
        }
      } else {
        toast(`Shipment ${row.id} deleted, ${(row._linkedOrders || []).length} orders unplanned`, "success");
      }
      await refreshData();
    } catch (err) {
      toast(`Failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  const statusCounts = useMemo(() => {
    const c = { All: shipments.length };
    shipments.forEach((s) => {
      const st = effectiveShipmentStatus(s);
      c[st] = (c[st] || 0) + 1;
    });
    return c;
  }, [shipments]);

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "▲" : "▼") : "⇅"}
    </span>
  );

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Shipments</div>
          <div className="page-sub">Plan, track, and manage all freight movements</div>
        </div>
        <div className="header-actions">
          <ExportButton
            entity="shipments"
            rows={rows}
            selectedRows={sel.selectedRows(rows)}
            label="Export Shipments"
          />
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewShipment(true)}>+ New Shipment</button>
        </div>
      </div>
      <div className="page-content">

      {/* View Toggle */}
      <div style={{ display: "flex", gap: 2, marginBottom: 16, background: "#f0f4ff", borderRadius: 10, padding: 3, border: "1px solid rgba(59,130,246,.15)", width: "fit-content" }}>
        <button
          style={{ padding: "5px 14px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s", fontFamily: "inherit", background: shipView === "list" ? "var(--accent)" : "transparent", color: shipView === "list" ? "#fff" : "var(--text3)" }}
          onClick={() => setShipView("list")}
        >List</button>
        <button
          style={{ padding: "5px 14px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s", fontFamily: "inherit", background: shipView === "map" ? "var(--accent)" : "transparent", color: shipView === "map" ? "#fff" : "var(--text3)" }}
          onClick={() => setShipView("map")}
        >Map View</button>
      </div>

      {shipView === "list" ? (<>
      {/* Filters */}
      <div className="filter-bar">
        <input
          placeholder="🔍 Search shipments... or SHP-1..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="search"
        />
        <select className="fsel" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {["All", "Planned", "Tendered", "Tender Rejected", "Tender Accepted", "In Transit", "Delivered", "Cancelled"].map((s) => (
            <option key={s} value={s}>{s === "All" ? "ALL STATUSES" : s} {statusCounts[s] ? `(${statusCounts[s]})` : ""}</option>
          ))}
        </select>
        <select className="fsel" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
          <option value="All">All Modes</option>
          <option value="LTL">LTL</option>
          <option value="TL">TL</option>
        </select>
        <LocationFilter side="from" value={shipFromFilter} onChange={setShipFromFilter} />
        <LocationFilter side="to"   value={shipToFilter}   onChange={setShipToFilter} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)" }}>Created From</span>
        <input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }} />
        <span style={{ fontSize: 12, color: "var(--text3)" }}>To</span>
        <input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }} />
        {(createdFrom || createdTo || shipFromFilter || shipToFilter) && (
          <button onClick={() => { setCreatedFrom(""); setCreatedTo(""); setShipFromFilter(""); setShipToFilter(""); }} style={{ fontSize: 11, color: "#dc2626", background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.2)", borderRadius: 16, padding: "3px 10px", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>✕ Clear Filters</button>
        )}
      </div>

      {/* Toast */}
      {message.text && (
        <div className={`toast toast-${message.type}`} style={{ marginBottom: 12 }}>
          {message.text}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ padding: 0 }}><div className="table-wrap">
      <SelectionBar count={sel.size} entityLabel="Shipment" onClear={sel.clear} />
      <table className="grid" style={{ border: "none", boxShadow: "none" }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}>
              <SelectionHeaderCheckbox sel={sel} rows={rows.filter((s) => s.bol_type !== "CBOL")} />
            </th>
            <th onClick={() => toggleSort("id")}>Shipment ID <SortIcon col="id" /></th>
            <th onClick={() => toggleSort("origin")}>Origin <SortIcon col="origin" /></th>
            <th onClick={() => toggleSort("dest")}>Destination <SortIcon col="dest" /></th>
            <th>Mode</th>
            <th onClick={() => toggleSort("carrier")}>Carrier <SortIcon col="carrier" /></th>
            <th>Est. Cost</th>
            <th>Pickup</th>
            <th>Delivery</th>
            <th onClick={() => toggleSort("status")}>Status <SortIcon col="status" /></th>
            <th title="OMS sync — did the tender-accept reach the OMS mirror?">OMS</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={12} className="empty-state">No shipments found</td></tr>
          ) : rows.filter((s) => s.bol_type !== "CBOL").map((s) => (<React.Fragment key={s.id}>
            <tr>
              <td onClick={(e) => e.stopPropagation()}>
                <SelectionRowCheckbox sel={sel} rowKey={s.id} />
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {s.bol_type === "MBOL" && <span className="badge badge-blue" style={{ fontSize: 9, padding: "0 6px", height: 18, lineHeight: "18px" }}>MBOL</span>}
                  <a href="#" onClick={(e) => { e.preventDefault(); setDetailShipment(s); }}
                     className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>
                    {s.id}
                  </a>
                </div>
              </td>
              <td className="text-sm">
                {s.ship_from_name && (
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{s.ship_from_name}</div>
                )}
                <div style={{ color: s.ship_from_name ? "var(--text3)" : "inherit" }}>{s.origin || "—"}</div>
              </td>
              <td className="text-sm">
                {s.ship_to_name && (
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{s.ship_to_name}</div>
                )}
                <div style={{ color: s.ship_to_name ? "var(--text3)" : "inherit" }}>{s.dest || "—"}</div>
              </td>
              <td>
                <span className={`badge ${s.mode === "LTL" ? "badge-blue" : "badge-green"}`}>
                  {s.mode || "—"}
                </span>
                {s.equipment && (
                  <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                    {s.equipment}
                  </div>
                )}
              </td>
              <td>
                {s.czarlite_rate && <span className="badge badge-purple" style={{ marginRight: 4, fontSize: 9 }}>CzarLite</span>}
                {s._carrier || "—"}
              </td>
              <td className="mono fw-700">${(s.total_cost || 0).toLocaleString()}</td>
              <td className="mono text-sm">{s.pickup_date || "—"}</td>
              <td className="mono text-sm">{s.delivery_date || "—"}</td>
              <td>
                <span className={STATUS_BADGES[s._displayStatus] || "badge badge-blue"}>
                  {s._displayStatus || "—"}
                </span>
              </td>
              <td>
                <OmsSyncPill
                  {...deriveOmsSyncStatus(
                    omsSyncByShipment.get(String(s.id)) || [],
                    { ...s, status: s._displayStatus || s.status }
                  )}
                />
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                {["Planned", "Tender Rejected"].includes(s._displayStatus) && (
                  <button
                    style={{ background: "#2563eb", color: "#fff", borderColor: "#2563eb", padding: "4px 10px", fontSize: 12, borderRadius: 6, fontWeight: 700, cursor: "pointer", border: "none" }}
                    disabled={busyId === s.id}
                    onClick={() => onTender(s)}
                  >
                    📤 Tender
                  </button>
                )}
                {s._displayStatus === "Tendered" && (<>
                  <button
                    style={{ background: "#16a34a", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    disabled={busyId === s.id}
                    onClick={() => openAcceptTender(s)}
                  >
                    ✅ Accept
                  </button>
                  <button
                    style={{ background: "#dc2626", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    disabled={busyId === s.id}
                    onClick={() => rejectTender(s)}
                  >
                    ❌ Reject
                  </button>
                  <button
                    style={{ background: "rgba(245,158,11,.08)", color: "#b45309", border: "1px solid rgba(245,158,11,.35)", padding: "4px 10px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                    disabled={busyId === s.id}
                    onClick={() => withdrawTender(s)}
                  >
                    ↩ Withdraw
                  </button>
                </>)}
                {s._displayStatus === "Tender Accepted" && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--green)" }}>✅ Tender Accepted</span>
                )}
                <button
                  title="Copy Shipment"
                  style={{ background: "rgba(59,130,246,.08)", color: "#2563eb", border: "1px solid rgba(59,130,246,.25)", padding: "4px 7px", borderRadius: 6, fontSize: 12, cursor: "pointer", lineHeight: 1 }}
                  disabled={busyId === s.id}
                  onClick={() => handleCopyShipment(s)}
                >
                  📋
                </button>
                <button
                  title="Delete Shipment"
                  style={{ background: "rgba(220,38,38,.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,.25)", padding: "4px 7px", borderRadius: 6, fontSize: 12, cursor: "pointer", lineHeight: 1 }}
                  disabled={busyId === s.id}
                  onClick={() => deleteShipment(s)}
                >
                  🗑️
                </button>
                </div>
              </td>
            </tr>
            {/* CBOL sub-rows for MBOL shipments */}
            {s.bol_type === "MBOL" && rows.filter((c) => c.bol_type === "CBOL" && c.master_shipment_id === s.id).map((c) => (
              <tr key={c.id} style={{ background: "#f8faff", fontSize: 11 }}>
                <td colSpan={12} style={{ padding: "4px 16px 4px 40px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "nowrap" }}>
                    <span className="badge badge-teal" style={{ fontSize: 8, padding: "0 5px", height: 16, lineHeight: "16px" }}>CBOL</span>
                    <a href="#" onClick={(e) => { e.preventDefault(); setDetailShipment(c); }} className="mono" style={{ color: "var(--accent)", fontWeight: 600, fontSize: 11 }}>{c.id}</a>
                    <span style={{ color: "var(--text3)" }}>→</span>
                    <span style={{ fontWeight: 600 }}>{(c.dest || "").split(",")[0]}</span>
                    <span className="mono" style={{ fontWeight: 700 }}>${(c.total_cost || 0).toLocaleString()}</span>
                    <span className="mono" style={{ color: "var(--text3)" }}>{c.pickup_date || "—"}</span>
                    <span className="mono" style={{ color: "var(--text3)" }}>{c.delivery_date || "—"}</span>
                    <span className={STATUS_BADGES[c._displayStatus] || "badge"} style={{ fontSize: 9 }}>{c._displayStatus}</span>
                    <OmsSyncPill
                      {...deriveOmsSyncStatus(
                        omsSyncByShipment.get(String(c.id)) || [],
                        { ...c, status: c._displayStatus || c.status }
                      )}
                    />

                    {["Planned", "Tender Rejected"].includes(c._displayStatus) && (
                      <button style={{ background: "#2563eb", color: "#fff", border: "none", padding: "2px 8px", borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: "pointer" }} disabled={busyId === c.id} onClick={() => onTender(c)}>📤 Tender</button>
                    )}
                    <button style={{ background: "rgba(220,38,38,.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,.25)", padding: "2px 5px", borderRadius: 5, fontSize: 10, cursor: "pointer", lineHeight: 1, marginLeft: "auto" }} disabled={busyId === c.id} onClick={() => deleteShipment(c)}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </React.Fragment>))}
        </tbody>
      </table>
      </div></div>{/* end table-wrap, card */}
      <div className="text-sm text-muted mt-2">{rows.length} of {shipments.length} shipments</div>
      </>) : (
        /* ═══ MAP VIEW ═══ */
        <div>
          {/* Legend */}
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6" }} />In Transit</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />Exception</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />Delivered</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />Planned / Tendered</div>
          </div>
          {/* Map Container */}
          <div className="card" style={{ padding: 16, minHeight: 500, position: "relative", overflow: "hidden" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
              US map with top lanes by volume (grouped by origin/destination state)
              {getHereApiKey()
                ? " · HERE basemap (Raster Tile API v3)"
                : " · HERE basemap — add VITE_HERE_API_KEY to frontend/.env (same key as developer.here.com)"}
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", height: 460 }}>
              <MapContainer
                center={[39.5, -98.35]}
                zoom={4}
                minZoom={3}
                maxZoom={6}
                maxBounds={[[22, -130], [52, -64]]}
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://developer.here.com">HERE</a>'
                  url={hereRasterTileUrl(resolveHereApiKey())}
                />
                {laneRoutes.filter((lane) => lane.hasCoords).map((lane) => {
                  const width = Math.min(8, 2 + lane.count * 0.55);
                  return (
                    <Polyline
                      key={lane.key}
                      positions={[lane.originCoord, lane.destCoord]}
                      pathOptions={{ color: lane.color, weight: width, opacity: 0.62 }}
                    >
                      <Tooltip sticky>{`${lane.from} → ${lane.to} (${lane.count})`}</Tooltip>
                    </Polyline>
                  );
                })}
                {laneRoutes.filter((lane) => lane.hasCoords).flatMap((lane) => ([
                  <CircleMarker
                    key={`${lane.key}-o`}
                    center={lane.originCoord}
                    radius={4}
                    pathOptions={{ color: "#ffffff", weight: 1, fillColor: lane.color, fillOpacity: 1 }}
                  />,
                  <CircleMarker
                    key={`${lane.key}-d`}
                    center={lane.destCoord}
                    radius={4}
                    pathOptions={{ color: "#ffffff", weight: 1, fillColor: lane.color, fillOpacity: 1 }}
                  />,
                ]))}
              </MapContainer>
            </div>
            {/* Shipment summary cards below map */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginTop: 16 }}>
              {rows.slice(0, 12).map((s) => {
                const col = s._displayStatus === "In Transit" ? "var(--accent)" : s._displayStatus === "Exception" ? "var(--red)" : s._displayStatus === "Delivered" ? "var(--green)" : "var(--yellow)";
                return (
                  <div key={s.id} style={{ padding: "10px 14px", border: "1.5px solid var(--border)", borderRadius: 10, cursor: "pointer", borderLeft: `3px solid ${col}` }}
                    onClick={() => setDetailShipment(s)}>
                    <div className="mono" style={{ fontWeight: 700, color: "var(--accent)", fontSize: 12 }}>{s.id}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{s.origin} → {s.dest}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
                      <span className={STATUS_BADGES[s._displayStatus] || "badge badge-blue"} style={{ fontSize: 10 }}>{s._displayStatus}</span>
                      <span className="mono" style={{ fontWeight: 700 }}>${(s.total_cost || 0).toLocaleString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Shipment Detail Modal */}
      {detailShipment && <ShipmentDetailModal ds={detailShipment} onClose={() => setDetailShipment(null)} onTender={onTender} onWithdraw={(s) => { withdrawTender(s); setDetailShipment(null); }} onUnassign={unassignOrder} onNavigate={navigate} STATUS_BADGES={STATUS_BADGES} shipments={shipments} onChangeCarrier={() => { setDetailShipment(null); refreshData(); }} onShipmentPatched={(patch) => { setDetailShipment((prev) => prev ? { ...prev, ...patch } : prev); refreshData(); }} />}

      {/* Tender Result Modal */}
      <TenderResultModal
        isOpen={!!tenderResult}
        shipment={tenderResult?.shipment}
        result={tenderResult?.result}
        onClose={() => setTenderResult(null)}
        onViewShipment={(id) => {
          const ship = shipments.find((s) => s.id === id);
          if (ship) {
            const linked = orders.filter((o) => String(o.shipment_id || "") === String(id));
            setDetailShipment({ ...ship, _linkedOrders: linked, _carrier: ship.carrier || "" });
          }
        }}
      />

      {/* Accept Tender Modal — see components/shipments/TenderAcceptModal.
       * Two tabs (Carrier Response + Internal Plan) so the planner can
       * review what the carrier submitted via the carrier portal AND
       * record their internal dock plan in one place. The modal owns
       * its own form state; we just receive the merged payload here. */}
      {acceptModal && (
        <TenderAcceptModal
          shipment={acceptModal.shipment}
          busy={busyId === acceptModal.shipment.id}
          onClose={() => setAcceptModal(null)}
          onConfirm={confirmAcceptTender}
        />
      )}

      {/* New Shipment Modal */}
      {showNewShipment && (
        <NewShipmentModal
          carriers={carriers}
          equipmentTypes={equipmentTypes}
          onSave={handleCreateShipment}
          onClose={() => setShowNewShipment(false)}
        />
      )}

      </div>{/* end page-content */}
    </div>
  );
}
