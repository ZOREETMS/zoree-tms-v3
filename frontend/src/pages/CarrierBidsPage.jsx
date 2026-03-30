import { useState, useCallback } from "react";
import { useCarrierBids } from "../hooks/useCarrierBids";
import { SEED_BIDS } from "../services/carrierBidsService";
import BidsStatGrid from "../components/carrier-bids/BidsStatGrid";
import RfqTable from "../components/carrier-bids/RfqTable";
import BidDetailModal from "../components/carrier-bids/BidDetailModal";
import CreateRfqModal from "../components/carrier-bids/CreateRfqModal";

export default function CarrierBidsPage() {
  const { bids, stats, awardBid, addRfq } = useCarrierBids(SEED_BIDS);

  const [detailRfqId, setDetailRfqId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState({ text: "", type: "" });

  function showToast(text, type = "info") {
    setToast({ text, type });
    setTimeout(() => setToast({ text: "", type: "" }), 4000);
  }

  const handleViewBids = useCallback((rfqId) => {
    setDetailRfqId(rfqId);
  }, []);

  const handleAward = useCallback(
    (rfqId, carrier) => {
      awardBid(rfqId, carrier);
      setDetailRfqId(null);
      showToast(`${rfqId} awarded to ${carrier}`, "success");
    },
    [awardBid]
  );

  const handleCreateRfq = useCallback(
    (rfq) => {
      const created = addRfq(rfq);
      setShowCreate(false);
      showToast(`${created.id} created — ${rfq.lane}`, "success");
    },
    [addRfq]
  );

  const detailRfq = detailRfqId ? bids.find((b) => b.id === detailRfqId) : null;

  return (
    <>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Carrier Bid Management</div>
          <div className="page-sub">
            RFQ, tender management, and bid comparison
          </div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowCreate(true)}
          >
            + Create RFQ
          </button>
        </div>
      </div>

      {/* Page Content */}
      <div className="page-content">
        <BidsStatGrid stats={stats} />
        <RfqTable bids={bids} onViewBids={handleViewBids} />
      </div>

      {/* Modals */}
      {detailRfq && (
        <BidDetailModal
          rfq={detailRfq}
          onAward={handleAward}
          onClose={() => setDetailRfqId(null)}
        />
      )}

      {showCreate && (
        <CreateRfqModal
          onSave={handleCreateRfq}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Toast */}
      {toast.text && (
        <div className="toast-wrap">
          <div className="toast">
            <span>
              {toast.type === "success" ? "✅" : toast.type === "warning" ? "⚠️" : "ℹ️"}
            </span>
            <span>{toast.text}</span>
          </div>
        </div>
      )}
    </>
  );
}
