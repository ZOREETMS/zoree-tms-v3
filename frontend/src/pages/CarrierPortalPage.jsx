import { useState, useMemo, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { resolveCarrierName } from "../utils/carrierPortal";
import {
  ACTIVE_PORTAL_CARRIER,
  buildPersistedTenderResponses,
  isActivePortalCarrierShipment,
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
  const { shipments, orders, refreshData } = useOutletContext();
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [localTenderResponses, setLocalTenderResponses] = useState({});
  const [message, setMessage] = useState({ text: "", type: "" });

  // Modal state
  const [respondModal, setRespondModal] = useState({ open: false, shipId: null, preselect: null });
  const [detailModal, setDetailModal] = useState({ open: false, shipId: null });

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
    const carrierShipments = (shipments || []).filter(isActivePortalCarrierShipment);
    const tendered = carrierShipments.filter((s) => s.status === "Tendered");
    const responded = carrierShipments.filter((s) => tenderResponses[s.id]);
    const merged = [...tendered];
    responded.forEach((s) => {
      if (!merged.find((x) => x.id === s.id)) merged.push(s);
    });
    return merged;
  }, [shipments, tenderResponses]);

  // KPIs
  const kpis = useMemo(() => {
    const total = portalShipments.length;
    const pending = portalShipments.filter((s) => !tenderResponses[s.id]).length;
    const accepted = portalShipments.filter((s) => tenderResponses[s.id]?.action === "accept").length;
    const rejected = portalShipments.filter((s) => tenderResponses[s.id]?.action === "reject").length;
    const rate = (accepted + rejected) > 0 ? Math.round(accepted / (accepted + rejected) * 100) : 0;
    return { total, pending, accepted, rejected, rate };
  }, [portalShipments, tenderResponses]);

  // Filtered and sorted list
  const filteredShipments = useMemo(() => {
    let list = [...portalShipments];

    // Tab filter
    if (tab === "pending") list = list.filter((s) => !tenderResponses[s.id]);
    else if (tab === "accepted") list = list.filter((s) => tenderResponses[s.id]?.action === "accept");
    else if (tab === "rejected") list = list.filter((s) => tenderResponses[s.id]?.action === "reject");

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        [s.id, resolveCarrierName(s), s.origin, s.dest, s.commodity]
          .some((v) => String(v || "").toLowerCase().includes(q))
      );
    }

    // Sort: pending first, then by pickup
    list.sort((a, b) => {
      const ra = tenderResponses[a.id], rb = tenderResponses[b.id];
      if (!ra && rb) return -1;
      if (ra && !rb) return 1;
      return (a.pickup || "") < (b.pickup || "") ? -1 : 1;
    });

    return list;
  }, [portalShipments, tab, search, tenderResponses]);

  // Get related orders for a shipment
  const getRelatedOrders = useCallback((shipment) => {
    if (!shipment || !orders) return [];
    if (shipment.consolidatedOrders && shipment.consolidatedOrders.length > 0) {
      return shipment.consolidatedOrders
        .map((oid) => orders.find((o) => o.id === oid))
        .filter(Boolean);
    }
    const linked = orders.find((o) => o.shipmentId === shipment.id || o.shipment_id === shipment.id);
    return linked ? [linked] : [];
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
      savedResponse = await saveTenderResponse(ship, responseData);
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
      />

      <div style={{ padding: "24px 28px" }}>
        {/* Toast */}
        {message.text && (
          <div className={`toast toast-${message.type}`} style={{ marginBottom: 12 }}>{message.text}</div>
        )}

        {/* KPI Strip */}
        <KpiStrip kpis={kpis} />

        {/* Tender Cards Grid */}
        {filteredShipments.length === 0 ? (
          <EmptyState />
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

function PageHeader({ tab, onTabChange, search, onSearchChange }) {
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
            Tendered shipments awaiting carrier acceptance or rejection ({ACTIVE_PORTAL_CARRIER})
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

          <div
            style={{
              padding: "7px 10px",
              border: "1.5px solid var(--border)",
              borderRadius: 8,
              fontSize: 13,
              fontFamily: "inherit",
              background: "#fff",
              color: "var(--text2)",
              minWidth: 120,
            }}
          >
            {ACTIVE_PORTAL_CARRIER}
          </div>

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
