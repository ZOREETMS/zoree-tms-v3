import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { DbApi, OrdersApi, BulkPlanApi, MileageApi } from "../lib/api";
import OrderLinesEditor from "../components/OrderLinesEditor";

const STATUS_BADGES = {
  Unplanned: "badge badge-amber",
  Planned: "badge badge-teal",
  Consolidated: "badge badge-blue",
  Tendered: "badge badge-purple",
  "In Transit": "badge badge-blue",
  Delivered: "badge badge-green",
  Cancelled: "badge badge-red",
};

const STATUS_ROW_COLORS = {
  Unplanned:    { bg: "#fffef0", border: "#ca8a04" },
  Planned:      { bg: "#f0fdf4", border: "#16a34a" },
  Consolidated: { bg: "#eff6ff", border: "#2563eb" },
  Tendered:     { bg: "#fffbeb", border: "#d97706" },
  "In Transit": { bg: "#f0f9ff", border: "#0284c7" },
  Delivered:    { bg: "#f0fdf4", border: "#059669" },
  Exception:    { bg: "#fef2f2", border: "#dc2626" },
  Cancelled:    { bg: "#f9fafb", border: "#9ca3af" },
};
const SPOT_ROW_STYLE = { background: "#fef2f2", borderLeft: "3px solid #dc2626" };

const EQUIPMENT_TYPES = {
  "Dry Van 53'":    { maxWeight: 44000, icon: "🚛" },
  "Flatbed":        { maxWeight: 48000, icon: "🏗️" },
  "Reefer 53'":     { maxWeight: 43500, icon: "❄️" },
  "Step Deck":      { maxWeight: 48000, icon: "📦" },
  "Lowboy":         { maxWeight: 80000, icon: "⚙️" },
  "Tanker":         { maxWeight: 46000, icon: "🛢️" },
  "LTL Truck":      { maxWeight: 15000, icon: "📬" },
  "Intermodal 53'": { maxWeight: 44000, icon: "🚂" },
};
const DEFAULT_EQUIP = "Dry Van 53'";
const LTL_MAX_WEIGHT = 15000;


function SdField({ icon, label, value }) {
  const display = value === null || value === undefined || value === "" ? "\u2014" : value;
  const isEmpty = display === "\u2014";
  return (
    <div className="sd-field">
      <div className="sd-field-label">{icon} {label}</div>
      <div className={`sd-field-value${isEmpty ? " empty" : ""}`}>{display}</div>
    </div>
  );
}

