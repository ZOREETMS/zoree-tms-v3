// A shipment id that opens the shipment's details (Shipments page, ?id=).
import { useNavigate } from "react-router-dom";

export default function ShipmentLink({ id, children, style }) {
  const navigate = useNavigate();
  if (!id) return <span style={{ color: "var(--text3)" }}>—</span>;
  return (
    <a href={`/shipments?id=${encodeURIComponent(id)}`} className="mono"
      title={`Open shipment ${id}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/shipments?id=${encodeURIComponent(id)}`); }}
      style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none", ...style }}>
      {children || id}
    </a>
  );
}
