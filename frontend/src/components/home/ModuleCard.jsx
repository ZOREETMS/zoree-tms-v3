import { useNavigate } from "react-router-dom";

export default function ModuleCard({ to, icon, label, description }) {
  const navigate = useNavigate();

  return (
    <div className="module-card" onClick={() => navigate(to)}>
      <div className="module-card-icon">{icon}</div>
      <div className="module-card-info">
        <div className="module-card-title">{label}</div>
        <div className="module-card-desc">{description}</div>
      </div>
      <span className="module-card-arrow">&rsaquo;</span>
    </div>
  );
}
