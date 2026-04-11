import { DOCK_DOORS, DOCK_HOURS, LOAD_DURATION_OPTIONS } from "../../constants/docks";

export default function DockReservationSection({ dockEnabled, dockDoor, dockStartTime, loadDuration, onModalChange, doors = DOCK_DOORS }) {
  return (
    <div style={{ padding: "12px 14px", background: "rgba(99,102,241,.04)", border: "1px solid rgba(99,102,241,.15)", borderRadius: 10, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={dockEnabled} onChange={(e) => onModalChange((p) => p ? { ...p, reserveDock: e.target.checked } : null)} style={{ accentColor: "#6366f1" }} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>Reserve Dock Door During Planning</span>
        </div>
        <span style={{ fontSize: 11, color: "var(--accent2)", fontWeight: 600 }}>Estimated Load Time: {loadDuration} min</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>Ship-From Dock</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, opacity: dockEnabled ? 1 : 0.4, pointerEvents: dockEnabled ? "auto" : "none" }}>
        <select value={dockDoor || doors[0]} onChange={(e) => onModalChange((p) => p ? { ...p, dockDoor: e.target.value } : null)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 11, fontWeight: 600 }}>
          {doors.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={dockStartTime || "06:00"} onChange={(e) => onModalChange((p) => p ? { ...p, dockStartTime: e.target.value } : null)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 11, fontWeight: 600 }}>
          {DOCK_HOURS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>({loadDuration} min)</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: dockEnabled ? 1 : 0.4, pointerEvents: dockEnabled ? "auto" : "none" }}>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>Loading Duration</span>
        <select value={loadDuration} onChange={(e) => onModalChange((p) => p ? { ...p, loadDuration: Number(e.target.value) } : null)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 11 }}>
          {LOAD_DURATION_OPTIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
        </select>
      </div>
      <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 6 }}>Rule of thumb: TL usually 60–120 min, LTL 45–90 min. Auto-estimate uses weight, pieces, and mode.</div>
    </div>
  );
}
