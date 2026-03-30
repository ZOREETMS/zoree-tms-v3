import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import useDocuments from "../hooks/useDocuments";
import DocumentStats from "../components/documents/DocumentStats";
import DocumentTable from "../components/documents/DocumentTable";
import DocumentViewerModal from "../components/documents/DocumentViewerModal";

export default function DocumentsPage() {
  const { shipments = [], orders = [], carriers = [] } = useOutletContext();
  const { documents, stats, typeFilter, setTypeFilter, generateBOL, findDocById } = useDocuments(shipments);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [toast, setToast] = useState(null);

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleGenerateBOL() {
    const result = generateBOL();
    showToast(result.message, result.success ? "success" : "warning");
  }

  function handleView(docId) {
    const doc = findDocById(docId);
    if (doc) setViewerDoc(doc);
  }

  function handleSend(doc) {
    showToast(doc.id + " sent to carrier", "success");
  }

  function handleCloseViewer() {
    setViewerDoc(null);
  }

  // Resolve related entities for the viewer
  const viewerShipment = viewerDoc ? shipments.find((s) => s.id === viewerDoc.ship) : null;
  const viewerOrder = viewerShipment ? orders.find((o) => o.shipmentId === viewerShipment.id) : null;
  const viewerCarrier = viewerShipment ? carriers.find((c) => c.name === viewerShipment.carrier) : null;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Documents & BOL</div>
          <div className="page-sub">Bill of Lading, POD, commercial invoices, and compliance docs</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary btn-sm" onClick={handleGenerateBOL}>
            + Generate BOL
          </button>
        </div>
      </div>

      <div className="page-content">
        <DocumentStats stats={stats} />
        <DocumentTable
          documents={documents}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          onView={handleView}
          onSend={handleSend}
        />
      </div>

      <DocumentViewerModal
        isOpen={!!viewerDoc}
        doc={viewerDoc}
        shipment={viewerShipment}
        order={viewerOrder}
        carrier={viewerCarrier}
        onClose={handleCloseViewer}
      />

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: toast.type === "success" ? "var(--green)" : "var(--yellow)",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 9999,
            boxShadow: "0 4px 16px rgba(0,0,0,.2)",
          }}
        >
          {toast.msg}
        </div>
      )}
    </>
  );
}
