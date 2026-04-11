export default function PlaceholderPage({ title, icon, description }) {
  return (
    <div>
      <h2>{title}</h2>
      <div className="page-subtitle">{description}</div>
      <div className="empty-state" style={{ marginTop: 40 }}>
        <div className="empty-state-icon">{icon || "🚧"}</div>
        <div className="empty-state-title">Coming Soon</div>
        <div className="empty-state-desc">
          This page is being built. Check back soon.
        </div>
      </div>
    </div>
  );
}