function fmt$(n) {
  return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function constraintBadges(o) {
  const badges = [];
  if (o.noConsolidate) badges.push({ label: "🚫 Solo", bg: "rgba(220,38,38,.1)", color: "#dc2626", border: "rgba(220,38,38,.25)" });
  if (o.dedicatedEquip) badges.push({ label: "🚛 Dedicated", bg: "rgba(217,119,6,.1)", color: "#d97706", border: "rgba(217,119,6,.25)" });
  if (o.hazmat) badges.push({ label: "☢️ Hazmat", bg: "rgba(220,38,38,.1)", color: "#dc2626", border: "rgba(220,38,38,.25)" });
  if (o.preferredCarrier) badges.push({ label: `📌 ${String(o.preferredCarrier).split(" ")[0]}`, bg: "rgba(59,130,246,.1)", color: "#3b82f6", border: "rgba(59,130,246,.25)" });
  if (o.excludedCarrier) badges.push({ label: `⛔ No ${String(o.excludedCarrier).split(" ")[0]}`, bg: "rgba(107,114,128,.1)", color: "#6b7280", border: "rgba(107,114,128,.25)" });
  return badges;
}

export default function OrdersPage() {
  const { orders, shipments, carriers, setData, refreshData, routeTemplates } = useOutletContext();
  const [itemMaster, setItemMaster] = useState([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [customerFilter, setCustomerFilter] = useState("All");
  const [readyFrom, setReadyFrom] = useState("");
  const [readyTo, setReadyTo] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [sortCol, setSortCol] = useState("id");
  const [sortAsc, setSortAsc] = useState(false);



  /* ── Scheduler state ── */
  const [schedRunning, setSchedRunning] = useState(false);
  const [schedInterval, setSchedIntervalVal] = useState(10);
  const [schedCountdown, setSchedCountdown] = useState("--:--");
  const [schedRuns, setSchedRuns] = useState(0);
  const [schedPlanned, setSchedPlanned] = useState(0);
  const [schedSaved, setSchedSaved] = useState(0);
  const [schedLog, setSchedLog] = useState(["Scheduler not started."]);
  const schedTimerRef = useRef(null);
  const schedCdRef = useRef(null);
  const schedSecsLeft = useRef(0);

  /* ── Order Detail Modal state ── */
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailLines, setDetailLines] = useState([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailTab, setDetailTab] = useState("view");
  const [editForm, setEditForm] = useState({});
  const [searchParams, setSearchParams] = useSearchParams();

  // Auto-open order detail from URL ?id=ORD-xxxx
  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam && orders.length > 0) {
      const order = orders.find((o) => o.id === idParam);
      if (order) {
        openDetail(order.id);
        setSearchParams({}, { replace: true });
      }
    }
  }, [orders, searchParams]);
  const [editUser, setEditUser] = useState("Sridhar (Dispatcher)");
  const [editStatus, setEditStatus] = useState("");
  const [orderChangeLog, setOrderChangeLog] = useState({}); // {orderId: [{ts, user, changes}]}
  const DEMO_USERS = ["Sridhar (Dispatcher)", "Tulasi (Admin)", "System (Auto)"];

  // Auto-sync weight/pieces from line items into edit form
  useEffect(() => {
    if (detailTab === "edit" && detailLines.length > 0) {
      const totalWeight = Math.round(detailLines.reduce((s, l) => s + (parseFloat(l.total_weight ?? l.totalWt) || 0), 0) * 10000) / 10000;
      const totalPieces = detailLines.reduce((s, l) => s + (parseInt(l.qty_ordered ?? l.qty) || 0), 0);
      setEditForm((f) => ({ ...f, weight: totalWeight || f.weight, pieces: totalPieces || f.pieces }));
    }
  }, [detailLines, detailTab]);

  /* ── New Order Modal state ── */
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [newOrderForm, setNewOrderForm] = useState({
    customer: "", originCity: "", originState: "", originZip: "",
    destCity: "", destState: "", destZip: "", commodity: "", incoterms: "",
    ready: "", due: "", preferredCarrier: "", excludedCarrier: "",
    noConsolidate: false, dedicatedEquip: false, hazmat: false,
  });
  const [newOrderLines, setNewOrderLines] = useState([]);

  /* ── Plan Confirmation Modal state ── */
  const [planModal, setPlanModal] = useState(null);
  const [planSummary, setPlanSummary] = useState(null); // after shipment creation

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 5000);
  }

  /* ── Customer list ── */
  const customers = useMemo(() => {
    const set = new Set();
    orders.forEach((o) => { if (o.customer) set.add(o.customer); });
    return Array.from(set).sort();
  }, [orders]);

  /* ── Filter + sort ── */
  const rows = useMemo(() => {
    let filtered = orders;
    if (statusFilter !== "All") filtered = filtered.filter((o) => o.status === statusFilter);
    if (customerFilter !== "All") filtered = filtered.filter((o) => o.customer === customerFilter);
    if (readyFrom) filtered = filtered.filter((o) => (o.ready || "") >= readyFrom);
    if (readyTo) filtered = filtered.filter((o) => (o.ready || "") <= readyTo);
    if (dueFrom) filtered = filtered.filter((o) => (o.due || "") >= dueFrom);
    if (dueTo) filtered = filtered.filter((o) => (o.due || "") <= dueTo);
    if (q.trim()) {
      // Support comma-separated search: "ORD-546192, ORD-2024-009" matches either
      const terms = q.split(",").map((s) => {
        let t = s.toLowerCase().trim();
        t = t.replace(/^order\s*/i, "ord-").replace(/^ord\s+/i, "ord-").replace(/^shp\s+/i, "shp-");
        return t;
      }).filter(Boolean);
      if (terms.length > 0) {
        filtered = filtered.filter((o) =>
          terms.some((t) =>
            [o.id, o.customer, o.origin, o.dest, o.commodity, o.shipment_id]
              .some((v) => String(v || "").toLowerCase().includes(t))
          )
        );
      }
    }
    // Sort: when sorting by default (id), group Unplanned first by lane; otherwise sort purely by chosen column
    return [...filtered].sort((a, b) => {
      // Only do Unplanned-first grouping when sorting by default column (id)
      if (sortCol === "id") {
        if (a.status === "Unplanned" && b.status !== "Unplanned") return -1;
        if (b.status === "Unplanned" && a.status !== "Unplanned") return 1;
        const ka = `${a.origin}||${a.dest}`;
        const kb = `${b.origin}||${b.dest}`;
        if (a.status === "Unplanned" && ka !== kb) return ka.localeCompare(kb);
      }
      // Apply user-chosen column sort
      const av = String(a[sortCol] || "").replace(/[$%,\s]|lbs/gi, "");
      const bv = String(b[sortCol] || "").replace(/[$%,\s]|lbs/gi, "");
      const an = parseFloat(av), bn = parseFloat(bv);
      const cmp = (!isNaN(an) && !isNaN(bn)) ? (an - bn) : av.toLowerCase().localeCompare(bv.toLowerCase(), undefined, { numeric: true, sensitivity: "base" });
      return sortAsc ? cmp : -cmp;
    });
  }, [orders, q, statusFilter, customerFilter, readyFrom, readyTo, dueFrom, dueTo, sortCol, sortAsc]);

  /* ── Lane groups for unplanned orders ── */
  const laneGroups = useMemo(() => {
    const map = {};
    rows.forEach((o) => {
      if (o.status !== "Unplanned") return;
      const key = `${o.origin}||${o.dest}`;
      if (!map[key]) map[key] = { orders: [], totalWeight: 0, totalPieces: 0, origin: o.origin, dest: o.dest };
      map[key].orders.push(o.id);
      map[key].totalWeight += Number(o.weight || 0);
      map[key].totalPieces += Number(o.pieces || 0);
    });
    return map;
  }, [rows]);

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  function toggleSelect(id) {
    setSelectedOrders((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    if (selectedOrders.size === rows.length) setSelectedOrders(new Set());
    else setSelectedOrders(new Set(rows.map((o) => o.id)));
  }

  function clearFilters() {
    setStatusFilter("All"); setCustomerFilter("All"); setQ("");
    setReadyFrom(""); setReadyTo(""); setDueFrom(""); setDueTo("");
  }
  const hasFilters = statusFilter !== "All" || customerFilter !== "All" || q || readyFrom || readyTo || dueFrom || dueTo;

  /* ── Actions ── */
  async function cancelOrder(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    if (o.status !== "Unplanned") { toast("Only Unplanned orders can be cancelled", "warning"); return; }
    if (!window.confirm(`Cancel order ${id}?`)) return;
    setBusyId(id);
    try {
      await DbApi.patch("orders", id, { status: "Cancelled", notes: (o.notes ? o.notes + " | " : "") + "CANCELLED: Manual user action (" + new Date().toLocaleDateString() + ")" });
      toast(`🚫 Order ${id} cancelled`, "warning");
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  async function deleteOrder(id) {
    if (!window.confirm(`Permanently delete order ${id}?`)) return;
    setBusyId(id);
    try {
      await DbApi.patch("orders", id, { status: "Cancelled" });
      toast(`Order ${id} deleted`, "success");
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  async function unplanOrder(id) {
    if (!window.confirm(`Unplan order ${id}?`)) return;
    setBusyId(id);
    try {
      const order = orders.find((o) => o.id === id);
      const shipmentId = order?.shipment_id;
      await DbApi.patch("orders", id, { status: "Unplanned", shipment_id: null });

      // Clean up shipment if no orders remain
      if (shipmentId) {
        const remainingOrders = orders.filter((o) => o.shipment_id === shipmentId && o.id !== id);
        if (remainingOrders.length === 0) {
          // Delete the shipment (and its master if this was the last CBOL)
          const ship = shipments.find((s) => s.id === shipmentId);
          await DbApi.remove("shipments", shipmentId).catch(() => {});
          // If it was a CBOL, check if the MBOL has any remaining CBOLs
          if (ship?.master_shipment_id) {
            const siblingCbols = shipments.filter((s) => s.master_shipment_id === ship.master_shipment_id && s.id !== shipmentId);
            if (siblingCbols.length === 0) {
              await DbApi.remove("shipments", ship.master_shipment_id).catch(() => {});
              toast(`Order ${id} unplanned. Shipment ${shipmentId} and master ${ship.master_shipment_id} deleted.`, "success");
            } else {
              toast(`Order ${id} unplanned. Shipment ${shipmentId} deleted.`, "success");
            }
          } else {
            toast(`Order ${id} unplanned. Shipment ${shipmentId} deleted.`, "success");
          }
        } else {
          toast(`Order ${id} unplanned`, "success");
        }
      } else {
        toast(`Order ${id} unplanned`, "success");
      }
      await refreshData();
    } catch (err) { toast(`Failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  /* ── Open Order Detail Modal ── */
  async function openDetail(orderId) {
    const o = orders.find((x) => x.id === orderId);
    setDetailOrder(o);
    setDetailTab("view");
    setEditStatus("");
    // Pre-populate edit form
    if (o) {
      const parseCity = (str) => {
        if (!str) return { city: "", state: "", zip: "" };
        let s = str; let zip = ""; const m = s.match(/(\d{5})/); if (m) { zip = m[1]; s = s.replace(m[1], "").replace(/,?\s*$/, "").trim(); }
        const parts = s.split(","); return { city: (parts[0] || "").trim(), state: (parts[1] || "").trim(), zip };
      };
      const op = parseCity(o.origin || ""); const dp = parseCity(o.dest || "");
      setEditForm({
        customer: o.customer || "", status: o.status || "Unplanned",
        refNum: o.ref_num || o.refNum || "", poNum: o.po_num || o.poNum || "",
        originCity: op.city, originState: op.state, originZip: o.origin_zip || op.zip || cityZipLookup(o.origin) || "",
        destCity: dp.city, destState: dp.state, destZip: o.dest_zip || dp.zip || cityZipLookup(o.dest) || "",
        weight: o.weight || "", pieces: o.pieces || "", shipMode: o.ship_mode || o.shipMode || "",
        commodity: o.commodity || "", incoterms: o.incoterms || "", equipment: o.equipment || "",
        ready: o.ready || "", due: o.due || "", notes: o.notes || "",
      });
    }
    setDetailBusy(true);
    try {
      const full = await OrdersApi.full(orderId);
      setDetailLines(Array.isArray(full?.lines) ? full.lines : []);
    } catch { setDetailLines([]); }
    finally { setDetailBusy(false); }
  }

  async function saveLines() {
    if (!detailOrder) return;
    setDetailBusy(true);
    try {
      await OrdersApi.saveLines(detailOrder.id, detailLines);
      toast(`Saved lines for ${detailOrder.id}`, "success");
      await refreshData();
      // Re-fetch order+lines so the Details tab header shows updated weight/pieces
      const full = await OrdersApi.full(detailOrder.id);
      if (full) {
        setDetailOrder(full);
        setDetailLines(Array.isArray(full.lines) ? full.lines : []);
      }
    } finally { setDetailBusy(false); }
  }

  /* ── Save Order Edit ── */
  async function saveOrderEdit() {
    if (!detailOrder) return;
    const o = detailOrder;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const changes = [];
    function chk(field, oldVal, newVal, label) {
      const ov = String(oldVal || "").trim(); const nv = String(newVal || "").trim();
      if (ov !== nv) changes.push({ field, label, old: ov, new: nv });
    }
    const f = editForm;
    const newOrigin = [f.originCity, f.originState?.toUpperCase()].filter(Boolean).join(", ") + (f.originZip ? " " + f.originZip : "");
    const newDest = [f.destCity, f.destState?.toUpperCase()].filter(Boolean).join(", ") + (f.destZip ? " " + f.destZip : "");
    chk("customer", o.customer, f.customer, "Customer");
    chk("status", o.status, f.status, "Status");
    chk("origin", o.origin, newOrigin, "Origin");
    chk("dest", o.dest, newDest, "Destination");
    chk("weight", o.weight, f.weight, "Weight");
    chk("pieces", o.pieces, f.pieces, "Pieces");
    chk("ship_mode", o.ship_mode || o.shipMode || "", f.shipMode, "Ship Mode");
    chk("commodity", o.commodity, f.commodity, "Commodity");
    chk("ready", o.ready, f.ready, "Ready Date");
    chk("due", o.due, f.due, "Due Date");
    chk("notes", o.notes || "", f.notes, "Notes");

    setDetailBusy(true);
    try {
      // Build patch with all editable fields
      const patch = {
        customer: f.customer || null, status: f.status || null,
        origin: newOrigin || null, dest: newDest || null,
        weight: parseFloat(f.weight) || 0, pieces: parseInt(f.pieces) || 0,
        commodity: f.commodity || null,
        ready: f.ready || null, due: f.due || null,
      };
      // Conditionally add optional columns (may not exist in all schemas)
      if (f.originZip) patch.origin_zip = f.originZip;
      if (f.destZip) patch.dest_zip = f.destZip;
      patch.notes = f.notes || null;
      // Weight and pieces are taken directly from the form — user's input always wins.
      // Line items display their own totals separately for reference.
      await DbApi.patch("orders", o.id, patch);
      // Log to history (only if changes detected)
      if (changes.length > 0) {
        setOrderChangeLog((prev) => ({
          ...prev,
          [o.id]: [{ ts: now, user: editUser, changes, orderId: o.id }, ...(prev[o.id] || [])],
        }));
      }
      toast(`Saved changes to ${o.id}`, "success");
      await refreshData();
      // Update detailOrder with new data
      const updated = orders.find((x) => x.id === o.id);
      if (updated) { setDetailOrder({ ...updated, ...Object.fromEntries(changes.map((c) => [c.field, c.new])) }); }
      setDetailTab("view");
    } catch (err) { toast(`Save failed: ${err.message}`, "error"); }
    finally { setDetailBusy(false); }
  }

  /* ── Create New Order ── */
  async function createOrder() {
    const f = newOrderForm;
    const ts = Date.now().toString().slice(-6);
    const newId = `ORD-${new Date().getFullYear()}-${ts}`;
    const origin = [f.originCity, f.originState?.toUpperCase()].filter(Boolean).join(", ") + (f.originZip ? " " + f.originZip : "");
    const dest = [f.destCity, f.destState?.toUpperCase()].filter(Boolean).join(", ") + (f.destZip ? " " + f.destZip : "");
    // Auto-compute weight/pieces from lines
    const autoWeight = newOrderLines.reduce((s, l) => s + (l.total_weight || 0), 0);
    const autoPieces = newOrderLines.reduce((s, l) => s + (l.qty_ordered || l.qty || 0), 0);
    const orderData = {
      id: newId, customer: f.customer || "Customer",
      origin: origin || "Chicago, IL", dest: dest || "Dallas, TX",
      origin_zip: f.originZip || null, dest_zip: f.destZip || null,
      weight: parseFloat(f.weight) || autoWeight || 0, pieces: parseInt(f.pieces) || autoPieces || 0,
      commodity: f.commodity || "General", ready: f.ready || null, due: f.due || null,
      status: "Unplanned",
      preferred_carrier: f.preferredCarrier || null,
      excluded_carrier: f.excludedCarrier || null,
      no_consolidate: f.noConsolidate || f.dedicatedEquip || f.hazmat || false,
      hazmat: f.hazmat || false,
    };
    setDetailBusy(true);
    try {
      await DbApi.upsert("orders", orderData);
      // Save line items if any
      if (newOrderLines.length > 0) {
        const linePayload = newOrderLines.map((ln, idx) => {
          const itMeta = itemMaster.find((x) => x.id === (ln.item_id || ln.itemId)) || {};
          return {
            line_num: idx + 1, item_id: ln.item_id || null,
            description: itMeta.desc || ln.description || null,
            qty_ordered: ln.qty_ordered || 0, unit_weight: ln.unit_weight || 0,
            total_weight: ln.total_weight || 0,
          };
        });
        await OrdersApi.saveLines(newId, linePayload);
      }
      toast(`Created order ${newId}`, "success");
      setShowNewOrder(false);
      setNewOrderForm({
        customer: "", originCity: "", originState: "", originZip: "",
        destCity: "", destState: "", destZip: "", commodity: "", incoterms: "",
        ready: "", due: "", preferredCarrier: "", excludedCarrier: "",
        noConsolidate: false, dedicatedEquip: false, hazmat: false,
      });
      setNewOrderLines([]);
      await refreshData();
    } catch (err) { toast(`Create failed: ${err.message}`, "error"); }
    finally { setDetailBusy(false); }
  }

  /* ── Date helpers ── */
  function addBusinessDays(dateStr, days) {
    const d = new Date(dateStr + "T12:00:00");
    const step = days >= 0 ? 1 : -1;
    let remaining = Math.abs(days);
    while (remaining > 0) { d.setDate(d.getDate() + step); const dow = d.getDay(); if (dow !== 0 && dow !== 6) remaining--; }
    return d.toISOString().slice(0, 10);
  }
  function calcDates(quote, dueDate, readyDate) {
    const today = new Date().toISOString().slice(0, 10);
    let transit = quote.transitDays || null;
    if (!transit) {
      return { pickup: null, delivery: null, transit: null, warning: "", error: "No transit time available — configure transit_days in rate table, add miles, or enable CarrierConnect" };
    }
    // Pickup = latest of (today, readyDate) — can't ship before ready
    const minPickup = today > (readyDate || "") ? today : (readyDate || today);
    let pickup = minPickup;
    // If due date exists, try to back-calculate pickup to arrive on time
    if (dueDate) {
      const idealPickup = addBusinessDays(dueDate, -transit);
      if (idealPickup >= minPickup) pickup = idealPickup;
      // else constrained by ready date — ship ASAP
    }
    const delivery = addBusinessDays(pickup, transit);
    const warning = dueDate && delivery > dueDate ? "Late — delivery after due date" : "";
    return { pickup, delivery, transit, warning };
  }

  /* ── City → Zip fallback (for orders missing zip codes) ── */
  const CITY_ZIPS = {
    "chicago": "60602", "dallas": "75202", "atlanta": "30303", "los angeles": "90012",
    "new york": "10001", "houston": "77002", "san jose": "95112", "charlotte": "28202",
    "memphis": "38103", "louisville": "40202", "columbus": "43215", "indianapolis": "46204",
    "nashville": "37203", "san francisco": "94102", "seattle": "98101", "denver": "80202",
    "phoenix": "85004", "detroit": "48226", "minneapolis": "55401", "miami": "33131",
    "college park": "30337", "laredo": "78040", "el paso": "79901", "savannah": "31401",
  };
  const cityZipLookup = (str) => {
    const city = (str || "").split(",")[0].trim().toLowerCase();
    return CITY_ZIPS[city] || "";
  };

  /* ── Create shipments directly from a multi-stop route ── */
  async function createShipmentsFromRoute(route, ordersList) {
    const normalize = (s) => (s || "").trim().toLowerCase().split(",")[0].trim();
    const stops = Array.isArray(route.stops) ? route.stops : [];
    const pickups = stops.filter((s) => s.type === "pickup");
    const deliveries = stops.filter((s) => s.type === "delivery");
    const firstPickup = pickups[0] || stops[0];
    const lastDelivery = deliveries[deliveries.length - 1] || stops[stops.length - 1];
    const totalCost = parseFloat(route.cost_override) || 0;
    const totalMiles = parseFloat(route.total_miles) || 0;

    // Auto-assign orders to delivery stops by matching destination
    const assignments = {};
    for (const d of deliveries) {
      const dCity = normalize(d.location || d.city);
      const matched = ordersList.filter((o) => {
        const oCity = normalize(o.dest);
        return oCity.includes(dCity) || dCity.includes(oCity);
      });
      if (matched.length > 0) {
        const key = `${(firstPickup.stop_seq || 1)}.${d.stop_seq || d.sequence}`;
        assignments[key] = { delivery: d, orders: matched };
      }
    }

    if (Object.keys(assignments).length === 0) {
      toast("Could not match orders to route stops", "error");
      return;
    }

    setBusyId("multi-stop");
    try {
      const genId = () => `SHP-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const masterId = genId();
      const allOrderIds = ordersList.map((o) => o.id);
      const today = new Date().toISOString().slice(0, 10);
      const dueDates = ordersList.map((o) => o.due).filter(Boolean).sort();
      const routeTransitDays = parseInt(route.transit_days) || 2;
      // Delivery = earliest due date (must arrive by then)
      const deliveryDate = dueDates[0] || addBusinessDays(today, routeTransitDays);
      // Pickup = delivery - transit days (work backwards)
      let pickupDate = addBusinessDays(deliveryDate, -routeTransitDays);
      // If pickup is in the past, use today instead
      if (pickupDate < today) pickupDate = today;

      // Create MBOL
      const masterShipment = {
        id: masterId, carrier: route.carrier, mode: route.mode || "TL",
        origin: firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`,
        dest: lastDelivery.location || `${lastDelivery.city}, ${lastDelivery.state}`,
        weight: ordersList.reduce((s, o) => s + (parseFloat(o.weight) || 0), 0),
        pieces: ordersList.reduce((s, o) => s + (parseInt(o.pieces) || 0), 0),
        status: "Planned", total_cost: totalCost, order_ids: allOrderIds,
        miles: totalMiles, bol_type: "MBOL", route_template_id: route.id,
        pickup_date: pickupDate, delivery_date: deliveryDate,
        service_level: route.service_level || "Standard",
      };
      await DbApi.upsert("shipments", masterShipment);

      // Create CBOLs and update orders
      // Calculate leg miles from stops, or fetch via PC*Miler
      const cbolKeys = Object.keys(assignments);
      let totalLegMiles = 0;
      const cbolMilesMap = {};
      for (const [key, { delivery }] of Object.entries(assignments)) {
        const pIdx = stops.indexOf(firstPickup);
        const dIdx = stops.indexOf(delivery);
        let miles = 0;
        for (let i = pIdx + 1; i <= dIdx; i++) miles += parseFloat(stops[i].leg_miles) || 0;
        cbolMilesMap[key] = miles;
        totalLegMiles += miles;
      }
      // If no leg miles on stops, fetch from PC*Miler
      if (totalLegMiles === 0 && cbolKeys.length > 0) {
        try {
          const pairs = Object.entries(assignments).map(([, { delivery }]) => ({
            origin: firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`,
            dest: delivery.location || `${delivery.city}, ${delivery.state}`,
          }));
          const mileageRes = await MileageApi.bulk(pairs);
          const results = Array.isArray(mileageRes?.results) ? mileageRes.results : (Array.isArray(mileageRes) ? mileageRes : []);
          cbolKeys.forEach((key, idx) => {
            const mi = parseFloat(results[idx]?.miles || results[idx]?.distance) || 0;
            cbolMilesMap[key] = mi;
            totalLegMiles += mi;
          });
        } catch { /* PC*Miler unavailable — fall through to equal split */ }
      }
      // If still 0, split cost equally
      const equalSplit = totalLegMiles === 0;

      let cbolCount = 0;
      const createdCbols = [];
      for (const [key, { delivery, orders: cbolOrders }] of Object.entries(assignments)) {
        const childId = `${masterId}.${key}`;
        const legMiles = cbolMilesMap[key] || 0;
        const cbolCost = equalSplit
          ? Math.round((totalCost / cbolKeys.length) * 100) / 100
          : Math.round((legMiles / totalLegMiles) * totalCost * 100) / 100;

        const cbolOrigin = firstPickup.location || `${firstPickup.city}, ${firstPickup.state}`;
        const cbolDest = delivery.location || `${delivery.city}, ${delivery.state}`;
        await DbApi.upsert("shipments", {
          id: childId, carrier: route.carrier, mode: route.mode || "TL",
          origin: cbolOrigin, dest: cbolDest,
          weight: cbolOrders.reduce((s, o) => s + (parseFloat(o.weight) || 0), 0),
          pieces: cbolOrders.reduce((s, o) => s + (parseInt(o.pieces) || 0), 0),
          status: "Planned", total_cost: cbolCost, order_ids: cbolOrders.map((o) => o.id),
          miles: legMiles, bol_type: "CBOL", master_shipment_id: masterId,
          stop_from: key.split(".")[0], stop_to: key.split(".")[1],
          route_template_id: route.id,
          pickup_date: pickupDate, delivery_date: deliveryDate,
          service_level: route.service_level || "Standard",
        });
        createdCbols.push({ id: childId, origin: cbolOrigin, dest: cbolDest, cost: cbolCost, miles: legMiles, orders: cbolOrders });

        for (const ord of cbolOrders) {
          await DbApi.patch("orders", ord.id, { status: "Planned", shipment_id: childId });
        }
        cbolCount++;
      }

      // Build full route path from stops
      const routePath = stops.map((s) => (s.city || (s.location || "").split(",")[0] || "").trim()).filter(Boolean).join(" → ");

      setPlanSummary({
        isMultiStop: true,
        masterShipment: { ...masterShipment, routePath },
        childShipments: createdCbols,
        ordersUpdated: ordersList.length,
        totalCost,
        carrier: route.carrier,
        mode: route.mode || "TL",
        siblings: ordersList,
      });
      await refreshData();
    } catch (err) {
      toast(`Multi-stop plan failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  /* ── Open Plan Confirmation Modal ── */
  async function openPlanModal(orderId, planGroup = false, selectedIds = null) {
    const o = orders.find((x) => x.id === orderId);
    if (!o || o.status !== "Unplanned") return;
    // selectedIds: explicit list from multi-select. planGroup: auto-consolidate same lane. default: single order.
    const sibs = selectedIds
      ? orders.filter((x) => selectedIds.has(x.id) && x.status === "Unplanned")
      : planGroup
        ? orders.filter((x) => x.status === "Unplanned" && x.origin === o.origin && x.dest === o.dest)
        : [o];

    // Multi-order planning: try multi-stop routes first, then plan remaining individually
    if (sibs.length > 1) {
      const normalize = (s) => (s || "").trim().toLowerCase().split(",")[0].trim();
      const origins = new Set(sibs.map((x) => normalize(x.origin)));
      const dests = new Set(sibs.map((x) => normalize(x.dest)));
      if (origins.size > 1 || dests.size > 1) {
        // Fetch route templates
        let templates = Array.isArray(routeTemplates) ? routeTemplates : [];
        if (templates.length === 0) {
          try {
            const freshTemplates = await DbApi.routeTemplates();
            templates = Array.isArray(freshTemplates) ? freshTemplates : [];
          } catch { /* ignore */ }
        }

        // Try to match orders to a multi-stop route
        let routeMatchedOrders = [];
        for (const t of templates) {
          if (!t.carrier) continue;
          const tStops = Array.isArray(t.stops) ? t.stops : [];
          const tPickups = tStops.filter((s) => s.type === "pickup").map((s) => normalize(s.location || s.city));
          const tDeliveries = tStops.filter((s) => s.type === "delivery").map((s) => normalize(s.location || s.city));
          // Find orders that match this route (origin matches a pickup, dest matches a delivery)
          const matched = sibs.filter((o) => {
            const oOrigin = normalize(o.origin);
            const oDest = normalize(o.dest);
            return tPickups.some((p) => oOrigin.includes(p) || p.includes(oOrigin))
              && tDeliveries.some((td) => oDest.includes(td) || td.includes(oDest));
          });
          if (matched.length >= 2) {
            // Found a route with 2+ matching orders — plan them via multi-stop
            await createShipmentsFromRoute(t, matched);
            routeMatchedOrders = matched;
            break;
          }
        }

        // Remaining orders not matched to a route — plan each individually
        const remaining = sibs.filter((o) => !routeMatchedOrders.includes(o));
        if (remaining.length > 0) {
          // Group remaining by same lane, then open plan modal for first group
          // Others will be planned as single orders
          const firstRemaining = remaining[0];
          // Plan remaining orders individually (open plan modal for the first one)
          if (routeMatchedOrders.length > 0) {
            // Some were multi-stopped, plan remaining individually
            for (const rem of remaining) {
              // Use single-order plan flow — open modal for first, rest queued
              // For now, just open the plan modal for the first remaining order
            }
            if (remaining.length === 1) {
              // Fall through to normal single-order plan modal below
              // Override sibs to just this one order
              openPlanModal(firstRemaining.id, false, null);
              return;
            }
            toast(`${routeMatchedOrders.length} orders planned via multi-stop route. ${remaining.length} remaining — select and plan them individually.`, "info");
            return;
          }
          // No route matched at all — plan all as individual orders
          // Fall through to normal plan modal for the first selected order
        } else {
          // All orders matched to a route
          return;
        }
      }
    }

    const totalWeight = sibs.reduce((s, x) => s + Number(x.weight || 0), 0);
    const totalPieces = sibs.reduce((s, x) => s + Number(x.pieces || 0), 0);
    const originZip = String(o.origin_zip || o.origin || "").match(/\b(\d{5})\b/)?.[1] || cityZipLookup(o.origin);
    const destZip = String(o.dest_zip || o.dest || "").match(/\b(\d{5})\b/)?.[1] || cityZipLookup(o.dest);
    // Auto-detect equipment: LTL if weight ≤ 15,000 lbs, else Dry Van 53'
    const autoEquip = totalWeight <= LTL_MAX_WEIGHT ? "LTL Truck" : DEFAULT_EQUIP;
    const maxWt = EQUIPMENT_TYPES[autoEquip].maxWeight;
    const util = Math.round((totalWeight / maxWt) * 100);
    const lane = {
      laneKey: `${o.origin || ""} -> ${o.dest || ""}`, origin: o.origin || "", destination: o.dest || "",
      originZip, destZip, freightClass: o.freight_class || "70", totalWeight, totalPieces,
      orderIds: sibs.map((x) => x.id),
    };
    setPlanModal({ order: o, siblings: sibs, lane, quotes: [], selectedIdx: 0, busy: true, error: "", maxWt, util, loadDuration: 120, equipType: autoEquip });
    setDetailOrder(null);
    try {
      const rateRes = await BulkPlanApi.rate([lane], "cost");
      const results = Array.isArray(rateRes?.results) ? rateRes.results : [];
      const rawQuotes = results[0]?.quotes || [];
      // Sort: feasible (on-time) first, then by cost ascending
      const readyD = sibs.map((s) => s.ready).filter(Boolean).sort().reverse()[0] || "";
      const dueD = sibs.map((s) => s.due).filter(Boolean).sort()[0] || "";
      const sortedQuotes = [...rawQuotes].sort((a, b) => {
        const datesA = calcDates(a, dueD, readyD);
        const datesB = calcDates(b, dueD, readyD);
        const lateA = datesA.warning ? 1 : 0;
        const lateB = datesB.warning ? 1 : 0;
        if (lateA !== lateB) return lateA - lateB; // on-time first
        return (a.totalCharge || 0) - (b.totalCharge || 0); // then cheapest
      });
      const bestQuote = results[0]?.bestQuote || null;
      setPlanModal((prev) => prev ? { ...prev, quotes: sortedQuotes, bestQuote, busy: false } : null);
    } catch (err) {
      setPlanModal((prev) => prev ? { ...prev, busy: false, error: err.message } : null);
    }
  }

  async function confirmPlan() {
    if (!planModal) return;
    const { lane, quotes, selectedIdx, bestQuote, siblings } = planModal;
    const chosen = quotes[selectedIdx] || bestQuote;
    if (!chosen) { toast("No carrier selected", "error"); return; }
    const readyDate = siblings?.map((s) => s.ready).filter(Boolean).sort().reverse()[0] || "";
    const earliestDue = siblings?.map((s) => s.due).filter(Boolean).sort()[0] || "";
    const dates = calcDates(chosen, earliestDue, readyDate);
    if (dates.error) {
      toast(`Planning failed: ${dates.error}`, "error");
      return;
    }
    setPlanModal((prev) => prev ? { ...prev, busy: true } : null);
    try {
      const plans = [{
        laneKey: lane.laneKey, origin: lane.origin, destination: lane.destination,
        originZip: lane.originZip, destZip: lane.destZip,
        totalWeight: lane.totalWeight, totalPieces: lane.totalPieces, orderIds: lane.orderIds,
        carrier: chosen.carrier || "", mode: chosen.mode || "LTL",
        totalCost: chosen.totalCharge || 0, pickupDate: dates.pickup,
        deliveryDate: dates.delivery, czarliteRate: chosen.mode === "LTL",
        serviceLevel: chosen.serviceLevel || "",
        miles: chosen.miles || null,
        rate: chosen.czarBaseGross || chosen.czarBase || 0,
        fuelSurcharge: chosen.fscCharge || 0,
        accessorials: chosen.accessorialCharge || 0,
      }];
      const execRes = await BulkPlanApi.execute(plans);
      setPlanModal(null);
      setPlanSummary({
        shipments: execRes?.shipments || [],
        ordersUpdated: execRes?.ordersUpdated || 0,
        totalCost: chosen.totalCharge || 0,
        carrier: chosen.carrier || "",
        mode: chosen.mode || "TL",
        lane, siblings, dates,
      });
      // Refresh in background — don't await (it unmounts the page via loading state)
      refreshData();
    } catch (err) {
      setPlanModal((prev) => prev ? { ...prev, busy: false, error: err.message } : null);
    }
  }

  /* ── Bulk Plan Scheduler ── */
  const runBulk = useCallback(async () => {
    const unplanned = orders.filter((o) => o.status === "Unplanned");
    if (!unplanned.length) {
      setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] No unplanned orders.`]);
      return;
    }
    // Group by lane
    const laneMap = {};
    unplanned.forEach((o) => {
      const key = `${o.origin || ""}||${o.dest || ""}`;
      if (!laneMap[key]) laneMap[key] = [];
      laneMap[key].push(o);
    });
    const lanes = Object.values(laneMap).map((group) => {
      const o = group[0];
      return {
        laneKey: `${o.origin || ""} -> ${o.dest || ""}`, origin: o.origin || "", destination: o.dest || "",
        originZip: String(o.origin_zip || o.origin || "").match(/\b(\d{5})\b/)?.[1] || "",
        destZip: String(o.dest_zip || o.dest || "").match(/\b(\d{5})\b/)?.[1] || "",
        freightClass: o.freight_class || "70",
        totalWeight: group.reduce((s, x) => s + Number(x.weight || 0), 0),
        totalPieces: group.reduce((s, x) => s + Number(x.pieces || 0), 0),
        orderIds: group.map((x) => x.id),
      };
    });
    setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] Rating ${lanes.length} lanes...`]);
    try {
      const rateRes = await BulkPlanApi.rate(lanes, "cost");
      const results = Array.isArray(rateRes?.results) ? rateRes.results : [];
      const plans = results.map((r) => {
        const lane = lanes.find((l) => l.laneKey === r.laneKey);
        if (!lane || !r?.bestQuote) return null;
        return {
          laneKey: lane.laneKey, origin: lane.origin, destination: lane.destination,
          originZip: lane.originZip, destZip: lane.destZip,
          totalWeight: lane.totalWeight, totalPieces: lane.totalPieces, orderIds: lane.orderIds,
          carrier: r.bestQuote.carrier || "", mode: r.bestQuote.mode || "LTL",
          totalCost: r.bestQuote.totalCharge || 0, pickupDate: "",
          deliveryDate: r.bestQuote.deliveryDate || "", czarliteRate: r.bestQuote.mode === "LTL",
        };
      }).filter(Boolean);
      if (!plans.length) {
        setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] No quotes returned.`]);
        setSchedRuns((r) => r + 1);
        return;
      }
      const execRes = await BulkPlanApi.execute(plans);
      const created = execRes?.shipments?.length || 0;
      const updated = execRes?.ordersUpdated || 0;
      const cost = (execRes?.shipments || []).reduce((s, sh) => s + Number(sh.total_cost || 0), 0);
      setSchedRuns((r) => r + 1);
      setSchedPlanned((p) => p + updated);
      setSchedSaved((p) => p + cost);
      setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] ✅ ${created} shipment(s), ${updated} order(s) planned. Cost: ${fmt$(cost)}`]);
      await refreshData();
    } catch (err) {
      setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] ❌ ${err.message}`]);
      setSchedRuns((r) => r + 1);
    }
  }, [orders, refreshData]);

  function startSched() {
    setSchedRunning(true);
    schedSecsLeft.current = schedInterval;
    setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] Scheduler started (${schedInterval}s interval).`]);
    schedCdRef.current = setInterval(() => {
      schedSecsLeft.current -= 1;
      if (schedSecsLeft.current <= 0) schedSecsLeft.current = 0;
      const m = Math.floor(schedSecsLeft.current / 60);
      const s = schedSecsLeft.current % 60;
      setSchedCountdown(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }, 1000);
    schedTimerRef.current = setInterval(() => {
      schedSecsLeft.current = schedInterval;
      runBulk();
    }, schedInterval * 1000);
  }

  function stopSched() {
    setSchedRunning(false);
    clearInterval(schedTimerRef.current);
    clearInterval(schedCdRef.current);
    setSchedCountdown("--:--");
    setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] Scheduler stopped.`]);
  }

  useEffect(() => {
    DbApi.items().then((res) => { setItemMaster(Array.isArray(res) ? res : []); }).catch(() => {});
    return () => { clearInterval(schedTimerRef.current); clearInterval(schedCdRef.current); };
  }, []);

  const statusCounts = useMemo(() => {
    const c = { All: orders.length };
    orders.forEach((o) => { c[o.status] = (c[o.status] || 0) + 1; });
    return c;
  }, [orders]);

  /* ── Selected orders stats ── */
  const selectedStats = useMemo(() => {
    const sel = orders.filter((o) => selectedOrders.has(o.id));
    const unplanned = sel.filter((o) => o.status === "Unplanned");
    const weight = sel.reduce((s, o) => s + Number(o.weight || 0), 0);
    const pieces = sel.reduce((s, o) => s + Number(o.pieces || 0), 0);
    const util = Math.round((weight / 44000) * 100);
    return { count: sel.length, unplannedCount: unplanned.length, weight, pieces, util };
  }, [orders, selectedOrders]);

  const SortIcon = ({ col }) => (
    <span style={{ opacity: sortCol === col ? 1 : 0.3, marginLeft: 4 }}>
      {sortCol === col ? (sortAsc ? "▲" : "▼") : "⇅"}
    </span>
  );

  /* ── Build table rows with lane group headers ── */
  const tableRows = useMemo(() => {
    const result = [];
    const showLaneGroups = sortCol === "id"; // only show lane grouping in default sort
    let lastLaneKey = null;
    rows.forEach((o) => {
      const laneKey = `${o.origin}||${o.dest}`;
      const group = laneGroups[laneKey];
      if (showLaneGroups && o.status === "Unplanned" && group && group.orders.length > 1 && laneKey !== lastLaneKey) {
        lastLaneKey = laneKey;
        const capacity = group.totalWeight >= 38000 ? "Full TL" : "Partial TL";
        const capacityClass = group.totalWeight >= 38000 ? "badge badge-green" : "badge badge-amber";
        result.push({ type: "lane-header", key: `lane-${laneKey}`, origin: o.origin, dest: o.dest, count: group.orders.length, weight: group.totalWeight, capacity, capacityClass, firstOrderId: group.orders[0] });
      }
      result.push({ type: "order", key: o.id, order: o, inGroup: showLaneGroups && o.status === "Unplanned" && group && group.orders.length > 1 });
    });
    return result;
  }, [rows, laneGroups, sortCol]);

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Orders</div>
          <div className="page-sub">Auto-consolidates open orders by lane every run</div>
        </div>
        <div className="header-actions">
          <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>{orders.length} Orders</span>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewOrder(true)}>+ New Order</button>
        </div>
      </div>
      <div className="page-content">

      {/* ═══ BULK PLAN SCHEDULER ═══ */}
      <div className="card" style={{ marginBottom: 16, border: "1px solid rgba(99,102,241,.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚙️</span>
            <div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14 }}>Bulk Plan Scheduler</div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>Auto-consolidates open orders by lane · Picks cheapest rate</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12, background: schedRunning ? "rgba(5,150,105,.1)" : "rgba(107,114,128,.1)", color: schedRunning ? "#059669" : "#6b7280", border: `1px solid ${schedRunning ? "rgba(5,150,105,.3)" : "rgba(107,114,128,.2)"}` }}>
              {schedRunning && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#059669", marginRight: 5, animation: "pulse 1s infinite" }} />}
              {schedRunning ? "Running" : "Stopped"}
            </span>
            {!schedRunning ? (
              <>
                <button className="btn btn-primary btn-sm" onClick={startSched}>▶ Start</button>
                <button className="btn btn-secondary btn-sm" onClick={() => runBulk()}>⚡ Run Now</button>
              </>
            ) : (
              <button className="btn btn-secondary btn-sm" style={{ color: "#dc2626", borderColor: "rgba(220,38,38,.3)" }} onClick={stopSched}>⏹ Stop</button>
            )}
          </div>
        </div>
        <div style={{ padding: "12px 18px" }}>
          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase" }}>Next Run In</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, fontSize: 18, marginTop: 4 }}>{schedCountdown}</div>
            </div>
            <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase" }}>Total Runs</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginTop: 4 }}>{schedRuns}</div>
            </div>
            <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase" }}>Orders Planned</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginTop: 4, color: "var(--green)" }}>{schedPlanned}</div>
            </div>
            <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase" }}>Total Saved</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginTop: 4, color: "var(--green)" }}>{schedSaved >= 1000 ? `$${Math.round(schedSaved / 1000)}K` : fmt$(schedSaved)}</div>
            </div>
          </div>
          {/* Interval */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>Interval:</span>
            {[{ label: "10s", secs: 10 }, { label: "30s", secs: 30 }, { label: "5 min", secs: 300 }, { label: "1 hr", secs: 3600 }].map((iv) => (
              <button key={iv.secs} className={`ord-chip ${schedInterval === iv.secs ? "active-chip" : ""}`} onClick={() => setSchedIntervalVal(iv.secs)} style={{ padding: "3px 10px", fontSize: 11 }}>
                {iv.label}
              </button>
            ))}
          </div>
          {/* Run Log */}
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", marginBottom: 4 }}>Run Log</div>
          <div style={{ background: "#f8faff", borderRadius: 8, padding: "8px 12px", fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: "var(--text2)", maxHeight: 100, overflowY: "auto", border: "1px solid var(--border)" }}>
            {schedLog.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      </div>

      {/* ═══ STATUS CHIPS ═══ */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginRight: 4 }}>Status:</span>
        {[
          { key: "All", emoji: "📋" }, { key: "Unplanned", emoji: "🟡" }, { key: "Planned", emoji: "🟢" },
          { key: "Consolidated", emoji: "🔵" }, { key: "Tendered", emoji: "🟠" },
          { key: "In Transit", emoji: "🚛" }, { key: "Delivered", emoji: "✅" }, { key: "Cancelled", emoji: "🔴" },
        ].map((s) => (
          <button key={s.key} className={`ord-chip ${statusFilter === s.key ? "active-chip" : ""}`} onClick={() => setStatusFilter(s.key)}>
            {s.emoji} {s.key} {statusCounts[s.key] ? `(${statusCounts[s.key]})` : ""}
          </button>
        ))}
        {hasFilters && (
          <button onClick={clearFilters} style={{ fontSize: 11, color: "#dc2626", background: "rgba(220,38,38,.06)", border: "1px solid rgba(220,38,38,.2)", borderRadius: 16, padding: "3px 10px", cursor: "pointer", fontWeight: 600, fontFamily: "inherit" }}>✕ Clear Filters</button>
        )}
      </div>

      {/* ═══ FILTERS ═══ */}
      <div className="filter-bar" style={{ flexWrap: "wrap" }}>
        <div className="search-wrap">
          <input placeholder="🔍 Search order, customer, lane, commodity..." value={q} onChange={(e) => setQ(e.target.value)} className="search-input" style={{ minWidth: 250 }} />
        </div>
        <select className="fsel" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
          <option value="All">All Customers</option>
          {customers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)" }}>Ready From</span>
        <input type="date" value={readyFrom} onChange={(e) => setReadyFrom(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }} />
        <span style={{ fontSize: 12, color: "var(--text3)" }}>To</span>
        <input type="date" value={readyTo} onChange={(e) => setReadyTo(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)" }}>Due From</span>
        <input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }} />
        <span style={{ fontSize: 12, color: "var(--text3)" }}>To</span>
        <input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }} />
      </div>

      {/* Selection Bar */}
      {selectedOrders.size > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", marginBottom: 12,
          background: "linear-gradient(135deg, #1a237e, #3b82f6)", borderRadius: 12, color: "#fff",
        }}>
          <input type="checkbox" checked onChange={toggleSelectAll} style={{ accentColor: "#fff" }} />
          <span style={{ fontWeight: 800, fontSize: 13, textTransform: "uppercase" }}>{selectedStats.count} Order{selectedStats.count !== 1 ? "s" : ""} Selected</span>
          <span style={{ fontSize: 11, opacity: 0.8 }}>{selectedStats.weight.toLocaleString()} lbs · {selectedStats.pieces.toLocaleString()} pieces</span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>Trailer Util</span>
          <span style={{ fontWeight: 700, fontSize: 12 }}>{selectedStats.util}%</span>
          <div style={{ width: 60, height: 6, background: "rgba(255,255,255,.25)", borderRadius: 3 }}>
            <div style={{ width: `${Math.min(100, selectedStats.util)}%`, height: 6, background: "#fff", borderRadius: 3 }} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => setSelectedOrders(new Set())} style={{ padding: "5px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,.4)", background: "rgba(255,255,255,.15)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✕ Clear</button>
            {selectedStats.unplannedCount > 0 && (
              <button onClick={() => { const first = orders.find((o) => selectedOrders.has(o.id) && o.status === "Unplanned"); if (first) openPlanModal(first.id, false, selectedOrders); }}
                style={{ padding: "5px 14px", borderRadius: 8, border: "none", background: "#22c55e", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                ⚡ Plan Selected
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {message.text && (
        <div style={{
          padding: "10px 16px", borderRadius: 10, marginBottom: 12, fontSize: 13, fontWeight: 600,
          background: message.type === "error" ? "#fee2e2" : message.type === "success" ? "#dcfce7" : "#dbeafe",
          color: message.type === "error" ? "#991b1b" : message.type === "success" ? "#14532d" : "#1e3a8a",
          border: `1px solid ${message.type === "error" ? "#fca5a5" : message.type === "success" ? "#86efac" : "#93c5fd"}`,
        }}>{message.text}</div>
      )}

      {/* ═══ ORDERS TABLE ═══ */}
      <div className="card" style={{ padding: 0 }}><div className="table-wrap">
      <table className="grid" style={{ border: "none", boxShadow: "none" }}>
        <thead>
          <tr>
            <th style={{ width: 36 }}><input type="checkbox" checked={selectedOrders.size === rows.length && rows.length > 0} onChange={toggleSelectAll} /></th>
            <th onClick={() => toggleSort("id")} style={{ cursor: "pointer" }}>Order ID <SortIcon col="id" /></th>
            <th onClick={() => toggleSort("customer")} style={{ cursor: "pointer" }}>Customer <SortIcon col="customer" /></th>
            <th onClick={() => toggleSort("origin")} style={{ cursor: "pointer" }}>Origin <SortIcon col="origin" /></th>
            <th onClick={() => toggleSort("dest")} style={{ cursor: "pointer" }}>Destination <SortIcon col="dest" /></th>
            <th onClick={() => toggleSort("weight")} style={{ cursor: "pointer" }}>Weight <SortIcon col="weight" /></th>
            <th onClick={() => toggleSort("pieces")} style={{ cursor: "pointer" }}>Pieces <SortIcon col="pieces" /></th>
            <th onClick={() => toggleSort("commodity")} style={{ cursor: "pointer" }}>Commodity <SortIcon col="commodity" /></th>
            <th onClick={() => toggleSort("ready")} style={{ cursor: "pointer" }}>Ready <SortIcon col="ready" /></th>
            <th onClick={() => toggleSort("due")} style={{ cursor: "pointer" }}>Due <SortIcon col="due" /></th>
            <th onClick={() => toggleSort("shipment_id")} style={{ cursor: "pointer" }}>Shipment <SortIcon col="shipment_id" /></th>
            <th>Constraints</th>
            <th onClick={() => toggleSort("status")} style={{ cursor: "pointer" }}>Status <SortIcon col="status" /></th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.length === 0 ? (
            <tr><td colSpan={14} className="empty-state">No orders found</td></tr>
          ) : tableRows.map((row) => {
            if (row.type === "lane-header") {
              return (
                <tr key={row.key} style={{ background: "rgba(245,158,11,.06)" }}>
                  <td colSpan={14} style={{ padding: "8px 16px", borderLeft: "3px solid #d97706" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 14 }}>⚙️</span>
                      <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)" }}>
                        {(row.origin || "").split(",")[0]} → {(row.dest || "").split(",")[0]}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>{row.count} orders · {row.weight.toLocaleString()} lbs</span>
                      <span className={row.capacityClass} style={{ fontSize: 10 }}>{row.capacity}</span>
                      <button style={{ marginLeft: "auto", padding: "5px 14px", borderRadius: 8, border: "none", background: "#d97706", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }} onClick={() => openPlanModal(row.firstOrderId, true)}>⚡ Plan Group</button>
                    </div>
                  </td>
                </tr>
              );
            }
            const o = row.order;
            const badges = constraintBadges(o);
            const isChecked = selectedOrders.has(o.id);
            const isSpot = o.noContractRate;
            const sc = STATUS_ROW_COLORS[o.status];
            const rowStyle = isChecked
              ? { background: "rgba(59,130,246,.1)", borderLeft: "3px solid var(--accent)" }
              : isSpot
              ? SPOT_ROW_STYLE
              : sc
              ? { background: sc.bg, borderLeft: `3px solid ${sc.border}` }
              : {};
            return (
              <tr key={o.id} style={rowStyle}>
                <td><input type="checkbox" checked={isChecked} onChange={() => toggleSelect(o.id)} /></td>
                <td>
                  {row.inGroup && <span style={{ color: "var(--text3)", marginRight: 4 }}>└</span>}
                  <a href="#" onClick={(e) => { e.preventDefault(); openDetail(o.id); }} className="mono" style={{ color: "var(--accent)", fontWeight: 600 }}>{o.id}</a>
                </td>
                <td>{o.customer || "—"}</td>
                <td className="text-sm">{o.origin || "—"}</td>
                <td className="text-sm">{o.dest || "—"}</td>
                <td className="mono">{(o.weight || 0).toLocaleString()} lbs</td>
                <td className="mono">{o.pieces || "—"}</td>
                <td className="text-sm">{o.commodity || "—"}</td>
                <td className="mono text-sm">{o.ready || "—"}</td>
                <td className="mono text-sm">{o.due || "—"}</td>
                <td>{o.shipment_id ? <a href={`/shipments?id=${o.shipment_id}`} onClick={(e) => { e.preventDefault(); window.location.href = `/shipments?id=${o.shipment_id}`; }} className="mono text-sm" style={{ color: "var(--green)", textDecoration: "none", cursor: "pointer" }}>{o.shipment_id}</a> : "—"}</td>
                <td>{badges.map((b, i) => <span key={i} style={{ display: "inline-block", fontSize: 10, padding: "2px 6px", borderRadius: 8, fontWeight: 600, marginLeft: i > 0 ? 4 : 0, background: b.bg, color: b.color, border: `1px solid ${b.border}` }}>{b.label}</span>)}</td>
                <td><span className={STATUS_BADGES[o.status] || "badge badge-blue"}>{o.status || "—"}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {o.status === "Unplanned" && (<>
                    <button className="btn btn-primary btn-sm" disabled={busyId === o.id} onClick={() => openPlanModal(o.id)}>⚡ Plan</button>{" "}
                    <button className="btn btn-secondary btn-sm" style={{ background: "rgba(124,58,237,.08)", color: "#7c3aed", borderColor: "rgba(124,58,237,.3)" }} onClick={() => openPlanModal(o.id)} title="Cross-dock">🔄</button>{" "}
                    <button className="btn btn-secondary btn-sm" onClick={() => openDetail(o.id)} title="Edit">✏️</button>{" "}
                    <button className="btn btn-secondary btn-sm" onClick={() => openDetail(o.id)} title="View">👁</button>{" "}
                    <button style={{ background: "rgba(245,158,11,.10)", color: "#b45309", border: "1px solid rgba(245,158,11,.35)", padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer", marginLeft: 4 }} disabled={busyId === o.id} onClick={() => cancelOrder(o.id)} title="Cancel order">🚫</button>{" "}
                    <button style={{ background: "rgba(220,38,38,.08)", color: "#dc2626", border: "1px solid rgba(220,38,38,.2)", padding: "4px 8px", borderRadius: 6, fontSize: 12, cursor: "pointer", marginLeft: 4 }} disabled={busyId === o.id} onClick={() => deleteOrder(o.id)} title="Delete">🗑️</button>
                  </>)}
                  {o.status === "Planned" && (<>
                    <button className="btn btn-secondary btn-sm" style={{ background: "rgba(16,185,129,.08)", color: "#059669", borderColor: "rgba(16,185,129,.35)", fontSize: 11 }}>📤 Tender</button>{" "}
                    <button className="btn btn-secondary btn-sm" style={{ background: "rgba(245,158,11,.08)", color: "#b45309", borderColor: "rgba(245,158,11,.35)", fontSize: 11 }} onClick={() => unplanOrder(o.id)}>🔓 Unplan</button>
                  </>)}
                  {o.status === "Consolidated" && (
                    <button className="btn btn-secondary btn-sm" style={{ background: "rgba(245,158,11,.08)", color: "#b45309", borderColor: "rgba(245,158,11,.35)", fontSize: 11 }} onClick={() => unplanOrder(o.id)}>🔓 Unplan</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div></div>

      <div className="text-sm text-muted mt-2">{rows.length} of {orders.length} orders</div>

      {/* ═══ ORDER DETAIL MODAL ═══ */}
      {detailOrder && (() => {
        const o = detailOrder;
        const w = typeof o.weight === "number" ? o.weight.toLocaleString() : o.weight;
        const sibs = orders.filter((x) => x.status === "Unplanned" && x.origin === o.origin && x.dest === o.dest && x.id !== o.id);
        const shipModeVal = o.ship_mode || o.shipMode;
        const histLog = orderChangeLog[o.id] || [];
        const relShips = shipments?.filter((sh) => o.shipment_id && sh.id === o.shipment_id) || [];

        return (
        <div className="modal-overlay" onClick={() => setDetailOrder(null)}>
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 16, width: 740, maxWidth: "95vw", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(30,45,107,0.20)" }} onClick={(e) => e.stopPropagation()}>
            {/* Header with gradient + tabs */}
            <div style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)", borderRadius: "16px 16px 0 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px 12px" }}>
                <div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Order Details</div>
                  <span style={{ color: "#fff", fontSize: 19, fontFamily: "'Syne',sans-serif", fontWeight: 700 }}>{o.id}</span>
                </div>
                <button onClick={() => setDetailOrder(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.7)", fontSize: 22, cursor: "pointer", padding: "4px 8px", borderRadius: 6 }}>✕</button>
              </div>
              <div style={{ display: "flex", padding: "0 22px", gap: 2 }}>
                {["view", "edit", "history"].map((tab) => {
                  const labels = { view: "Details", edit: "Edit", history: "History" };
                  const icons = { view: "📋", edit: "✏️", history: "🕐" };
                  const isActive = detailTab === tab;
                  return (
                    <button key={tab} onClick={() => { setDetailTab(tab); setEditStatus(""); }} style={{
                      padding: "7px 18px", borderRadius: "8px 8px 0 0", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      background: isActive ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.25)",
                      color: isActive ? "#1a237e" : "rgba(255,255,255,.8)",
                    }}>{icons[tab]} {labels[tab]}{tab === "history" && histLog.length > 0 && <span style={{ background: "rgba(255,255,255,.3)", borderRadius: 10, padding: "0 6px", fontSize: 10, marginLeft: 4 }}>{histLog.length}</span>}</button>
                  );
                })}
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: 0, overflowY: "auto", flex: 1 }}>

              {/* ── VIEW TAB ── */}
              {detailTab === "view" && (<>
                {/* Status bar */}
                <div style={{ padding: "14px 24px", background: "#f8faff", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className={STATUS_BADGES[o.status] || "badge"}>{o.status}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>{o.customer || "—"}</span>
                    {o.no_contract_rate && <span style={{ fontSize: 9, fontWeight: 700, background: "#fee2e2", color: "#dc2626", border: "1px solid #fca5a5", padding: "2px 7px", borderRadius: 8 }}>⚠️ SPOT RATE</span>}
                  </div>
                  {o.shipment_id && <a href={`/shipments?id=${o.shipment_id}`} onClick={(e) => { e.preventDefault(); window.location.href = `/shipments?id=${o.shipment_id}`; }} className="mono" style={{ fontSize: 12, color: "var(--accent)", background: "var(--accent-glow)", padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(59,130,246,.2)", textDecoration: "none", cursor: "pointer" }}>{"\u2192"} {o.shipment_id}</a>}
                </div>

                {/* Lane visual */}
                <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div><div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8 }}>Origin</div><div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{o.origin || "—"}</div></div>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 10px" }}>
                      <div style={{ flex: 1, height: 3, background: "linear-gradient(90deg,var(--accent),var(--accent2))", borderRadius: 2 }} />
                      <div style={{ margin: "0 8px", fontSize: 18 }}>🚛</div>
                      <div style={{ flex: 1, height: 3, background: "linear-gradient(90deg,var(--accent2),var(--accent))", borderRadius: 2 }} />
                    </div>
                    <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8 }}>Destination</div><div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{o.dest || "—"}</div></div>
                  </div>
                </div>

                {/* Details grid */}
                <div style={{ padding: "18px 24px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, borderBottom: "1px solid var(--border)" }}>
                  <SdField icon="⚖️" label="Weight" value={w ? `${w} lbs` : null} />
                  <SdField icon="🔢" label="Pieces" value={o.pieces} />
                  <SdField icon="🏷️" label="Commodity" value={o.commodity} />
                  <SdField icon="🚛" label="Ship Mode" value={shipModeVal ? <span style={{ display: "inline-block", background: shipModeVal === "TL" ? "#dbeafe" : "#d1fae5", color: shipModeVal === "TL" ? "#1d4ed8" : "#065f46", padding: "2px 10px", borderRadius: 6, fontWeight: 700, fontSize: 12 }}>{shipModeVal}</span> : <span style={{ color: "var(--text3)", fontStyle: "italic" }}>{"\u2014"} TMS selects {"\u2014"}</span>} />
                  <SdField icon="📅" label="Ready Date" value={o.ready} />
                  <SdField icon="🗓️" label="Due Date" value={o.due} />
                  <SdField icon="🔗" label="Lane Peers" value={sibs.length > 0 ? `${sibs.length} eligible order(s)` : "No consolidation peers"} />
                  {o.shipment_id && <SdField icon="🚚" label="Shipment ID" value={<a href={`/shipments?id=${o.shipment_id}`} onClick={(e) => { e.preventDefault(); window.location.href = `/shipments?id=${o.shipment_id}`; }} className="mono" style={{ color: "var(--accent)", cursor: "pointer", textDecoration: "none" }}>{o.shipment_id} {"\u2197"}</a>} />}
                  {o.ref_num && <SdField icon="📋" label="Reference #" value={o.ref_num} />}
                  {o.po_num && <SdField icon="🧾" label="PO Number" value={o.po_num} />}
                </div>

                {/* Line Items */}
                <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📦 Line Items{detailLines.length > 0 && <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text3)", marginLeft: 4 }}>({detailLines.length})</span>}</div>
                  <OrderLinesEditor orderId={o.id} lines={detailLines} onChange={setDetailLines} onSave={saveLines}
                    onClear={() => { if (window.confirm("Clear all lines?")) { OrdersApi.clearLines(o.id).then(() => { setDetailLines([]); toast("Lines cleared", "success"); }); } }}
                    busy={detailBusy} mode="view" items={itemMaster} />
                </div>

                {/* Planning Constraints */}
                <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1 }}>⚙️ Planning Constraints</div>
                    {!["Delivered", "Cancelled"].includes(o.status) && <button className="btn btn-secondary btn-sm">✏️ Edit Constraints</button>}
                  </div>
                  {!(o.preferred_carrier || o.excluded_carrier || o.no_consolidate || o.hazmat) ? (
                    <div style={{ fontSize: 13, color: "var(--text3)", padding: "10px 14px", background: "#f8faff", borderRadius: 8, border: "1px solid var(--border)" }}>No constraints set {"\u2014"} order will be auto-consolidated with cheapest rate</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {o.preferred_carrier && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.2)", borderRadius: 10 }}><span>📌</span><div><div style={{ fontSize: 11, color: "var(--text3)" }}>Preferred Carrier</div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--accent)" }}>{o.preferred_carrier}</div></div></div>}
                      {o.excluded_carrier && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(107,114,128,.08)", border: "1px solid rgba(107,114,128,.2)", borderRadius: 10 }}><span>⛔</span><div><div style={{ fontSize: 11, color: "var(--text3)" }}>Excluded Carrier</div><div style={{ fontWeight: 600, fontSize: 13, color: "#6b7280" }}>{o.excluded_carrier}</div></div></div>}
                      {o.no_consolidate && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10 }}><span>🚫</span><div><div style={{ fontSize: 11, color: "var(--text3)" }}>Consolidation</div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--red)" }}>Solo load</div></div></div>}
                      {o.hazmat && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10 }}><span>☢️</span><div><div style={{ fontSize: 11, color: "var(--text3)" }}>Commodity</div><div style={{ fontWeight: 600, fontSize: 13, color: "var(--red)" }}>Hazmat</div></div></div>}
                    </div>
                  )}
                </div>

                {/* Related Shipments */}
                {relShips.length > 0 && (
                  <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>🚛 Related Shipments ({relShips.length})</div>
                    {relShips.map((sh) => (
                      <div key={sh.id} onClick={() => { setDetailOrder(null); window.location.href = `/shipments?id=${sh.id}`; }} style={{ background: "#f0f9ff", border: "1px solid rgba(59,130,246,.2)", borderRadius: 10, padding: "12px 16px", marginBottom: 8, cursor: "pointer", transition: "all .15s" }} onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(59,130,246,.12)"; }} onMouseOut={(e) => { e.currentTarget.style.borderColor = "rgba(59,130,246,.2)"; e.currentTarget.style.boxShadow = "none"; }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <span className="mono" style={{ color: "var(--accent)", fontWeight: 700 }}>{sh.id}</span>
                          <span className={STATUS_BADGES[sh.status] || "badge"}>{sh.status}</span>
                          <span style={{ marginLeft: "auto", fontWeight: 800, color: "var(--green)" }}>${Number(sh.total_cost || 0).toLocaleString()}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12 }}>
                          <div><span style={{ color: "var(--text3)" }}>Carrier: </span><strong>{sh.carrier}</strong></div>
                          <div><span style={{ color: "var(--text3)" }}>Pickup: </span>{sh.pickup_date || "—"}</div>
                          <div><span style={{ color: "var(--text3)" }}>Delivery: </span>{sh.delivery_date || "—"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {o.notes && (
                  <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>📝 Notes</div>
                    <div style={{ fontSize: 13, color: "var(--text2)", background: "#f8faff", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>{o.notes}</div>
                  </div>
                )}
              </>)}

              {/* ── EDIT TAB ── */}
              {detailTab === "edit" && (
                <div style={{ padding: "20px 24px" }}>
                  {/* Edit-as user selector */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f0f4ff", borderRadius: 10, border: "1px solid rgba(59,130,246,.2)", marginBottom: 20 }}>
                    <span style={{ fontSize: 16 }}>👤</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)" }}>Editing as:</span>
                    <select value={editUser} onChange={(e) => setEditUser(e.target.value)} style={{ padding: "5px 10px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 12, fontFamily: "inherit", background: "#fff" }}>
                      {DEMO_USERS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 4 }}>Changes will be attributed to this user in history</span>
                  </div>

                  {/* Order Identity */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>📋 Order Identity</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Customer</label><input value={editForm.customer || ""} onChange={(e) => setEditForm((f) => ({ ...f, customer: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Status</label><select value={editForm.status || "Unplanned"} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff", marginTop: 5 }}><option value="Unplanned">Unplanned</option><option value="Consolidated">Consolidated</option><option value="Cancelled">Cancelled</option></select></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Reference #</label><input value={editForm.refNum || ""} onChange={(e) => setEditForm((f) => ({ ...f, refNum: e.target.value }))} placeholder="e.g. PO-2026-001" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>PO Number</label><input value={editForm.poNum || ""} onChange={(e) => setEditForm((f) => ({ ...f, poNum: e.target.value }))} placeholder="e.g. 4500123456" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                    </div>
                  </div>

                  {/* Lane */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>🗺️ Lane</div>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Origin City</label><input value={editForm.originCity || ""} onChange={(e) => setEditForm((f) => ({ ...f, originCity: e.target.value }))} placeholder="e.g. Chicago" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>State</label><input value={editForm.originState || ""} onChange={(e) => setEditForm((f) => ({ ...f, originState: e.target.value }))} placeholder="IL" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>ZIP</label><input value={editForm.originZip || ""} onChange={(e) => setEditForm((f) => ({ ...f, originZip: e.target.value }))} placeholder="60601" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Dest City</label><input value={editForm.destCity || ""} onChange={(e) => setEditForm((f) => ({ ...f, destCity: e.target.value }))} placeholder="e.g. Dallas" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>State</label><input value={editForm.destState || ""} onChange={(e) => setEditForm((f) => ({ ...f, destState: e.target.value }))} placeholder="TX" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>ZIP</label><input value={editForm.destZip || ""} onChange={(e) => setEditForm((f) => ({ ...f, destZip: e.target.value }))} placeholder="75201" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                    </div>
                  </div>

                  {/* Freight Details */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>📦 Freight Details</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Weight (lbs)</label><input type="number" value={editForm.weight || ""} onChange={(e) => setEditForm((f) => ({ ...f, weight: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Pieces</label><input type="number" value={editForm.pieces || ""} onChange={(e) => setEditForm((f) => ({ ...f, pieces: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Mode</label><select value={editForm.shipMode || ""} onChange={(e) => setEditForm((f) => ({ ...f, shipMode: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff", marginTop: 5 }}><option value="">— TMS selects —</option>{["TL", "LTL", "Intermodal", "Flatbed", "Reefer", "Partial", "Expedite", "Air Freight"].map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Commodity</label><input value={editForm.commodity || ""} onChange={(e) => setEditForm((f) => ({ ...f, commodity: e.target.value }))} placeholder="e.g. Network Equipment" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Incoterms</label><input value={editForm.incoterms || ""} onChange={(e) => setEditForm((f) => ({ ...f, incoterms: e.target.value }))} placeholder="e.g. FOB, DAP, DDP" style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                    </div>
                  </div>

                  {/* Dates */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>📅 Dates</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Ready Date</label><input type="date" value={editForm.ready || ""} onChange={(e) => setEditForm((f) => ({ ...f, ready: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                      <div><label style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block" }}>Due Date</label><input type="date" value={editForm.due || ""} onChange={(e) => setEditForm((f) => ({ ...f, due: e.target.value }))} style={{ width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", marginTop: 5 }} /></div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>📝 Notes</div>
                    <textarea value={editForm.notes || ""} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Special instructions, references, internal notes..." style={{ width: "100%", padding: "9px 12px", border: "1.5px solid var(--border)", borderRadius: 9, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
                  </div>

                  {/* Line Items in edit */}
                  <div style={{ marginBottom: 16 }}>
                    <OrderLinesEditor orderId={o.id} lines={detailLines} onChange={setDetailLines} onSave={saveLines}
                      onClear={() => { if (window.confirm("Clear all lines?")) { OrdersApi.clearLines(o.id).then(() => { setDetailLines([]); toast("Lines cleared", "success"); }); } }}
                      busy={detailBusy} items={itemMaster} />
                  </div>
                </div>
              )}

              {/* ── HISTORY TAB ── */}
              {detailTab === "history" && (
                <div style={{ padding: "20px 24px" }}>
                  {histLog.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text3)" }}>
                      <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>No changes recorded yet</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>Edits made via the Edit tab will appear here with full field-level detail.</div>
                    </div>
                  ) : (<>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{histLog.length} change set{histLog.length !== 1 ? "s" : ""} recorded</div>
                      <button onClick={() => setOrderChangeLog((prev) => ({ ...prev, [o.id]: [] }))} style={{ padding: "4px 10px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 7, fontSize: 11, color: "var(--red)", cursor: "pointer", fontFamily: "inherit" }}>🗑 Clear History</button>
                    </div>
                    {histLog.map((entry, i) => {
                      const isPlan = entry.type === "plan"; const isUnassign = entry.type === "unassign";
                      const userColor = entry.user?.includes("System") ? "#6b7280" : "#1d4ed8";
                      const headerBg = isPlan ? "#f0f9ff" : isUnassign ? "#fff7ed" : "#f8faff";
                      const icon = isPlan ? "🚚" : isUnassign ? "🔓" : "👤";
                      const typeLabel = isPlan ? "Planned → Shipment" : isUnassign ? "Unassigned from Shipment" : `${entry.changes.length} field${entry.changes.length !== 1 ? "s" : ""} changed`;
                      const typeBg = isPlan ? "rgba(59,130,246,.12)" : isUnassign ? "rgba(245,158,11,.12)" : "rgba(59,130,246,.1)";
                      const typeColor = isPlan ? "#1d4ed8" : isUnassign ? "#b45309" : "var(--accent)";
                      return (
                        <div key={i} style={{ border: `1.5px solid ${isPlan ? "rgba(59,130,246,.25)" : isUnassign ? "rgba(245,158,11,.25)" : "var(--border)"}`, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: headerBg, borderBottom: "1px solid var(--border)" }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#1a237e,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{icon}</div>
                            <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13, color: userColor }}>{entry.user || "System"}</div><div style={{ fontSize: 11, color: "var(--text3)" }}>{entry.ts}</div></div>
                            <div style={{ fontSize: 11, fontWeight: 600, background: typeBg, color: typeColor, padding: "3px 10px", borderRadius: 10 }}>{typeLabel}</div>
                          </div>
                          <div style={{ padding: "8px 0" }}>
                            {entry.changes.map((ch, j) => (
                              <div key={j} style={{ display: "grid", gridTemplateColumns: "120px 1fr 20px 1fr", gap: 8, alignItems: "center", padding: "7px 14px", borderBottom: "1px solid var(--border)" }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.4 }}>{ch.label}</div>
                                <div style={{ fontSize: 12, background: "#fee2e2", color: "#7f1d1d", padding: "4px 10px", borderRadius: 7, textDecoration: "line-through", opacity: 0.8 }}>{ch.old || "—"}</div>
                                <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 12 }}>→</div>
                                <div style={{ fontSize: 12, background: "#dcfce7", color: "#14532d", padding: "4px 10px", borderRadius: 7, fontWeight: 600 }}>{ch.new || "—"}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </>)}
                </div>
              )}
            </div>

            {/* Footer */}
            {detailTab === "view" && (
              <div style={{ padding: "14px 24px", background: "#f8faff", display: "flex", gap: 8, borderRadius: "0 0 16px 16px", borderTop: "1.5px solid var(--border)" }}>
                {o.status === "Unplanned" && <button className="btn btn-primary btn-sm" onClick={() => openPlanModal(o.id)} style={{ background: "linear-gradient(135deg,#059669,#10b981)", border: "none" }}>⚡ Plan This Order</button>}
                {(o.status === "Planned" || o.status === "Consolidated") && <button className="btn btn-sm" style={{ background: "#dc2626", color: "#fff", border: "none" }} onClick={() => unplanOrder(o.id)}>🔓 Unplan</button>}
                <button className="btn btn-secondary btn-sm" onClick={() => setDetailTab("edit")}>✏️ Edit Order</button>
                {histLog.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setDetailTab("history")} style={{ marginLeft: "auto" }}>🕐 History ({histLog.length})</button>}
              </div>
            )}
            {detailTab === "edit" && (
              <div style={{ padding: "14px 22px", background: "#f8faff", borderTop: "1.5px solid var(--border)", borderRadius: "0 0 16px 16px", display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: editStatus ? "var(--text3)" : "transparent", flex: 1 }}>{editStatus || "."}</span>
                <button className="btn btn-secondary" onClick={() => setDetailTab("view")}>Cancel</button>
                <button className="btn btn-primary" onClick={saveOrderEdit} disabled={detailBusy} style={{ background: "linear-gradient(135deg,#1a237e,#6366f1)", border: "none" }}>💾 Save Changes</button>
              </div>
            )}
            {detailTab === "history" && (
              <div style={{ padding: "14px 22px", background: "#f8faff", borderTop: "1.5px solid var(--border)", borderRadius: "0 0 16px 16px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-secondary" onClick={() => setDetailTab("view")}>Back to Details</button>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* ═══ PLAN CONFIRMATION MODAL (matches old HTML) ═══ */}
      {planModal && (() => {
        const { lane, siblings, quotes, selectedIdx, bestQuote, busy, error, maxWt, util, loadDuration, equipType } = planModal;
        const equip = EQUIPMENT_TYPES[equipType] || EQUIPMENT_TYPES[DEFAULT_EQUIP];
        const utilColor = util >= 90 ? "var(--green)" : util >= 70 ? "var(--yellow)" : "var(--accent)";
        // Latest ready date = can't ship before this
        const readyDate = siblings?.map((s) => s.ready).filter(Boolean).sort().reverse()[0] || "";
        const earliestDue = siblings?.map((s) => s.due).filter(Boolean).sort()[0] || "";
        return (
        <div className="modal-overlay" onClick={() => !busy && setPlanModal(null)}>
          <div className="modal-card" style={{ width: 680, maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔒 Plan {lane.orderIds.length} Order{lane.orderIds.length !== 1 ? "s" : ""} → 1 Shipment</h3>
              <button className="modal-close" onClick={() => !busy && setPlanModal(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ overflowY: "auto", flex: 1 }}>
              {/* Equipment Selector */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#f0f4ff", borderRadius: 10, marginBottom: 14, border: "1px solid rgba(59,130,246,.15)" }}>
                <span style={{ fontSize: 14 }}>🚛</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>Equipment:</span>
                <select
                  value={equipType}
                  onChange={(e) => {
                    const newEquip = e.target.value;
                    const newMax = EQUIPMENT_TYPES[newEquip].maxWeight;
                    const newUtil = Math.round((lane.totalWeight / newMax) * 100);
                    setPlanModal((p) => p ? { ...p, equipType: newEquip, maxWt: newMax, util: newUtil } : null);
                  }}
                  style={{ padding: "4px 9px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 12, fontFamily: "inherit", background: "#fff" }}
                >
                  {Object.entries(EQUIPMENT_TYPES).map(([name, eq]) => (
                    <option key={name} value={name}>{eq.icon} {name} (Max {eq.maxWeight.toLocaleString()} lbs)</option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>Max: <strong style={{ color: "var(--accent)" }}>{maxWt.toLocaleString()} lbs</strong> per trailer</span>
              </div>

              {/* Dock Reservation */}
              <div style={{ padding: "12px 14px", background: "rgba(99,102,241,.04)", border: "1px solid rgba(99,102,241,.15)", borderRadius: 10, marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: "#6366f1" }} />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Reserve Dock Door During Planning</span>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--accent2)", fontWeight: 600 }}>Estimated Load Time: {loadDuration} min</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Ship-From Dock (Auto)</div>
                <div style={{ padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  {(lane.origin || "").split(",")[0]}, {(lane.origin || "").split(",")[1]?.trim() || ""} · Door 1 · 06:00–08:00 ({loadDuration} min)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>Loading Duration</span>
                  <select value={loadDuration} onChange={(e) => setPlanModal((p) => p ? { ...p, loadDuration: Number(e.target.value) } : null)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 11 }}>
                    <option value={60}>60 min</option><option value={90}>90 min</option><option value={120}>120 min</option><option value={150}>150 min</option><option value={180}>180 min</option>
                  </select>
                </div>
                <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 6 }}>Rule of thumb: TL usually 60–120 min, LTL 45–90 min. Auto-estimate uses weight, pieces, and mode.</div>
              </div>

              {/* Shipment Card */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>1 Shipment to Create</div>
              <div style={{ padding: "14px 16px", background: "#fff", border: "1.5px solid rgba(99,102,241,.2)", borderRadius: 12, marginBottom: 12 }}>
                {/* Lane header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13 }}>1</span>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{(lane.origin || "").split(",")[0]} → {(lane.destination || "").split(",")[0]}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: utilColor }}>{util}% Full</span>
                </div>
                {/* Orders in shipment */}
                {siblings?.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text2)", padding: "2px 0 2px 36px" }}>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{s.id}</span>
                    <span>{s.customer}</span>
                    <span>{s.commodity || "General"}</span>
                    <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(s.weight || 0).toLocaleString()} lbs</span>
                  </div>
                ))}
                {/* Weight bar */}
                <div style={{ marginTop: 10, paddingLeft: 36 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>Weight</span>
                    <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: utilColor, fontWeight: 600 }}>{lane.totalWeight.toLocaleString()} / {maxWt.toLocaleString()} lbs</span>
                  </div>
                  <div style={{ background: "#f1f5f9", borderRadius: 5, height: 6 }}>
                    <div style={{ width: `${Math.min(100, util)}%`, background: utilColor, borderRadius: 5, height: 6 }} />
                  </div>
                  {lane.totalWeight > maxWt && <div style={{ fontSize: 10, color: "var(--red)", marginTop: 3, fontWeight: 600 }}>⚠️ Exceeds weight limit by {(lane.totalWeight - maxWt).toLocaleString()} lbs</div>}
                </div>

                {/* Rate options as compact radio rows */}
                <div style={{ marginTop: 14, paddingLeft: 0 }}>
                  {busy && !quotes.length && (
                    <div style={{ textAlign: "center", padding: 20, color: "var(--text3)" }}>
                      <div className="spinner" style={{ margin: "0 auto 8px" }} /><div style={{ fontSize: 12 }}>Fetching carrier rates...</div>
                    </div>
                  )}
                  {error && <div style={{ padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 8, color: "#991b1b", fontSize: 12, marginBottom: 8 }}>{error}</div>}
                  {quotes.map((quote, i) => {
                    if (!(quote.transitDays > 0)) return null;
                    const isSelected = selectedIdx === i;
                    const isExp = (quote.serviceLevel || "").toLowerCase().includes("express");
                    const svcTag = isExp ? "EXP" : "STD";
                    const rMode = quote.mode || "TL";
                    const dates = calcDates(quote, earliestDue, readyDate);
                    const isPref = quote.preferred;
                    const isCzarlite = quote.czarlite || rMode === "LTL";
                    return (
                      <div key={i}
                        onClick={() => setPlanModal((prev) => prev ? { ...prev, selectedIdx: i } : null)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginBottom: 4,
                          borderRadius: 8, cursor: "pointer",
                          border: isSelected ? "1px solid rgba(16,185,129,.2)" : "1px solid var(--border)",
                          background: isSelected ? "rgba(16,185,129,.06)" : "var(--bg4)",
                        }}
                      >
                        <input type="radio" name="plan-rate" checked={isSelected} readOnly style={{ margin: 0, accentColor: "var(--accent)" }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: isSelected ? 700 : 500, fontSize: 12 }}>{quote.carrier}</span>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: rMode === "LTL" ? "rgba(99,102,241,.12)" : "rgba(16,185,129,.12)", color: rMode === "LTL" ? "#4f46e5" : "#059669" }}>{rMode}</span>
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: isExp ? "rgba(124,58,237,.12)" : "rgba(107,114,128,.1)", color: isExp ? "#7c3aed" : "#6b7280" }}>{svcTag}{isExp ? " 🚛🚛" : ""}</span>
                            {isPref && <span style={{ fontSize: 9, background: "rgba(59,130,246,.1)", color: "var(--accent)", border: "1px solid rgba(59,130,246,.2)", padding: "1px 6px", borderRadius: 8, fontWeight: 700 }}>⭐ PREF</span>}
                            {isSelected && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: "rgba(16,185,129,.12)", color: "#059669" }}>✓ SELECTED</span>}
                            {isCzarlite && <span style={{ fontSize: 9, background: "rgba(99,102,241,.1)", color: "#4f46e5", padding: "1px 6px", borderRadius: 8, fontWeight: 600 }}>CZARLITE</span>}
                          </div>
                          <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 10, color: "var(--text3)", whiteSpace: "nowrap", flexWrap: "nowrap", overflow: "hidden" }}>
                            <span>🚚 {dates.transit}D</span>
                            {quote.miles && <span>📏 {quote.miles.toLocaleString()} mi{quote.pcmilerMiles ? " (PC*MILER)" : ""}</span>}
                            <span>📦 {dates.pickup}</span>
                            <span>🏁 {dates.delivery}</span>
                          </div>
                          <div style={{ display: "flex", gap: 10, marginTop: 2, fontSize: 9, color: "var(--text3)" }}>
                            <span>Base: {fmt$(quote.czarBaseGross || quote.czarBase || 0)}</span>
                            <span>Fuel: {fmt$(quote.fscCharge || 0)}</span>
                            {(quote.accessorialCharge || 0) > 0 && <span>Acc: {fmt$(quote.accessorialCharge)}</span>}
                          </div>
                          {dates.warning && <div style={{ marginTop: 3, fontSize: 9, color: "#dc2626", fontWeight: 600 }}>⚠️ {dates.warning}</div>}
                        </div>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: isSelected ? 800 : 600, fontSize: 13, color: isSelected ? "var(--green)" : "var(--text2)" }}>{fmt$(quote.totalCharge)}</span>
                      </div>
                    );
                  })}
                  {!busy && quotes.filter((q) => q.transitDays > 0).length === 0 && !error && <div style={{ textAlign: "center", padding: 20, color: "var(--text3)", fontSize: 12 }}>No carrier quotes with valid transit data. Configure transit_days in rate table or enable CarrierConnect.</div>}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPlanModal(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-secondary">✏️ Manual Plan</button>
              <button className="btn btn-secondary" style={{ background: "rgba(124,58,237,.08)", color: "#7c3aed", borderColor: "rgba(124,58,237,.3)" }}>🔄 Cross-Dock</button>
              <button className="btn btn-primary" disabled={busy || quotes.length === 0} onClick={confirmPlan} style={{ background: "linear-gradient(135deg,#059669,#10b981)", border: "none" }}>
                {busy ? "Creating..." : "✅ Confirm & Create Shipment"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ═══ PLAN SUMMARY MODAL (after shipment creation) ═══ */}
      {planSummary && (() => {
        // Multi-stop summary
        if (planSummary.isMultiStop) {
          const { masterShipment, childShipments, ordersUpdated, totalCost, carrier, mode, siblings } = planSummary;
          const totalShipments = 1 + childShipments.length;
          return (
          <div className="modal-overlay" onClick={() => setPlanSummary(null)}>
            <div className="modal-card" style={{ width: 640, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ background: "linear-gradient(135deg,#1e40af,#6366f1)", borderRadius: "16px 16px 0 0", padding: "18px 24px", color: "#fff" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.8, marginBottom: 4 }}>Planning Complete</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>Multi-Stop Shipment Created</div>
              </div>
              <div className="modal-body" style={{ flex: 1, overflowY: "auto" }}>
                {/* KPI cards */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
                  <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid rgba(99,102,241,.2)", borderRadius: 12 }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: "#6366f1" }}>{totalShipments}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Shipments</div>
                  </div>
                  <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid var(--border)", borderRadius: 12 }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26 }}>{ordersUpdated}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Orders Planned</div>
                  </div>
                  <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid rgba(5,150,105,.2)", borderRadius: 12 }}>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: "var(--green)" }}>{fmt$(totalCost)}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Total Est. Cost</div>
                  </div>
                </div>

                {/* MBOL Card */}
                <div style={{ border: "2px solid rgba(99,102,241,.25)", borderRadius: 12, padding: "16px 18px", marginBottom: 16, background: "rgba(99,102,241,.03)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span className="badge badge-blue" style={{ fontSize: 10 }}>MBOL</span>
                    <a href={`/shipments?id=${masterShipment.id}`} onClick={(e) => { e.preventDefault(); setPlanSummary(null); window.location.href = `/shipments?id=${masterShipment.id}`; }} style={{ fontWeight: 700, fontSize: 14, color: "var(--accent)", textDecoration: "none", cursor: "pointer" }}>{masterShipment.id}</a>
                    <span className="badge badge-green" style={{ fontSize: 10 }}>Planned</span>
                    <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--green)" }}>{fmt$(totalCost)}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>📍 {masterShipment.routePath}</div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text3)" }}>
                    <span>{carrier} · {mode}</span>
                    <span>{(masterShipment.miles || 0).toLocaleString()} mi</span>
                    <span>{(masterShipment.weight || 0).toLocaleString()} lbs</span>
                  </div>
                </div>

                {/* CBOL Cards */}
                {childShipments.map((cbol, idx) => (
                  <div key={cbol.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span className="badge badge-teal" style={{ fontSize: 10 }}>CBOL</span>
                      <a href={`/shipments?id=${cbol.id}`} onClick={(e) => { e.preventDefault(); setPlanSummary(null); window.location.href = `/shipments?id=${cbol.id}`; }} style={{ fontWeight: 600, fontSize: 13, color: "var(--accent)", textDecoration: "none", cursor: "pointer" }}>{cbol.id}</a>
                      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--green)" }}>{fmt$(cbol.cost)}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>📍 {(cbol.origin || "").split(",")[0]} → {(cbol.dest || "").split(",")[0]}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>{(cbol.miles || 0).toLocaleString()} mi</div>
                    {/* Assigned orders */}
                    {cbol.orders.map((o) => (
                      <div key={o.id} style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text2)", padding: "2px 0" }}>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: "var(--accent)" }}>{o.id}</span>
                        <span>{o.customer}</span>
                        <span>{o.commodity || "General"}</span>
                        <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(o.weight || 0).toLocaleString()} lbs</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setPlanSummary(null)}>Close</button>
                <button className="btn btn-primary" onClick={() => { setPlanSummary(null); window.location.href = "/shipments"; }}>📦 View All Shipments</button>
              </div>
            </div>
          </div>
          );
        }

        // Single shipment summary (existing)
        const { shipments, ordersUpdated, totalCost, carrier, mode, lane, siblings, dates } = planSummary;
        const shp = shipments[0];
        return (
        <div className="modal-overlay" onClick={() => setPlanSummary(null)}>
          <div className="modal-card" style={{ width: 580 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ background: "linear-gradient(135deg,#059669,#10b981)", borderRadius: "16px 16px 0 0", padding: "18px 24px", color: "#fff" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.8, marginBottom: 4 }}>Planning Complete</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18 }}>{shipments.length} Shipment Created Successfully</div>
            </div>
            <div className="modal-body">
              {/* KPI cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
                <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid rgba(5,150,105,.2)", borderRadius: 12 }}>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: "var(--green)" }}>{shipments.length}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Shipments</div>
                </div>
                <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid var(--border)", borderRadius: 12 }}>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26 }}>{ordersUpdated}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Orders Planned</div>
                </div>
                <div style={{ textAlign: "center", padding: "14px 10px", border: "2px solid rgba(5,150,105,.2)", borderRadius: 12 }}>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, color: "var(--green)" }}>{fmt$(totalCost)}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", fontWeight: 600 }}>Total Est. Cost</div>
                </div>
              </div>

              {/* Shipment detail */}
              {shp && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 18 }}>🚛</span>
                    <div>
                      <a href={`/shipments?id=${shp.id}`} onClick={(e) => { e.preventDefault(); setPlanSummary(null); window.location.href = `/shipments?id=${shp.id}`; }} style={{ fontWeight: 700, fontSize: 14, color: "var(--accent)", textDecoration: "none", cursor: "pointer" }}>{shp.id}</a>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{carrier} · {mode}</div>
                      <span className="badge badge-green" style={{ fontSize: 10, marginTop: 2 }}>✓ Planned</span>
                    </div>
                  </div>

                  {/* Lane */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid var(--border)", marginTop: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>📍 {(lane?.origin || "").split(",")[0]} → {(lane?.destination || "").split(",")[0]}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--green)" }}>{fmt$(totalCost)}</span>
                  </div>

                  {/* Orders */}
                  <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>{ordersUpdated} Order{ordersUpdated !== 1 ? "s" : ""} Consolidated</div>
                  {siblings?.map((s) => (
                    <div key={s.id} style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--text2)", padding: "2px 0" }}>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: "var(--accent)" }}>{s.id}</span>
                      <span>{s.customer}</span>
                      <span>{s.commodity || "General"}</span>
                      <span style={{ marginLeft: "auto", fontWeight: 600 }}>{Number(s.weight || 0).toLocaleString()} lbs</span>
                    </div>
                  ))}

                  {/* Dates */}
                  {dates && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
                      <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase" }}>Weight</div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{(lane?.totalWeight || 0).toLocaleString()} lbs</div>
                      </div>
                      <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase" }}>Pickup</div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{dates.pickup}</div>
                      </div>
                      <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: "var(--text3)", textTransform: "uppercase" }}>Delivery</div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{dates.delivery}</div>
                      </div>
                    </div>
                  )}
                  <a href={`/shipments?id=${shp.id}`} onClick={(e) => { e.preventDefault(); setPlanSummary(null); window.location.href = `/shipments?id=${shp.id}`; }} style={{ display: "block", textAlign: "right", marginTop: 8, fontSize: 11, color: "var(--accent)", cursor: "pointer", textDecoration: "none" }}>Click to view full details →</a>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setPlanSummary(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => { setPlanSummary(null); window.location.href = "/shipments"; }}>📦 View All Shipments</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ═══ NEW ORDER MODAL ═══ */}
      {showNewOrder && (() => {
        const nf = newOrderForm;
        const upd = (k, v) => setNewOrderForm((f) => ({ ...f, [k]: v }));
        const carrierNames = carriers.map((c) => c.name).filter(Boolean).sort();
        const inputSt = { width: "100%", padding: "8px 10px", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" };
        const labelSt = { fontSize: 11, fontWeight: 700, color: "var(--text3)", display: "block", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 };
        return (
        <div className="modal-overlay" onClick={() => setShowNewOrder(false)}>
          <div className="modal-card" style={{ width: 620, maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>New Order</h3>
              <button className="modal-close" onClick={() => setShowNewOrder(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ overflowY: "auto", flex: 1 }}>
              {/* Customer */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Customer</label>
                <input value={nf.customer} onChange={(e) => upd("customer", e.target.value)} placeholder="Cisco Systems" style={inputSt} />
              </div>
              {/* Origin */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Origin</label>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                  <input value={nf.originCity} onChange={(e) => upd("originCity", e.target.value)} placeholder="City (e.g. Chicago)" style={inputSt} />
                  <input value={nf.originState} onChange={(e) => upd("originState", e.target.value)} placeholder="ST" maxLength={2} style={{ ...inputSt, textTransform: "uppercase" }} />
                  <input value={nf.originZip} onChange={(e) => upd("originZip", e.target.value)} placeholder="ZIP" maxLength={5} style={inputSt} />
                </div>
              </div>
              {/* Destination */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelSt}>Destination</label>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                  <input value={nf.destCity} onChange={(e) => upd("destCity", e.target.value)} placeholder="City (e.g. Dallas)" style={inputSt} />
                  <input value={nf.destState} onChange={(e) => upd("destState", e.target.value)} placeholder="ST" maxLength={2} style={{ ...inputSt, textTransform: "uppercase" }} />
                  <input value={nf.destZip} onChange={(e) => upd("destZip", e.target.value)} placeholder="ZIP" maxLength={5} style={inputSt} />
                </div>
              </div>
              {/* Commodity + Incoterms */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div><label style={labelSt}>Commodity</label><input value={nf.commodity} onChange={(e) => upd("commodity", e.target.value)} placeholder="Network Equipment" style={inputSt} /></div>
                <div><label style={labelSt}>Incoterms <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}>(optional)</span></label>
                  <select value={nf.incoterms} onChange={(e) => upd("incoterms", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                    <option value="">— Select —</option>
                    {["EXW","FCA","CPT","CIP","DAP","DPU","DDP","FAS","FOB","CFR","CIF"].map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              {/* Dates */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
                <div><label style={labelSt}>Ready Date</label><input type="date" value={nf.ready} onChange={(e) => upd("ready", e.target.value)} style={inputSt} /></div>
                <div><label style={labelSt}>Due Date</label><input type="date" value={nf.due} onChange={(e) => upd("due", e.target.value)} style={inputSt} /></div>
              </div>
              {/* Line Items */}
              <OrderLinesEditor orderId="new" lines={newOrderLines} onChange={setNewOrderLines} onSave={() => {}} onClear={() => setNewOrderLines([])} busy={false} items={itemMaster} showSaveButtons={false} />
              {/* Planning Constraints */}
              <div style={{ marginTop: 14, padding: "14px 16px", background: "#f8faff", borderRadius: 10, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>⚙️ Planning Constraints <span style={{ fontWeight: 400, fontSize: 10, letterSpacing: 0 }}>(optional)</span></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                  <div><label style={labelSt}>Preferred Carrier</label>
                    <select value={nf.preferredCarrier} onChange={(e) => upd("preferredCarrier", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                      <option value="">No preference (auto-select cheapest)</option>
                      {carrierNames.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><label style={labelSt}>Excluded Carrier</label>
                    <select value={nf.excludedCarrier} onChange={(e) => upd("excludedCarrier", e.target.value)} style={{ ...inputSt, background: "#fff" }}>
                      <option value="">None</option>
                      {carrierNames.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 400, color: "var(--text)" }}>
                    <input type="checkbox" checked={nf.noConsolidate} onChange={(e) => upd("noConsolidate", e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)" }} />
                    <div><div style={{ fontWeight: 600 }}>Do not consolidate</div><div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>This order must ship as a standalone load — it will not be grouped with other orders on the same lane</div></div>
                  </label>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 400, color: "var(--text)" }}>
                    <input type="checkbox" checked={nf.dedicatedEquip} onChange={(e) => upd("dedicatedEquip", e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)" }} />
                    <div><div style={{ fontWeight: 600 }}>Dedicated equipment required</div><div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>Requires a dedicated trailer — cannot share equipment with other shipments</div></div>
                  </label>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 400, color: "var(--text)" }}>
                    <input type="checkbox" checked={nf.hazmat} onChange={(e) => upd("hazmat", e.target.checked)} style={{ width: 16, height: 16, marginTop: 2, accentColor: "var(--accent)" }} />
                    <div><div style={{ fontWeight: 600 }}>Hazmat / Restricted commodity</div><div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>Requires hazmat-certified carrier and cannot be consolidated with non-hazmat freight</div></div>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowNewOrder(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createOrder} disabled={detailBusy}>Create Order</button>
            </div>
          </div>
        </div>
        );
      })()}

      </div>
    </div>
  );
}
