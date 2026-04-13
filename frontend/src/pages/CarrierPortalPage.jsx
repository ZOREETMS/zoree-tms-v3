import { useState, useMemo, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { plannedDeliveryDate, plannedPickupDate, resolveCarrierName } from "../utils/carrierPortal";
import {
  ACTIVE_PORTAL_CARRIER,
  buildPersistedTenderResponses,
  isCarrierShipment,
  mergeCarrierOptions,
  saveTenderResponse,
} from "../services/carrierPortalService";
import TenderCard from "../components/carrier-portal/TenderCard";
import TenderRespondModal from "../components/carrier-portal/TenderRespondModal";
import TenderDetailModal from "../components/carrier-portal/TenderDetailModal";

const TABS = [
  { key: "all", label: "All Tenders" },
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
];

export default function CarrierPortalPage() {
  const { shipments, orders, carriers, refreshData } = useOutletContext();
  const [selectedCarrier, setSelectedCarrier] = useState("");
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [localTenderResponses, setLocalTenderResponses] = useState({});
  const [message, setMessage] = useState({ text: "", type: "" });

  // Filter state
  const [modeFilter, setModeFilter] = useState("All");
  const [originFilter, setOriginFilter] = useState("All");
  const [destFilter, setDestFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("All");

  // Build carrier options from DB carriers + unique carriers found in shipments (de-duped)
  const carrierOptions = useMemo(
    () => mergeCarrierOptions(carriers, shipments),
    [carriers, shipments],
  );

  // Auto-select: match env default to an actual option, or fall back to first option
  const effectiveCarrier = useMemo(() => {
    if (selectedCarrier && carrierOptions.includes(selectedCarrier)) return selectedCarrier;
    // Try to find a match for the env default in the options list
    const defaultNorm = (ACTIVE_PORTAL_CARRIER || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const match = carrierOptions.find(
      (c) => c.toLowerCase().replace(/[^a-z0-9]/g, "") === defaultNorm
    );
    return match || carrierOptions[0] || "";
  }, [selectedCarrier, carrierOptions]);

  // Modal state
  const [respondModal, setRespondModal] = useState({ open: false, shipId: null, preselect: null });
  const [detailModal, setDetailModal] = useState({ open: false, shipId: null });
  /** `"table"` = line-by-line; `"cards"` = original grid */
  const [listView, setListView] = useState("table");

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 4000);
  }

  const persistedTenderResponses = useMemo(
    () => buildPersistedTenderResponses(shipments),
    [shipments]
  );

  const tenderResponses = useMemo(
    () => ({ ...persistedTenderResponses, ...localTenderResponses }),
    [persistedTenderResponses, localTenderResponses]
  );

  // All shipments visible in carrier portal: tendered + those with responses
  const portalShipments = useMemo(() => {
    const carrierShipments = (shipments || []).filter((s) => isCarrierShipment(s, effectiveCarrier));
    const tendered = carrierShipments.filter((s) => s.status === "Tendered");
    const responded = carrierShipments.filter((s) => tenderResponses[s.id]);
    const merged = [...tendered];
    responded.forEach((s) => {
      if (!merged.find((x) => x.id === s.id)) merged.push(s);
    });
    return merged;
  }, [shipments, tenderResponses, effectiveCarrier]);

  // KPIs
  const kpis = useMemo(() => {
    const total = portalShipments.length;
    const pending = portalShipments.filter((s) => !tenderResponses[s.id]).length;
    const accepted = portalShipments.filter((s) => tenderResponses[s.id]?.action === "accept").length;
    const rejected = portalShipments.filter((s) => tenderResponses[s.id]?.action === "reject").length;
    const rate = (accepted + rejected) > 0 ? Math.round(accepted / (accepted + rejected) * 100) : 0;
    return { total, pending, accepted, rejected, rate };
  }, [portalShipments, tenderResponses]);

  // Derive unique filter options from portal shipments
  const filterOptions = useMemo(() => {
    const origins = [...new Set(portalShipments.map((s) => (s.origin || "").split(",")[0].trim()).filter(Boolean))].sort();
    const dests = [...new Set(portalShipments.map((s) => (s.dest || "").split(",")[0].trim()).filter(Boolean))].sort();
    const modes = [...new Set(portalShipments.map((s) => (s.mode || "").toUpperCase()).filter(Boolean))].sort();
    return { origins, dests, modes };
  }, [portalShipments]);

  // Filtered and sorted list
  const filteredShipments = useMemo(() => {
    let list = [...portalShipments];

    // Tab filter
    if (tab === "pending") list = list.filter((s) => !tenderResponses[s.id]);
    else if (tab === "accepted") list = list.filter((s) => tenderResponses[s.id]?.action === "accept");
    else if (tab === "rejected") list = list.filter((s) => tenderResponses[s.id]?.action === "reject");

    // Mode filter
    if (modeFilter !== "All") list = list.filter((s) => (s.mode || "").toUpperCase() === modeFilter);

    // Origin filter
    if (originFilter !== "All") list = list.filter((s) => (s.origin || "").split(",")[0].trim() === originFilter);

    // Destination filter
    if (destFilter !== "All") list = list.filter((s) => (s.dest || "").split(",")[0].trim() === destFilter);

    // Date filter (pickup date)
    if (dateFilter !== "All") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      list = list.filter((s) => {
        const pickup = plannedPickupDate(s);
        if (!pickup || pickup === "—") return false;
        const d = new Date(pickup);
        if (isNaN(d.getTime())) return false;
        if (dateFilter === "Today") return d.toDateString() === today.toDateString();
        if (dateFilter === "This Week") {
          const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + (7 - today.getDay()));
          return d >= today && d <= weekEnd;
        }
        if (dateFilter === "Next 7 Days") {
          const end = new Date(today); end.setDate(today.getDate() + 7);
          return d >= today && d <= end;
        }
        if (dateFilter === "Next 30 Days") {
          const end = new Date(today); end.setDate(today.getDate() + 30);
          return d >= today && d <= end;
        }
        if (dateFilter === "Overdue") return d < today;
        return true;
      });
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => {
        const r = tenderResponses[s.id];
        const pro = (r?.proNumber || s.pro_number || "").toString();
        return [s.id, resolveCarrierName(s), s.origin, s.dest, s.commodity, pro]
          .some((v) => String(v || "").toLowerCase().includes(q));
      });
    }

    // Sort: pending first, then by pickup
    list.sort((a, b) => {
      const ra = tenderResponses[a.id], rb = tenderResponses[b.id];
      if (!ra && rb) return -1;
      if (ra && !rb) return 1;
      return (a.pickup || "") < (b.pickup || "") ? -1 : 1;
    });

    return list;
  }, [portalShipments, tab, search, tenderResponses, modeFilter, originFilter, destFilter, dateFilter]);

  // Get related orders for a shipment
  const getRelatedOrders = useCallback((shipment) => {
    if (!shipment || !orders) return [];
    if (shipment.consolidatedOrders && shipment.consolidatedOrders.length > 0) {
      return shipment.consolidatedOrders
        .map((oid) => orders.find((o) => o.id === oid))
        .filter(Boolean);
    }
    return orders.filter(
      (o) => String(o.shipment_id || o.shipmentId || "") === String(shipment.id || "")
    );
  }, [orders]);

  // Handlers
  function openRespond(shipId, preselect) {
    setRespondModal({ open: true, shipId, preselect: preselect || null });
  }

  function closeRespond() {
    setRespondModal({ open: false, shipId: null, preselect: null });
  }

  function openDetail(shipId) {
    setDetailModal({ open: true, shipId });
  }

  function closeDetail() {
    setDetailModal({ open: false, shipId: null });
  }

  async function handleSubmitResponse(responseData) {
    const shipId = respondModal.shipId;
    const ship = shipments.find((s) => s.id === shipId);
    if (!ship) return;

    let savedResponse = responseData;
    try {
      savedResponse = await saveTenderResponse(ship, responseData, {
        orders: getRelatedOrders(ship),
      });
      setLocalTenderResponses((prev) => ({ ...prev, [shipId]: savedResponse }));
      await refreshData();
    } catch (err) {
      console.error("Failed to save carrier portal response:", err);
      toast(`Failed to save response: ${err.message}`, "error");
      return;
    }

    closeRespond();

    if (responseData.action === "accept") {
      toast(`Tender accepted by ${resolveCarrierName(ship)} for ${shipId}`, "success");
    } else {
      toast(`Tender rejected by ${resolveCarrierName(ship)} — shipment set to Tender Rejected`, "warning");
    }
  }

  // Get the shipment for modal
  const respondShipment = respondModal.shipId ? shipments.find((s) => s.id === respondModal.shipId) : null;
  const detailShipment = detailModal.shipId ? shipments.find((s) => s.id === detailModal.shipId) : null;

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={setSearch}
        selectedCarrier={effectiveCarrier}
        onCarrierChange={setSelectedCarrier}
        carrierOptions={carrierOptions}
        modeFilter={modeFilter}
        onModeChange={setModeFilter}
        originFilter={originFilter}
        onOriginChange={setOriginFilter}
        destFilter={destFilter}
        onDestChange={setDestFilter}
        dateFilter={dateFilter}
        onDateChange={setDateFilter}
        filterOptions={filterOptions}
        activeFilterCount={[modeFilter, originFilter, destFilter, dateFilter].filter((f) => f !== "All").length}
        onClearFilters={() => { setModeFilter("All"); setOriginFilter("All"); setDestFilter("All"); setDateFilter("All"); }}
      />

      <div style={{ padding: "24px 28px" }}>
        {/* Toast */}
        {message.text && (
          <div className={`toast toast-${message.type}`} style={{ marginBottom: 12 }}>{message.text}</div>
        )}

        {/* KPI Strip */}
        <KpiStrip kpis={kpis} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.6 }}>View</span>
          <div style={{ display: "flex", gap: 2, background: "#f0f4ff", borderRadius: 10, padding: 3, border: "1px solid rgba(59,130,246,.15)" }}>
            <button
              type="button"
              onClick={() => setListView("table")}
              style={{
                padding: "5px 14px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", background: listView === "table" ? "var(--accent)" : "transparent",
                color: listView === "table" ? "#fff" : "var(--text3)",
              }}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setListView("cards")}
              style={{
                padding: "5px 14px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", background: listView === "cards" ? "var(--accent)" : "transparent",
                color: listView === "cards" ? "#fff" : "var(--text3)",
              }}
            >
              Cards
            </button>
          </div>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>Table shows one row per shipment with PRO # and quick actions.</span>
        </div>

        {filteredShipments.length === 0 ? (
          <EmptyState />
        ) : listView === "table" ? (
          <TenderTable
            rows={filteredShipments}
            tenderResponses={tenderResponses}
            onAccept={(id) => openRespond(id, "accept")}
            onReject={(id) => openRespond(id, "reject")}
            onViewDetail={openDetail}
            onChangeResponse={(id) => openRespond(id)}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 16 }}>
            {filteredShipments.map((s) => (
              <TenderCard
                key={s.id}
                shipment={s}
                response={tenderResponses[s.id]}
                consolidatedOrders={s.consolidatedOrders?.length || 0}
                onAccept={(id) => openRespond(id, "accept")}
                onReject={(id) => openRespond(id, "reject")}
                onViewDetail={openDetail}
                onChangeResponse={(id) => openRespond(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Respond Modal */}
      {respondModal.open && respondShipment && (
        <TenderRespondModal
          shipment={respondShipment}
          preselect={respondModal.preselect}
          onClose={closeRespond}
          onSubmit={handleSubmitResponse}
        />
      )}

      {/* Detail Modal */}
      {detailModal.open && detailShipment && (
        <TenderDetailModal
          shipment={detailShipment}
          response={tenderResponses[detailShipment.id]}
          relatedOrders={getRelatedOrders(detailShipment)}
          onClose={closeDetail}
          onRespond={(id) => openRespond(id)}
        />
      )}
    </div>
  );
}

/* ── Sub-components ── */

function PageHeader({
  tab, onTabChange, search, onSearchChange,
  selectedCarrier, onCarrierChange, carrierOptions,
  modeFilter, onModeChange, originFilter, onOriginChange,
  destFilter, onDestChange, dateFilter, onDateChange,
  filterOptions, activeFilterCount, onClearFilters,
}) {
  return (
    <div style={{
      padding: "16px 28px", borderBottom: "1px solid var(--border)",
      background: "#fff", position: "sticky", top: 0, zIndex: 5,
      boxShadow: "0 1px 8px rgba(30,45,107,0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>Carrier Portal</h2>
          <div className="page-subtitle">
            Tendered shipments awaiting carrier acceptance or rejection ({selectedCarrier})
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Tab Buttons */}
          <div style={{
            display: "flex", gap: 2, background: "#f0f4ff",
            borderRadius: 10, padding: 3, border: "1px solid rgba(59,130,246,.15)",
          }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => onTabChange(t.key)}
                style={{
                  padding: "5px 14px", borderRadius: 8, border: "none",
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                  transition: "all .15s", fontFamily: "inherit",
                  background: tab === t.key ? "var(--accent)" : "transparent",
                  color: tab === t.key ? "#fff" : "var(--text3)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <select
            value={selectedCarrier}
            onChange={(e) => onCarrierChange(e.target.value)}
            style={{
              padding: "7px 10px",
              border: "1.5px solid var(--accent)",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              background: "#f0f4ff",
              color: "var(--text1)",
              minWidth: 140,
              cursor: "pointer",
            }}
          >
            {carrierOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          {/* Search */}
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search shipments..."
            style={{
              padding: "7px 12px", border: "1.5px solid var(--border)",
              borderRadius: 8, fontSize: 13, fontFamily: "inherit",
              outline: "none", width: 190,
            }}
          />
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select className="fsel" value={modeFilter} onChange={(e) => onModeChange(e.target.value)}>
          <option value="All">All Modes</option>
          {filterOptions.modes.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <select className="fsel" value={originFilter} onChange={(e) => onOriginChange(e.target.value)}>
          <option value="All">All Origins</option>
          {filterOptions.origins.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>

        <select className="fsel" value={destFilter} onChange={(e) => onDestChange(e.target.value)}>
          <option value="All">All Destinations</option>
          {filterOptions.dests.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <select className="fsel" value={dateFilter} onChange={(e) => onDateChange(e.target.value)}>
          <option value="All">All Dates</option>
          <option value="Overdue">Overdue</option>
          <option value="Today">Today</option>
          <option value="This Week">This Week</option>
          <option value="Next 7 Days">Next 7 Days</option>
          <option value="Next 30 Days">Next 30 Days</option>
        </select>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={onClearFilters}
            style={{
              padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)",
              background: "var(--bg2)", color: "var(--text2)", fontSize: 12,
              fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Clear Filters ({activeFilterCount})
          </button>
        )}
      </div>
    </div>
  );
}

function KpiStrip({ kpis }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
      <StatCard label="Total Tenders" value={kpis.total} color="blue" />
      <StatCard label="Awaiting Response" value={kpis.pending} color="yellow" />
      <StatCard label="Accepted" value={kpis.accepted} color="green" />
      <StatCard label="Rejected" value={kpis.rejected} color="red" />
      <StatCard label="Acceptance Rate" value={`${kpis.rate}%`} color="blue" />
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 26 }}>{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--text3)" }}>
      <div style={{ fontSize: 48, marginBottom: 12 }}>&#128237;</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No tenders found</div>
      <div style={{ fontSize: 13 }}>Tender shipments from the Shipments page to see them here</div>
    </div>
  );
}

function portalStatusBadge(response) {
  if (!response) return { label: "Pending", bg: "rgba(245,158,11,.12)", color: "#b45309", border: "rgba(245,158,11,.35)" };
  if (response.action === "accept") return { label: "Accepted", bg: "rgba(16,185,129,.12)", color: "#059669", border: "rgba(16,185,129,.35)" };
  return { label: "Rejected", bg: "rgba(239,68,68,.1)", color: "#dc2626", border: "rgba(239,68,68,.3)" };
}

function TenderTable({ rows, tenderResponses, onAccept, onReject, onViewDetail, onChangeResponse }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="table-wrap" style={{ overflowX: "auto" }}>
        <table className="grid" style={{ border: "none", boxShadow: "none", minWidth: 920, fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ whiteSpace: "nowrap" }}>Shipment</th>
              <th>Status</th>
              <th>Lane</th>
              <th>Mode</th>
              <th style={{ whiteSpace: "nowrap" }}>Planned pickup</th>
              <th style={{ whiteSpace: "nowrap" }}>Planned delivery</th>
              <th style={{ textAlign: "right" }}>Est. rate</th>
              <th style={{ whiteSpace: "nowrap" }}>PRO #</th>
              <th style={{ textAlign: "right", whiteSpace: "nowrap" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const response = tenderResponses[s.id];
              const b = portalStatusBadge(response);
              const pro =
                (response?.proNumber && String(response.proNumber).trim())
                || (s.pro_number && String(s.pro_number).trim())
                || "—";
              const rate = s.total_cost ?? s.cost;
              const laneShort = `${(s.origin || "").split(",")[0] || "—"} → ${(s.dest || "").split(",")[0] || "—"}`;
              const pending = !response;
              return (
                <tr key={s.id}>
                  <td>
                    <button
                      type="button"
                      className="mono"
                      onClick={() => onViewDetail(s.id)}
                      style={{
                        background: "none", border: "none", padding: 0, cursor: "pointer",
                        color: "var(--accent)", fontWeight: 700, fontSize: 13, textDecoration: "underline",
                        textUnderlineOffset: 2, fontFamily: "inherit",
                      }}
                    >
                      {s.id}
                    </button>
                  </td>
                  <td>
                    <span
                      style={{
                        display: "inline-block", fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
                        background: b.bg, color: b.color, border: `1px solid ${b.border}`,
                      }}
                    >
                      {b.label}
                    </span>
                  </td>
                  <td className="text-sm" title={`${s.origin || ""} → ${s.dest || ""}`} style={{ maxWidth: 220 }}>
                    {laneShort}
                  </td>
                  <td><span className={`badge ${s.mode === "LTL" ? "badge-blue" : "badge-green"}`} style={{ fontSize: 10 }}>{s.mode || "—"}</span></td>
                  <td className="mono text-sm">{plannedPickupDate(s)}</td>
                  <td className="mono text-sm">{plannedDeliveryDate(s)}</td>
                  <td className="mono text-sm" style={{ textAlign: "right" }}>
                    {rate != null && rate !== "" ? `$${Number(rate).toLocaleString()}` : "—"}
                  </td>
                  <td className="mono text-sm" style={{ fontWeight: 600 }}>{pro}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: "4px 8px", fontSize: 11 }}
                        onClick={() => onViewDetail(s.id)}
                      >
                        Details
                      </button>
                      {pending ? (
                        <>
                          <button
                            type="button"
                            style={{
                              padding: "4px 8px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                              border: "1.5px solid var(--green)", background: "rgba(16,185,129,.1)", color: "var(--green)", fontFamily: "inherit",
                            }}
                            onClick={() => onAccept(s.id)}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            style={{
                              padding: "4px 8px", fontSize: 11, fontWeight: 700, borderRadius: 6, cursor: "pointer",
                              border: "1.5px solid var(--red)", background: "rgba(239,68,68,.08)", color: "var(--red)", fontFamily: "inherit",
                            }}
                            onClick={() => onReject(s.id)}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          style={{
                            padding: "4px 8px", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                            border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text2)", fontFamily: "inherit",
                          }}
                          onClick={() => onChangeResponse(s.id)}
                        >
                          Change
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
