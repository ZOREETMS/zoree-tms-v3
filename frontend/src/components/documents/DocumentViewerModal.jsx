import { useRef } from "react";
import { DOC_TYPE_LABELS } from "../../types/documents";
import { downloadDocument, printDocument } from "../../services/documentService";
import BOLDocument from "./BOLDocument";
import PODDocument from "./PODDocument";
import InvoiceDocument from "./InvoiceDocument";
import HazmatDocument from "./HazmatDocument";

export default function DocumentViewerModal({ isOpen, doc, shipment, order, carrier, onClose }) {
  const contentRef = useRef(null);

  if (!isOpen || !doc) return null;

  const title = (DOC_TYPE_LABELS[doc.type] || "Document") + " \u2014 " + doc.id;

  function handlePrint() {
    if (!contentRef.current) return;
    printDocument(title, contentRef.current.innerHTML);
  }

  function handleDownload() {
    if (!contentRef.current) return;
    downloadDocument(doc.id, title, contentRef.current.innerHTML);
  }

  function renderDocument() {
    switch (doc.type) {
      case "BOL":
        return <BOLDocument doc={doc} shipment={shipment} order={order} carrier={carrier} />;
      case "POD":
        return <PODDocument doc={doc} shipment={shipment} />;
      case "Invoice":
        return <InvoiceDocument doc={doc} shipment={shipment} carrier={carrier} />;
      case "Hazmat":
        return <HazmatDocument doc={doc} shipment={shipment} order={order} />;
      default:
        return <div style={{ padding: 40, textAlign: "center", color: "#666" }}>Document preview not available</div>;
    }
  }

  return (
    <div className="modal-overlay" style={{ display: "flex" }} onClick={onClose}>
      <div
        className="modal"
        style={{ width: 720, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            background: "linear-gradient(135deg,#1e3a5f,#1e2d6b)",
            borderRadius: "16px 16px 0 0",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
              Document Viewer
            </div>
            <span className="modal-title" style={{ color: "#fff" }}>{title}</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handlePrint}
              style={{ background: "rgba(255,255,255,.15)", color: "#fff", borderColor: "rgba(255,255,255,.2)" }}
            >
              Print
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDownload}
              style={{ background: "rgba(255,255,255,.15)", color: "#fff", borderColor: "rgba(255,255,255,.2)" }}
            >
              Download
            </button>
            <button
              className="modal-close"
              onClick={onClose}
              style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: 0, overflowY: "auto", flex: 1 }}>
          <div ref={contentRef} style={{ padding: "32px 40px", background: "#fff", fontFamily: "'Courier New', monospace" }}>
            {renderDocument()}
          </div>
        </div>
      </div>
    </div>
  );
}
