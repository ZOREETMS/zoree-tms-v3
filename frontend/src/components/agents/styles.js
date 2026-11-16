// AI Agent Console styles — shared panel styles plus a few console-specific ones.
import { ui as panel } from "../ui/panelStyles";

export const ui = {
  ...panel,
  layout: { display: "grid", gridTemplateColumns: "250px 1fr", gap: 20, alignItems: "start" },
  side: { position: "sticky", top: 12, display: "flex", flexDirection: "column", gap: 6 },
  agentBtn: (on) => ({
    textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13.5,
    border: on ? "1px solid #0f172a" : "1px solid #e2e8f0", background: on ? "#0f172a" : "#fff", color: on ? "#fff" : "#0f172a",
    display: "flex", alignItems: "center", gap: 8, fontWeight: on ? 700 : 500,
  }),
  badge: { marginLeft: "auto", background: "#f59e0b", color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "1px 7px" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 },
  textarea: { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontFamily: "inherit", minHeight: 150, textTransform: "none", lineHeight: 1.45 },
  actionCard: (status) => ({
    border: `1px solid ${status === "proposed" ? "#fcd34d" : "#e2e8f0"}`, background: status === "proposed" ? "#fffdf5" : "#fff",
    borderRadius: 10, padding: 12, marginTop: 10,
  }),
  kpi: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 12px" },
  kpiNum: { fontSize: 20, fontWeight: 800, color: "#0f172a" },
  scoreBar: (pct, color) => ({ height: 6, borderRadius: 999, background: `linear-gradient(90deg, ${color} ${pct}%, #e2e8f0 ${pct}%)` }),
  // The app uppercases body text and inputs; message drafts must keep their case.
  plain: { textTransform: "none" },
};
