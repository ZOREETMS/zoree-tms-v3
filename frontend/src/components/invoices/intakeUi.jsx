// Small shared pieces for the AP screens (review list, approval queue, drawer).
export const TONE = {
  ok: { bg: "#ECFDF5", fg: "#047857", line: "#A7F3D0", dot: "#10B981" },
  warn: { bg: "#FFF7ED", fg: "#C2410C", line: "#FED7AA", dot: "#F59E0B" },
  bad: { bg: "#FEF2F2", fg: "#B91C1C", line: "#FECACA", dot: "#EF4444" },
  info: { bg: "#EFF6FF", fg: "#1D4ED8", line: "#BFDBFE", dot: "#3B82F6" },
  none: { bg: "#F8FAFC", fg: "#475569", line: "#E2E8F0", dot: "#94A3B8" },
};

// Approval-queue risk (decided on the server, invoiceIntake/intakeLog.riskOf).
export const RISK = {
  critical: { label: "Critical", bg: "#DC2626", fg: "#fff" },
  high: { label: "High", bg: "#F87171", fg: "#fff" },
  medium: { label: "Medium", bg: "#F59E0B", fg: "#fff" },
  low: { label: "Low", bg: "#E2E8F0", fg: "#334155" },
};

export const money = (n) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const pct = (c) => (c == null ? "—" : `${Math.round(Number(c) * 100)}%`);
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

export function Pill({ tone = "none", children }) {
  const t = TONE[tone] || TONE.none;
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 6, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", background: t.bg, color: t.fg, border: `1px solid ${t.line}` }}>
      {children}
    </span>
  );
}

export function RiskPill({ risk }) {
  const r = RISK[risk];
  if (!r) return <span style={{ color: "var(--text3)" }}>—</span>;
  return <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: r.bg, color: r.fg }}>{r.label}</span>;
}

/** Read confidence as a number and a bar: green ≥ 90%, amber ≥ 75%, red below. */
export function ConfidenceBar({ value }) {
  if (value == null) return <span style={{ color: "var(--text3)" }}>—</span>;
  const p = Math.round(Number(value) * 100);
  const color = p >= 90 ? "#10B981" : p >= 75 ? "#F59E0B" : "#EF4444";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontWeight: 600, color, minWidth: 34 }}>{p}%</span>
      <span style={{ width: 54, height: 5, borderRadius: 3, background: "#E5E7EB", overflow: "hidden" }}>
        <span style={{ display: "block", width: `${p}%`, height: "100%", background: color }} />
      </span>
    </span>
  );
}

/** A per-field confidence as "98% ✓" (green), "78% !" (amber) or "52% ▲" (red). */
export function FieldConfidence({ value }) {
  if (value == null) return null;
  const p = Math.round(Number(value) * 100);
  const [color, mark] = p >= 90 ? ["#059669", "✓"] : p >= 75 ? ["#D97706", "!"] : ["#DC2626", "▲"];
  return <span style={{ fontSize: 12, fontWeight: 600, color, whiteSpace: "nowrap" }}>{p}% {mark}</span>;
}

/** Stat card used on the AP review and approval-queue screens. */
export function StatCard({ label, value, sub, tone, active, onClick }) {
  const t = TONE[tone] || TONE.none;
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="ap-card" style={{
      flex: "1 1 150px", textAlign: "left", padding: "14px 16px", cursor: onClick ? "pointer" : "default",
      outline: active ? `2px solid ${t.dot}` : "none", outlineOffset: -1, fontFamily: "inherit",
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12.5, color: "#475569", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
        {tone && <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 4, background: t.dot }} />}
        {label}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 2 }}>{sub}</div>}
    </button>
  );
}
