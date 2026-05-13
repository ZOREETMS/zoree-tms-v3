/** Customer access list — shows customers with portal access + share button */
// QA 249/254 (2026-05-12): `canEdit` defaults to true and gates the
// Share button so view-only roles cannot send the portal link.
export default function CustomerAccessList({ customers, onShare, canEdit = true }) {
  return (
    <div className="card">
      <div className="card-body" style={{ padding: 20 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: "var(--text3)",
          textTransform: "uppercase", letterSpacing: 1, marginBottom: 14,
        }}>
          🏢 Customers with Portal Access
        </div>
        <div>
          {customers.map((cust) => (
            <div
              key={cust.name}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", background: "#f8faff",
                borderRadius: 9, marginBottom: 6,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: "var(--accent)", display: "flex",
                alignItems: "center", justifyContent: "center",
                color: "#fff", fontWeight: 700, fontSize: 12,
              }}>
                {cust.initial}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{cust.name}</div>
                <div style={{ fontSize: 11, color: "var(--text3)" }}>
                  Portal access: {cust.portalStatus}
                </div>
              </div>
              {canEdit && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => onShare(cust.name)}
                >
                  🔗 Share
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
