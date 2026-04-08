const cellStyle = { padding: "10px 16px", borderRight: "1px solid #ccc" };
const headerCellStyle = { padding: "8px 16px", textAlign: "left", fontSize: 10, textTransform: "uppercase", borderRight: "1px solid #ccc" };
const sectionHeaderStyle = { fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".8px", borderBottom: "1px solid #000", paddingBottom: 4, marginBottom: 8 };
const labelStyle = { fontSize: 10, color: "#666", textTransform: "uppercase" };

export default function BOLDocument({ doc, shipment, order, carrier }) {
  const s = shipment || {};
  const scac = carrier ? carrier.scac : "\u2014";
  const proNum = s.pro_number || "\u2014";
  const bolNum = doc.id;
  const today = doc.generated;

  // Gather order IDs from doc or shipment
  const orderIds = doc.orderIds || s.order_ids || [];
  // Gather line items from doc
  const lineItems = doc.lineItems || [];
  // Gather orders from doc
  const linkedOrders = doc.orders || (order ? [order] : []);
  // Incoterms from dedicated column, fallback to orders snapshot
  const incoterms = doc.incoterms || linkedOrders[0]?.incoterms || null;

  return (
    <div style={{ border: "2px solid #000", fontSize: 12, color: "#000", background: "#fff" }}>
      {/* Header */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", borderBottom: "2px solid #000" }}>
        <div style={{ padding: "12px 16px", borderRight: "2px solid #000" }}>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: 2, marginBottom: 2 }}>ZOREE TMS</div>
          <div style={{ fontSize: 10, color: "#444" }}>1309 Coffeen Ave, Ste 3336, Sheridan, WY 82801</div>
          <div style={{ fontSize: 10, color: "#444" }}>support@zoree.io &nbsp;|&nbsp; zoree.io</div>
          <div style={{ marginTop: 8, fontSize: 14, fontWeight: 800, letterSpacing: 1, borderTop: "1px solid #ccc", paddingTop: 8 }}>
            STRAIGHT BILL OF LADING
          </div>
          <div style={{ fontSize: 10, color: "#444" }}>Original — Not Negotiable</div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <div style={labelStyle}>BOL Number</div>
          <div style={{ fontSize: 13, fontWeight: 900, fontFamily: "monospace", color: "#1e2d6b", whiteSpace: "nowrap" }}>{bolNum}</div>
          <div style={{ ...labelStyle, marginTop: 10 }}>Pro Number</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>{proNum}</div>
          <div style={{ ...labelStyle, marginTop: 10 }}>Date</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{today}</div>
        </div>
      </div>

      {/* Carrier / Shipper / Consignee */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "2px solid #000" }}>
        <div style={{ padding: "12px 16px", borderRight: "2px solid #000" }}>
          <div style={sectionHeaderStyle}>Carrier</div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{s.carrier}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>SCAC: {scac}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Mode: {s.mode}</div>
        </div>
        <div style={{ padding: "12px 16px", borderRight: "2px solid #000" }}>
          <div style={sectionHeaderStyle}>Shipper (Origin)</div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{order ? order.customer : "Zoree Shipper"}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>{s.origin}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Ready: {s.pickup}</div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <div style={sectionHeaderStyle}>Consignee (Destination)</div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{order ? order.customer : "Consignee"}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 3 }}>{s.dest}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>Deliver by: {s.delivery}</div>
        </div>
      </div>

      {/* Order Numbers */}
      {orderIds.length > 0 && (
        <div style={{ borderBottom: "2px solid #000", padding: "10px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 6 }}>
            Order Numbers
          </div>
          <div style={{ fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>
            {orderIds.join(", ")}
          </div>
        </div>
      )}

      {/* Line Items Table */}
      <div style={{ borderBottom: "2px solid #000" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f0f0f0" }}>
              <th style={headerCellStyle}>Item ID</th>
              <th style={headerCellStyle}>Description</th>
              <th style={headerCellStyle}>Qty</th>
              <th style={headerCellStyle}>Weight (lbs)</th>
              <th style={{ ...headerCellStyle, borderRight: "none" }}>Hazmat</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.length > 0 ? lineItems.map((item, idx) => (
              <tr key={item.id || idx} style={{ borderTop: "1px solid #e0e0e0" }}>
                <td style={{ ...cellStyle, fontFamily: "monospace", fontWeight: 600 }}>{item.item_id || `ITEM-${idx + 1}`}</td>
                <td style={{ ...cellStyle, fontWeight: 600 }}>{item.description || item.commodity || "\u2014"}</td>
                <td style={{ ...cellStyle, fontFamily: "monospace", textAlign: "right" }}>{item.qty_ordered || item.qty || item.quantity || 1}</td>
                <td style={{ ...cellStyle, fontFamily: "monospace", textAlign: "right" }}>{item.total_weight || item.weight || "\u2014"}</td>
                <td style={{ ...cellStyle, borderRight: "none" }}>{item.hazmat ? "YES" : "No"}</td>
              </tr>
            )) : (
              <tr style={{ borderTop: "1px solid #e0e0e0" }}>
                <td style={cellStyle}>\u2014</td>
                <td style={{ ...cellStyle, fontWeight: 600 }}>{s.commodity || "General"}</td>
                <td style={{ ...cellStyle, textAlign: "right" }}>{s.pieces || "\u2014"}</td>
                <td style={{ ...cellStyle, fontFamily: "monospace", textAlign: "right" }}>{s.weight}</td>
                <td style={{ ...cellStyle, borderRight: "none" }}>{order && order.hazmat ? "YES" : "No"}</td>
              </tr>
            )}
            <tr style={{ background: "#f8f8f8", borderTop: "2px solid #000", fontWeight: 800 }}>
              <td style={cellStyle} colSpan={3}>TOTAL</td>
              <td style={{ ...cellStyle, fontFamily: "monospace", textAlign: "right" }}>{s.weight} lbs</td>
              <td style={{ ...cellStyle, borderRight: "none" }}></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Special Instructions & References */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "2px solid #000" }}>
        <div style={{ padding: "12px 16px", borderRight: "2px solid #000" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 6 }}>
            Special Instructions
          </div>
          <div style={{ fontSize: 11, color: "#444", lineHeight: 1.6 }}>
            {order && order.hazmat && <span>WARNING: HAZARDOUS MATERIAL — See Hazmat papers attached.<br /></span>}
            Protect from freezing. Handle with care.<br />
            Deliver before {s.delivery} — customer appointment required.
          </div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".8px", marginBottom: 8 }}>
            Reference Numbers
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 4, fontSize: 11 }}>
            <span style={{ color: "#666" }}>Shipment ID:</span>
            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{s.id}</span>
            <span style={{ color: "#666" }}>BOL #:</span>
            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{bolNum}</span>
            <span style={{ color: "#666" }}>Pro #:</span>
            <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{proNum}</span>
            {orderIds.length > 0 && (
              <>
                <span style={{ color: "#666" }}>{orderIds.length > 1 ? "Orders:" : "Order #:"}</span>
                <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{orderIds.join(", ")}</span>
              </>
            )}
            <span style={{ color: "#666" }}>Rate Type:</span>
            <span>{s.mode} — Contract</span>
            {incoterms && (
              <>
                <span style={{ color: "#666" }}>Incoterms:</span>
                <span style={{ fontWeight: 700 }}>{incoterms}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Signatures */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: 16, gap: 20 }}>
        {["Shipper Signature", "Carrier Signature", "Consignee Signature"].map((label) => (
          <div key={label}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 24 }}>{label}</div>
            <div style={{ borderBottom: "1px solid #000", marginBottom: 6, height: 28 }}></div>
            <div style={{ fontSize: 10, color: "#666" }}>Name / Date</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ background: "#f0f0f0", padding: "8px 16px", borderTop: "1px solid #ccc", fontSize: 9, color: "#666", lineHeight: 1.4 }}>
        RECEIVED, subject to individually determined rates or contracts that have been agreed upon in writing
        between the carrier and shipper, if applicable, otherwise to all applicable tariff rates, the property
        described herein. Every service to be performed hereunder shall be subject to all the conditions not
        prohibited by law, whether printed or written, herein contained.
      </div>
    </div>
  );
}
