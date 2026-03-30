export default function CarrierCertsCard({ certRecords }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Carrier Certification Status</span>
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {certRecords.map((car, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>{car.name}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--text3)" }}>{car.scac}</span>
            {car.hazmatCert && (
              <span style={{
                fontSize: 10, background: "rgba(239,68,68,.1)", color: "var(--red)",
                border: "1px solid rgba(239,68,68,.2)", padding: "2px 7px", borderRadius: 8,
              }}>
                ☢️ Hazmat Cert
              </span>
            )}
            <span style={{
              marginLeft: "auto", fontSize: 10, color: "var(--green)", background: "var(--green-dim)",
              border: "1px solid rgba(16,185,129,.2)", padding: "2px 9px", borderRadius: 10, fontWeight: 600,
            }}>
              ✓ Active
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
