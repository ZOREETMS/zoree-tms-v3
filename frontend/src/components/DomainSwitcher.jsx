// ═══════════════════════════════════════════════════════════════════
// DomainSwitcher (migration 052) — sidebar footer. Shows the client
// domain the user is working in; with access to 2+ domains it is a
// picker. Everything on screen is scoped to the active domain.
// ═══════════════════════════════════════════════════════════════════
import { useAuth } from "../state/AuthContext";
import { useDomains } from "../hooks/useDomains";

export default function DomainSwitcher() {
  const { user } = useAuth();
  const { domains, active, activeName, switchDomain } = useDomains(!!user);
  if (!user || !active) return null;

  return (
    <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,.08)", marginBottom: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "rgba(255,255,255,.5)", marginBottom: 6 }}>
        Domain
      </div>
      {domains.length < 2 ? (
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{activeName}</div>
      ) : (
        <select
          value={active}
          onChange={(e) => switchDomain(e.target.value)}
          title="Client domain — all data on screen belongs to this domain"
          style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,.2)",
                   background: "rgba(255,255,255,.08)", color: "#fff", fontSize: 12, fontWeight: 600 }}
        >
          {domains.map((d) => (
            <option key={d.code} value={d.code} style={{ color: "#111" }}>{d.name} ({d.code})</option>
          ))}
        </select>
      )}
    </div>
  );
}
