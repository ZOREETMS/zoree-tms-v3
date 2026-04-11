export default function ReportLibrary({ reports, activeReportId, onSelect }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title" style={{ fontSize: 12 }}>Report Library</span>
      </div>
      <div className="card-body" style={{ padding: 8 }}>
        {reports.map((r) => {
          const isActive = activeReportId === r.id;
          return (
            <div
              key={r.id}
              onClick={() => onSelect(r.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                cursor: "pointer",
                background: isActive ? "rgba(59,130,246,.1)" : "transparent",
                color: isActive ? "var(--accent)" : "var(--text)",
                marginBottom: 2,
                transition: "background .15s",
              }}
              onMouseOver={(e) => { if (!isActive) e.currentTarget.style.background = "#f0f4ff"; }}
              onMouseOut={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <span>{r.icon}</span>
              <span style={{ fontSize: "12.5px", fontWeight: isActive ? 700 : 400 }}>{r.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
