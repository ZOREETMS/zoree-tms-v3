const headerCellStyle = { padding: "8px 16px", textAlign: "left", fontSize: 10, textTransform: "uppercase", borderRight: "1px solid #ccc" };
const cellStyle = { padding: "10px 16px", borderRight: "1px solid #ccc" };

export default function InvoiceDocument({ doc, shipment, carrier }) {
  const s = shipment || {};
  const costNum = parseInt((s.cost || "$0").replace(/[$,]/g, "")) || 0;
  const fsc = Math.round(costNum * 0.225);
  const base = costNum - fsc;
  const dueDate = doc.generated
    ? new Date(new Date(doc.generated).getTime() + 14 * 864e5).toISOString().split("T")[0]
    : "";

  return (
    <div style={{ border: "2px solid #000", fontSize: 12, color: "#000", background: "#fff" }}>
      {/* Header */}
      <div style={{ padding: 16, borderBottom: "2px solid #000", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 2 }}>ZOREE TMS</div>
          <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>1309 Coffeen Ave, Ste 3336, Sheridan, WY 82801</div>
          <div style={{ fontSize: 14, fontWeight: 800, marginTop: 10, letterSpacing: 1 }}>COMMERCIAL INVOICE</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#666" }}>Invoice Number</div>
          <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "monospace", color: "#1e2d6b" }}>{doc.id}</div>
          <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>Invoice Date: {doc.generated}</div>
          <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>Due Date: {dueDate}</div>
        </div>
      </div>

      {/* Bill To / Shipment Reference */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "2px solid #000" }}>
        <div style={{ padding: "14px 16px", borderRight: "2px solid #000" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>Bill To</div>
          <div style={{ fontWeight: 700 }}>{s.carrier}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>Accounts Payable Dept</div>
          <div style={{ fontSize: 11, color: "#444" }}>SCAC: {carrier ? carrier.scac : "\u2014"}</div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>Shipment Reference</div>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 4, fontSize: 11 }}>
            <span style={{ color: "#666" }}>Shipment:</span>
            <span className="mono" style={{ fontWeight: 700 }}>{s.id}</span>
            <span style={{ color: "#666" }}>Lane:</span>
            <span>{(s.origin || "").split(",")[0]} &rarr; {(s.dest || "").split(",")[0]}</span>
            <span style={{ color: "#666" }}>Pickup:</span>
            <span className="mono">{s.pickup}</span>
            <span style={{ color: "#666" }}>Delivery:</span>
            <span className="mono">{s.delivery}</span>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <table style={{ width: "100%", borderCollapse: "collapse", borderBottom: "2px solid #000" }}>
        <thead>
          <tr style={{ background: "#f0f0f0" }}>
            {["Description", "Qty", "Unit", "Amount"].map((h) => (
              <th key={h} style={headerCellStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cellStyle}>Base Linehaul Rate</td>
            <td style={cellStyle}>1</td>
            <td style={{ ...cellStyle, fontFamily: "monospace" }}>${base.toLocaleString()}</td>
            <td style={{ ...cellStyle, fontFamily: "monospace" }}>${base.toLocaleString()}</td>
          </tr>
          <tr>
            <td style={cellStyle}>Fuel Surcharge (22.5%)</td>
            <td style={cellStyle}>1</td>
            <td style={{ ...cellStyle, fontFamily: "monospace" }}>${fsc.toLocaleString()}</td>
            <td style={{ ...cellStyle, fontFamily: "monospace" }}>${fsc.toLocaleString()}</td>
          </tr>
          <tr style={{ background: "#f8f8f8", fontWeight: 800, borderTop: "2px solid #000" }}>
            <td style={cellStyle} colSpan={3}>TOTAL DUE</td>
            <td style={{ ...cellStyle, fontFamily: "monospace", fontSize: 15, color: "#1e2d6b" }}>{s.cost}</td>
          </tr>
        </tbody>
      </table>

      {/* Footer */}
      <div style={{ padding: 16, fontSize: 10, color: "#666" }}>
        Payment Terms: Net 30 days. Please remit payment to Zoree TMS, referencing invoice number above.<br />
        Questions? Contact finance@zoree.io or call 1-800-ZOREE-TMS.
      </div>
    </div>
  );
}
