import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { DbApi, OrdersApi, BulkPlanApi } from "../lib/api";
import OrderLinesEditor from "../components/OrderLinesEditor";
import { STATUS_BADGES, STATUS_ROW_COLORS, SPOT_ROW_STYLE, EQUIPMENT_TYPES, DEFAULT_EQUIP, LTL_MAX_WEIGHT, DEMO_USERS } from "../constants/orders";
import { fmt$, addBusinessDays, calcDates, cityZipLookup, constraintBadges, SdField } from "../utils/orderUtils.jsx";
import { createShipmentsFromRoute, unplanOrderFromShipment, executeSinglePlan, fetchCarrierQuotes, bulkPlanOrders, findMatchingRoute, buildShipmentGroups, datesCompatibleWithTransit, buildLocationString, copyOrder } from "../services/ordersService";
import { assignDockToPlan } from "../services/dockService";
import { isFeatureEnabled } from "../services/planningParametersService";
import { getDockConfigForWarehouse } from "../services/dockScheduleService";
import PlanSummaryModal from "../components/orders/PlanSummaryModal";
import PlanConfirmationModal from "../components/orders/PlanConfirmationModal";
import NewOrderModal from "../components/orders/NewOrderModal";
import OrderDetailModal from "../components/orders/OrderDetailModal";

