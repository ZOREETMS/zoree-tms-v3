export default function HazmatDocument({ doc, shipment, order }) {
  const s = shipment || {};
  const hazClass = order && order.hazmat ? "Class 3 — Flammable Liquid" : "Class 9 — Miscellaneous";

  return (
    <div style={{ border: "3px solid #ff0000", fontSize: 12, color: "#000", background: "#fff" }}>
      {/* Red Header */}
      <div style={{ background: "#ff0000", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 900, letterSpacing: 2 }}>
          HAZARDOUS MATERIALS DECLARATION
        </div>
        <div style={{ color: "#fff", fontSize: 12, fontFamily: "monospace" }}>{doc.id}</div>
      </div>

      {/* Dangerous Goods Declaration */}
      <div style={{ padding: "14px 16px", borderBottom: "2px solid #000", background: "#fff9f9" }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>Dangerous Goods Declaration</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 11 }}>
          <div>
            <div style={{ color: "#666" }}>UN Number</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>UN1993</div>
          </div>
          <div>
            <div style={{ color: "#666" }}>Proper Shipping Name</div>
            <div style={{ fontWeight: 700 }}>{s.commodity}</div>
          </div>
          <div>
            <div style={{ color: "#666" }}>Hazard Class</div>
            <div style={{ fontWeight: 700, color: "#cc0000" }}>{hazClass}</div>
          </div>
          <div>
            <div style={{ color: "#666" }}>Packing Group</div>
            <div style={{ fontWeight: 700 }}>PG II</div>
          </div>
          <div>
            <div style={{ color: "#666" }}>Total Quantity</div>
            <div style={{ fontWeight: 700 }}>{s.weight} lbs</div>
          </div>
          <div>
            <div style={{ color: "#666" }}>Placard Required</div>
            <div style={{ fontWeight: 700, color: "#cc0000" }}>YES — FLAMMABLE</div>
          </div>
        </div>
      </div>

      {/* Shipper / Emergency */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "2px solid #000" }}>
        <div style={{ padding: "14px 16px", borderRight: "2px solid #000" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>Shipper / Offeror</div>
          <div style={{ fontWeight: 700 }}>{order ? order.customer : "Zoree"}</div>
          <div style={{ fontSize: 11, color: "#444" }}>{s.origin}</div>
          <div style={{ fontSize: 11, color: "#444", marginTop: 8 }}>
            I hereby declare that the contents of this consignment are fully and accurately described above by the
            Proper Shipping Name, and are classified, packaged, marked, and labeled/placarded, and are in all
            respects in proper condition for transport according to applicable International and National
            governmental regulations.
          </div>
        </div>
        <div style={{ padding: "14px 16px" }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>Emergency Contact</div>
          <div style={{ background: "#fff3cd", border: "1px solid #ffc107", padding: 10, borderRadius: 4, fontSize: 11 }}>
            <div style={{ fontWeight: 700 }}>CHEMTREC 24-Hour Emergency</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#cc0000", marginTop: 4 }}>1-800-424-9300</div>
            <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>Carrier: {s.carrier}</div>
            <div style={{ fontSize: 10, color: "#666" }}>Shipment: {s.id}</div>
          </div>
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 20 }}>Shipper Certification Signature</div>
            <div style={{ borderBottom: "1px solid #000", height: 28, marginBottom: 6 }}></div>
            <div style={{ fontSize: 10, color: "#666" }}>Name / Title / Date</div>
          </div>
        </div>
      </div>
    </div>
  );
}
