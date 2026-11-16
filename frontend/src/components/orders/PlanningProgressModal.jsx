// "Planning in progress" dialog shown while Plan Selected / Bulk Plan run,
// so the screen is never blank between the click and the summary.
// Stages come from bulkPlanOrders' onProgress callback.
import { useEffect, useState } from "react";

const STAGES = [
  { key: "checking", label: "Checking orders" },
  { key: "rating", label: "Getting carrier rates" },
  { key: "creating", label: "Creating shipments" },
];

function stageDetail(key, p) {
  if (key === "rating" && p.lanes) return `${p.lanes} lane${p.lanes === 1 ? "" : "s"}`;
  if (key === "creating" && p.shipments) return `${p.shipments} shipment${p.shipments === 1 ? "" : "s"}`;
  return "";
}

export default function PlanningProgressModal({ progress }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!progress) return undefined;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [progress]);
  if (!progress) return null;

  const current = STAGES.findIndex((s) => s.key === progress.stage);
  const secs = ((now - progress.startedAt) / 1000).toFixed(1);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-live="polite" aria-label="Planning in progress" style={{ zIndex: 2000 }}>
      <div className="modal" style={{ maxWidth: 400, width: "92%", padding: "26px 28px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div className="spinner" style={{ margin: "0 auto 14px" }} />
        <div style={{ fontWeight: 800, fontSize: 17 }}>
          Planning {progress.orderCount} order{progress.orderCount === 1 ? "" : "s"}…
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{secs}s</div>
        <div style={{ textAlign: "left", margin: "18px auto 0", maxWidth: 260 }}>
          {STAGES.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 13, color: done || active ? "var(--text)" : "var(--text3)", fontWeight: active ? 700 : 500 }}>
                <span style={{ width: 18, textAlign: "center", color: done ? "var(--green)" : active ? "var(--accent)" : "var(--text3)" }}>
                  {done ? "✓" : active ? "●" : "○"}
                </span>
                <span>{s.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text3)", fontWeight: 500 }}>{stageDetail(s.key, progress)}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 16 }}>Please keep this page open.</div>
      </div>
    </div>
  );
}
