import { APPT_TYPE_COLORS } from "../../constants/docks";

const LEGEND_ITEMS = [
  { label: "Inbound",   key: "Inbound" },
  { label: "Outbound",  key: "Outbound" },
  { label: "Cross-Dock", key: "Cross-Dock" },
  { label: "Conflict",  key: "Conflict" },
  { label: "Blocked",   key: "Blocked" },
];

export default function DockLegend() {
  return (
    <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 12, padding: "8px 12px", background: "var(--bg3)", borderRadius: 8 }}>
      {LEGEND_ITEMS.map(({ label, key }) => (
        <span key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: APPT_TYPE_COLORS[key], display: "inline-block" }} />
          {label}
        </span>
      ))}
    </div>
  );
}
