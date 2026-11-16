// Carrier invoices attached to this shipment: status, reason, and the
// original PDF the agent read.
import { useNavigate } from "react-router-dom";
import { openInvoiceDocument } from "../../services/invoiceIntakeService";
import { invoiceStateLine } from "../../services/shipmentInvoiceService";

const sectionTitle = { fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 };
const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TONE = {
  Approved: { bg: "#ECFDF5", fg: "#047857", line: "#A7F3D0" },
  Paid: { bg: "#ECFDF5", fg: "#047857", line: "#A7F3D0" },
  "On Hold": { bg: "#FFF7ED", fg: "#C2410C", line: "#FED7AA" },
  Disputed: { bg: "#FEF2F2", fg: "#B91C1C", line: "#FECACA" },
  Rejected: { bg: "#FEF2F2", fg: "#B91C1C", line: "#FECACA" },
};

export default function ShipmentInvoices({ invoices, loading, error }) {
  const navigate = useNavigate();
  if (error && /403|cannot manage invoices|Required: admin or finance/i.test(error)) return null; // no invoice access for this role

  return (
    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
      <div style={sectionTitle}>🧾 Carrier invoices</div>
      {loading && <div style={{ fontSize: 12, color: "var(--text3)" }}>Loading…</div>}
      {!loading && error && <div style={{ fontSize: 12, color: "#b91c1c" }}>{error}</div>}
      {!loading && !error && !invoices.length && (
        <div style={{ fontSize: 12, color: "var(--text3)" }}>No carrier invoice yet for this shipment.</div>
      )}
      {invoices.map((inv) => {
        const t = TONE[inv.status] || { bg: "#F8FAFC", fg: "#475569", line: "#E2E8F0" };
        return (
          <div key={inv.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
              {/* The invoice number opens it in Freight Invoices. */}
              <a href={`/freight-invoices?invoice=${encodeURIComponent(inv.id)}`} className="mono"
                onClick={(e) => { e.preventDefault(); navigate(`/freight-invoices?invoice=${encodeURIComponent(inv.id)}`); }}
                title={`Open invoice ${inv.num}`}
                style={{ color: "var(--accent)", fontWeight: 700, textDecoration: "underline", whiteSpace: "nowrap" }}>
                {inv.num}
              </a>
              <span style={{ color: "var(--text2)" }}>{inv.carrier}</span>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{money(inv.amount)}</span>
              <span style={{ whiteSpace: "nowrap", padding: "2px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: t.bg, color: t.fg, border: `1px solid ${t.line}` }}>{inv.status}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {inv.hasDocument && (
                  <button type="button" className="btn btn-secondary btn-sm" style={{ whiteSpace: "nowrap" }}
                    onClick={() => openInvoiceDocument(inv.id).catch((e) => window.alert(e?.message || "Could not open the document"))}
                    title="Open the original invoice PDF">
                    📄 View invoice
                  </button>
                )}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: inv.status === "Approved" ? "var(--text3)" : "#9A3412", marginTop: 6, lineHeight: 1.4 }}>
              {invoiceStateLine(inv)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