export default function OrdersPage() {
  const { orders, shipments, carriers, rates = [], setData, refreshData, routeTemplates, planningParameters, warehouseDockConfigs = [] } = useOutletContext();
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

  /* ── Lane normalization: lowercase + collapse whitespace (ZIP preserved — different ZIP = different lane) ── */
  const normalizeLane = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

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
        const ka = `${normalizeLane(a.origin)}||${normalizeLane(a.dest)}`;
        const kb = `${normalizeLane(b.origin)}||${normalizeLane(b.dest)}`;
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
      const key = `${normalizeLane(o.origin)}||${normalizeLane(o.dest)}`;
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

  async function handleCopyOrder(id) {
    const source = orders.find((o) => o.id === id);
    if (!source) return;
    setBusyId(id);
    try {
      const newOrder = await copyOrder(source);
      toast(`Copied ${id} → ${newOrder.id}`, "success");
      await refreshData();
      openDetail(newOrder.id);
    } catch (err) { toast(`Copy failed: ${err.message}`, "error"); }
    finally { setBusyId(""); }
  }

  async function unplanOrder(id) {
    if (!window.confirm(`Unplan order ${id}?`)) return;
    setBusyId(id);
    try {
      const result = await unplanOrderFromShipment(id, orders, shipments);
      toast(result.message, "success");
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
    const newOrigin = buildLocationString(f.originCity, f.originState, f.originZip);
    const newDest = buildLocationString(f.destCity, f.destState, f.destZip);
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
    const origin = buildLocationString(f.originCity, f.originState, f.originZip);
    const dest = buildLocationString(f.destCity, f.destState, f.destZip);
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

  /* ── Date helpers & city lookups imported from utils/orderUtils ── */

  /* ── Create shipments from multi-stop route (via service) ── */
  async function handleCreateShipmentsFromRoute(route, ordersList, skipSummary = false) {
    setBusyId("multi-stop");
    try {
      const result = await createShipmentsFromRoute(route, ordersList, rates);
      if (result.error) { toast(result.error, "error"); return null; }
      const summaryData = {
        isMultiStop: true,
        masterShipment: result.masterShipment,
        childShipments: result.childShipments,
        ordersUpdated: result.ordersUpdated,
        totalCost: parseFloat(route.cost_override) || 0,
        carrier: route.carrier,
        mode: route.mode || "TL",
        siblings: ordersList,
      };
      if (!skipSummary) {
        setPlanSummary(summaryData);
      }
      await refreshData();
      return summaryData;
    } catch (err) {
      toast(`Multi-stop plan failed: ${err.message}`, "error");
      return null;
    } finally {
      setBusyId("");
    }
  }

  /* ── Plan Selected: directly create shipments for all selected orders ── */
  async function planSelected() {
    const selected = orders.filter((o) => selectedOrders.has(o.id) && o.status === "Unplanned");
    if (!selected.length) { toast("No unplanned orders selected", "warning"); return; }

    const normalize = (s) => (s || "").trim().toLowerCase().split(",")[0].trim();
    setBusyId("plan-selected");
    const planStartTime = Date.now();
    try {
      // 1. Check for multi-stop route matches
      let templates = Array.isArray(routeTemplates) ? routeTemplates : [];
      if (templates.length === 0) {
        try { templates = await DbApi.routeTemplates() || []; } catch { /* ignore */ }
      }
      const routeMatch = findMatchingRoute(templates, selected);
      let routePlanned = [];
      let multiStopSummary = null;
      if (routeMatch) {
        multiStopSummary = await handleCreateShipmentsFromRoute(routeMatch.route, routeMatch.matchedOrders, true);
        if (multiStopSummary) routePlanned = routeMatch.matchedOrders;
      }

      // 2. Remaining orders — group by lane, rate, and auto-plan
      const remaining = selected.filter((o) => !routePlanned.includes(o));
      let bulkResult = null;
      if (remaining.length > 0) {
        const dockOn = isFeatureEnabled(planningParameters, "dock_scheduling");
        bulkResult = await bulkPlanOrders(remaining, shipments, dockOn, warehouseDockConfigs);
        if (bulkResult.noQuotes && routePlanned.length === 0) {
          toast("No carrier quotes available for selected orders.", "warning");
        }
      }

      // 3. Build unified summary combining multi-stop + bulk results
      const bulkPlannedCount = bulkResult?.updated || 0;
      const totalPlanned = routePlanned.length + bulkPlannedCount;
      const routeCost = routeMatch ? (parseFloat(routeMatch.route.cost_override) || 0) : 0;
      const bulkCost = bulkResult?.cost || 0;

      // Build unified summary
      setPlanSummary({
        isCombined: true,
        multiStop: multiStopSummary,
        bulkShipments: bulkResult?.shipments || [],
        bulkPlans: bulkResult?.plans || [],
        bulkSiblings: remaining,
        ordersUpdated: totalPlanned,
        totalCost: routeCost + bulkCost,
        siblings: selected,
        elapsedMs: Date.now() - planStartTime,
      });
      setSelectedOrders(new Set());
      await refreshData();
    } catch (err) {
      toast(`Plan failed: ${err.message}`, "error");
    } finally {
      setBusyId("");
    }
  }

  /* ── Open Plan Confirmation Modal (single order — shows carrier options) ── */
  async function openPlanModal(orderId, consolidate = false) {
    const o = orders.find((x) => x.id === orderId);
    if (!o || o.status !== "Unplanned") return;
    // consolidate=true: group all same-lane orders (normalized). false: just this order.
    const sibs = consolidate
      ? orders.filter((x) => x.status === "Unplanned" && normalizeLane(x.origin) === normalizeLane(o.origin) && normalizeLane(x.dest) === normalizeLane(o.dest))
      : [o];

    const totalWeight = sibs.reduce((s, x) => s + Number(x.weight || 0), 0);
    const totalPieces = sibs.reduce((s, x) => s + Number(x.pieces || 0), 0);
    const originZip = String(o.origin_zip || o.origin || "").match(/\b(\d{5})\b/)?.[1] || cityZipLookup(o.origin);
    const destZip = String(o.dest_zip || o.dest || "").match(/\b(\d{5})\b/)?.[1] || cityZipLookup(o.dest);

    const baseLane = {
      laneKey: `${o.origin || ""} -> ${o.dest || ""}`, origin: o.origin || "", destination: o.dest || "",
      originZip, destZip, freightClass: o.freight_class || "70", totalWeight, totalPieces,
      orderIds: sibs.map((x) => x.id),
    };

    // Split into shipment groups by equipment max weight (not LTL max).
    // If total > LTL, use TL equipment max (44,000 lbs) so compatible orders consolidate as TL.
    const equipMaxWeight = totalWeight <= LTL_MAX_WEIGHT
      ? LTL_MAX_WEIGHT
      : EQUIPMENT_TYPES[DEFAULT_EQUIP].maxWeight;
    const groups = buildShipmentGroups(sibs, baseLane, equipMaxWeight);
    const shipmentGroups = groups.map((g) => {
      const gWeight = g.lane.totalWeight;
      const autoEquip = gWeight <= LTL_MAX_WEIGHT ? "LTL Truck" : DEFAULT_EQUIP;
      const maxWt = EQUIPMENT_TYPES[autoEquip].maxWeight;
      return {
        lane: g.lane,
        orders: g.orders,
        equipType: autoEquip,
        maxWt,
        util: Math.round((gWeight / maxWt) * 100),
        quotes: [],
        selectedIdx: 0,
        bestQuote: null,
      };
    });

    const firstEquip = shipmentGroups[0]?.equipType || DEFAULT_EQUIP;
    const firstMaxWt = shipmentGroups[0]?.maxWt || EQUIPMENT_TYPES[DEFAULT_EQUIP].maxWeight;
    const firstUtil = shipmentGroups[0]?.util || 0;

    const dockSchedulingOn = isFeatureEnabled(planningParameters, "dock_scheduling");
    setPlanModal({
      order: o, siblings: sibs, lane: baseLane,
      quotes: [], selectedIdx: 0, busy: true, error: "",
      maxWt: firstMaxWt, util: firstUtil, loadDuration: 120, equipType: firstEquip,
      shipmentGroups,
      reserveDock: dockSchedulingOn,
      dockSchedulingEnabled: dockSchedulingOn,
    });
    setDetailOrder(null);
    const ratingStart = Date.now();

    try {
      // Rate each shipment group independently
      let ratedGroups = await Promise.all(
        shipmentGroups.map(async (sg) => {
          const readyD = sg.orders.map((s) => s.ready).filter(Boolean).sort().reverse()[0] || "";
          const dueD = sg.orders.map((s) => s.due).filter(Boolean).sort()[0] || "";
          const { quotes, bestQuote } = await fetchCarrierQuotes(sg.lane, calcDates, dueD, readyD);
          return { ...sg, quotes, bestQuote };
        })
      );

      // Post-rating date check: use actual transit to find the largest subset with compatible dates.
      // Progressively remove orders whose dates conflict until the remaining group works.
      const finalGroups = [];
      for (const sg of ratedGroups) {
        const transit = sg.bestQuote?.transitDays;
        if (sg.orders.length > 1 && transit && !datesCompatibleWithTransit(sg.orders, transit)) {
          console.log(`[PlanGroup] Group dates incompatible with ${transit}d transit — finding best subset`);

          // Find which orders conflict: remove orders whose ready date is too late
          // or whose due date is too tight for the group.
          // Strategy: sort orders by due date, progressively build the largest compatible subset.
          const sorted = [...sg.orders].sort((a, b) => {
            const dueA = a.due || a.delivery_date || "9999";
            const dueB = b.due || b.delivery_date || "9999";
            return dueA.localeCompare(dueB);
          });

          // Try subsets from largest to smallest
          let bestSubset = null;
          for (let size = sorted.length - 1; size >= 2; size--) {
            // Try removing each order one at a time, check if remainder is compatible
            for (let skip = 0; skip < sorted.length; skip++) {
              const subset = sorted.filter((_, idx) => idx !== skip);
              if (subset.length === size && datesCompatibleWithTransit(subset, transit)) {
                bestSubset = subset;
                break;
              }
            }
            if (bestSubset) break;
          }

          if (bestSubset) {
            // Rate the compatible subset as a consolidated group
            const subsetIds = new Set(bestSubset.map(o => o.id));
            const remainder = sg.orders.filter(o => !subsetIds.has(o.id));
            const subsetWeight = bestSubset.reduce((s, o) => s + Number(o.weight || 0), 0);
            const subsetPieces = bestSubset.reduce((s, o) => s + Number(o.pieces || 0), 0);
            const subsetLane = { ...sg.lane, totalWeight: subsetWeight, totalPieces: subsetPieces, orderIds: bestSubset.map(o => o.id) };
            const subsetEquip = subsetWeight <= LTL_MAX_WEIGHT ? "LTL Truck" : DEFAULT_EQUIP;
            const subsetMaxWt = EQUIPMENT_TYPES[subsetEquip].maxWeight;

            const readyD = bestSubset.map(o => o.ready).filter(Boolean).sort().reverse()[0] || "";
            const dueD = bestSubset.map(o => o.due).filter(Boolean).sort()[0] || "";
            const { quotes: subQuotes, bestQuote: subBest } = await fetchCarrierQuotes(subsetLane, calcDates, dueD, readyD);

            finalGroups.push({
              lane: subsetLane, orders: bestSubset, equipType: subsetEquip,
              maxWt: subsetMaxWt, util: Math.round((subsetWeight / subsetMaxWt) * 100),
              quotes: subQuotes, selectedIdx: 0, bestQuote: subBest,
            });

            // Rate remainder individually
            for (const order of remainder) {
              const singleLane = { ...sg.lane, totalWeight: Number(order.weight || 0), totalPieces: Number(order.pieces || 0), orderIds: [order.id] };
              const singleEquip = Number(order.weight || 0) <= LTL_MAX_WEIGHT ? "LTL Truck" : DEFAULT_EQUIP;
              const singleMaxWt = EQUIPMENT_TYPES[singleEquip].maxWeight;
              const { quotes, bestQuote } = await fetchCarrierQuotes(singleLane, calcDates, order.due || "", order.ready || "");
              finalGroups.push({
                lane: singleLane, orders: [order], equipType: singleEquip,
                maxWt: singleMaxWt, util: Math.round((Number(order.weight || 0) / singleMaxWt) * 100),
                quotes, selectedIdx: 0, bestQuote,
              });
            }
            console.log(`[PlanGroup] Split into ${bestSubset.length} consolidated + ${remainder.length} individual`);
          } else {
            // No compatible subset found — plan all individually
            for (const order of sg.orders) {
              const singleLane = { ...sg.lane, totalWeight: Number(order.weight || 0), totalPieces: Number(order.pieces || 0), orderIds: [order.id] };
              const singleEquip = Number(order.weight || 0) <= LTL_MAX_WEIGHT ? "LTL Truck" : DEFAULT_EQUIP;
              const singleMaxWt = EQUIPMENT_TYPES[singleEquip].maxWeight;
              const { quotes, bestQuote } = await fetchCarrierQuotes(singleLane, calcDates, order.due || "", order.ready || "");
              finalGroups.push({
                lane: singleLane, orders: [order], equipType: singleEquip,
                maxWt: singleMaxWt, util: Math.round((Number(order.weight || 0) / singleMaxWt) * 100),
                quotes, selectedIdx: 0, bestQuote,
              });
            }
          }
        } else {
          finalGroups.push(sg);
        }
      }

      const firstQuotes = finalGroups[0]?.quotes || [];
      const firstBest = finalGroups[0]?.bestQuote || null;
      setPlanModal((prev) => prev ? {
        ...prev, quotes: firstQuotes, bestQuote: firstBest, busy: false,
        shipmentGroups: finalGroups,
        ratingElapsedMs: Date.now() - ratingStart,
      } : null);
    } catch (err) {
      setPlanModal((prev) => prev ? { ...prev, busy: false, error: err.message } : null);
    }
  }

  async function confirmPlan() {
    if (!planModal) return;
    const { lane, shipmentGroups, siblings, reserveDock, dockDoor, dockStartTime, loadDuration } = planModal;
    const groups = shipmentGroups || [{ lane, quotes: planModal.quotes, selectedIdx: planModal.selectedIdx, bestQuote: planModal.bestQuote, orders: siblings }];
    const dockEnabled = reserveDock !== false; // default true

    // Build a plan for each shipment group
    const plans = [];
    let totalCost = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const sg = groups[gi];
      const chosen = sg.quotes[sg.selectedIdx] || sg.bestQuote;
      if (!chosen) { toast(`No carrier selected for a shipment group`, "error"); return; }
      const readyDate = sg.orders?.map((s) => s.ready).filter(Boolean).sort().reverse()[0] || "";
      const earliestDue = sg.orders?.map((s) => s.due).filter(Boolean).sort()[0] || "";
      const dates = calcDates(chosen, earliestDue, readyDate);
      if (dates.error) { toast(`Planning failed: ${dates.error}`, "error"); return; }

      const plan = {
        laneKey: sg.lane.laneKey, origin: sg.lane.origin, destination: sg.lane.destination,
        originZip: sg.lane.originZip, destZip: sg.lane.destZip,
        totalWeight: sg.lane.totalWeight, totalPieces: sg.lane.totalPieces, orderIds: sg.lane.orderIds,
        carrier: chosen.carrier || "", mode: chosen.mode || "LTL",
        totalCost: chosen.totalCharge || 0, pickupDate: dates.pickup,
        deliveryDate: dates.delivery, czarliteRate: chosen.mode === "LTL",
        serviceLevel: chosen.serviceLevel || "",
        miles: chosen.miles || null,
        rate: chosen.czarBaseGross || chosen.czarBase || 0,
        fuelSurcharge: chosen.fscCharge || 0,
        accessorials: chosen.accessorialCharge || 0,
        rateId: chosen.rateId || null,
      };

      // Assign dock via service when reservation is enabled
      if (dockEnabled) {
        assignDockToPlan(plan, {
          dockDoor, startTime: dockStartTime, loadDuration,
          groupIndex: gi, groupCount: groups.length,
          existingShipments: shipments,
          dockConfigs: warehouseDockConfigs,
        });
      } else {
        // No dock assignment — just set pickup time to warehouse start hour
        const wh = getDockConfigForWarehouse(warehouseDockConfigs, plan.origin);
        plan.pickupTime = `${String(wh.startHour || 6).padStart(2, "0")}:00`;
      }

      plans.push(plan);
      totalCost += chosen.totalCharge || 0;
    }

    setPlanModal((prev) => prev ? { ...prev, busy: true } : null);
    const confirmStartTime = Date.now();
    try {
      const execRes = await executeSinglePlan(plans);
      setPlanModal(null);
      const firstChosen = groups[0]?.quotes[groups[0]?.selectedIdx] || groups[0]?.bestQuote || {};
      const firstDates = calcDates(firstChosen, siblings?.[0]?.due || "", siblings?.[0]?.ready || "");
      setPlanSummary({
        shipments: execRes?.shipments || [],
        ordersUpdated: execRes?.ordersUpdated || 0,
        totalCost,
        carrier: firstChosen.carrier || "",
        mode: firstChosen.mode || "TL",
        lane, siblings, dates: firstDates,
        elapsedMs: Date.now() - confirmStartTime + (planModal?.ratingElapsedMs || 0),
      });
      refreshData();
    } catch (err) {
      setPlanModal((prev) => prev ? { ...prev, busy: false, error: err.message } : null);
    }
  }

  /* ── Bulk Plan Scheduler (uses service) ── */
  const runBulk = useCallback(async () => {
    const unplanned = orders.filter((o) => o.status === "Unplanned");
    if (!unplanned.length) {
      setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] No unplanned orders.`]);
      return;
    }
    setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] Rating ${unplanned.length} orders...`]);
    try {
      const dockOn = isFeatureEnabled(planningParameters, "dock_scheduling");
      const result = await bulkPlanOrders(unplanned, shipments, dockOn, warehouseDockConfigs);
      if (result.noQuotes) {
        setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] No quotes returned.`]);
        setSchedRuns((r) => r + 1);
        return;
      }
      setSchedRuns((r) => r + 1);
      setSchedPlanned((p) => p + result.updated);
      setSchedSaved((p) => p + result.cost);
      setSchedLog((p) => [...p, `[${new Date().toLocaleTimeString()}] ✅ ${result.created} shipment(s), ${result.updated} order(s) planned. Cost: ${fmt$(result.cost)}`]);
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
      const laneKey = `${normalizeLane(o.origin)}||${normalizeLane(o.dest)}`;
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
          <input placeholder="🔍 Search order, customer, lane, commodity..." value={q} onChange={(e) => setQ(e.target.value)} className="search-input" style={{ minWidth: 250, flex: 1 }} />
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
              <button onClick={planSelected}
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
                  <button className="btn btn-secondary btn-sm" style={{ marginLeft: 4, fontSize: 11 }} disabled={busyId === o.id} onClick={() => handleCopyOrder(o.id)} title="Copy order">📋</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div></div>

      <div className="text-sm text-muted mt-2">{rows.length} of {orders.length} orders</div>

      {/* ═══ ORDER DETAIL MODAL (extracted) ═══ */}
      <OrderDetailModal
        order={detailOrder} orders={orders} shipments={shipments}
        tab={detailTab} onTabChange={setDetailTab}
        editForm={editForm} onEditFormChange={setEditForm}
        editUser={editUser} onEditUserChange={setEditUser} editStatus={editStatus}
        detailLines={detailLines} onLinesChange={setDetailLines}
        onSave={saveOrderEdit} onSaveLines={saveLines}
        onClose={() => setDetailOrder(null)}
        onPlan={(id) => openPlanModal(id)} onUnplan={unplanOrder} onCopy={handleCopyOrder}
        busy={detailBusy}
        changeLog={orderChangeLog[detailOrder?.id] || []}
        onClearHistory={() => setOrderChangeLog((prev) => ({ ...prev, [detailOrder?.id]: [] }))}
        itemMaster={itemMaster} carriers={carriers} toast={toast}
      />

      <PlanConfirmationModal planModal={planModal} onModalChange={setPlanModal}
        onConfirm={confirmPlan} onClose={() => setPlanModal(null)} />

      <PlanSummaryModal summary={planSummary} onClose={() => setPlanSummary(null)} />

      <NewOrderModal show={showNewOrder} form={newOrderForm} onFormChange={setNewOrderForm}
        lines={newOrderLines} onLinesChange={setNewOrderLines} onSubmit={createOrder}
        onClose={() => setShowNewOrder(false)} carriers={carriers} busy={detailBusy} itemMaster={itemMaster} />

      </div>
    </div>
  );
}
