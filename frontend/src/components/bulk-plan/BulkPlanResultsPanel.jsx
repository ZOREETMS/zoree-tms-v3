// ─────────────────────────────────────────────────────────────────────────────
// <BulkPlanResultsPanel> — inline pass/fail summary for a bulk plan run (REQ-28)
//
// Rendered on BulkPlanPage after planning finishes. Responsibilities:
//   • Show pass / fail counts side by side
//   • Render an inline list of failed orders with their reason
//   • Offer a "Download results (.xlsx)" button that writes Passed + Failed
//     sheets via bulkPlanResultsService
//
// All domain logic (building rows, generating xlsx) lives in the service layer.
// This component is presentation-only (Rule 2 — single-purpose component).
// ─────────────────────────────────────────────────────────────────────────────

import { downloadBulkPlanResults } from "../../services/bulkPlanResultsService";

function Pill({ color, children }) {
  return (
    <span
      className="badge"
      style={{
        fontSize: 12,
        padding: "3px 8px",
        borderRadius: 10,
        fontWeight: 700,
        background: color.bg,
        color: color.fg,
        border: `1px solid ${color.border}`,
      }}
    >
      {children}
    </span>
  );
}

const GREEN = { bg: "#dcfce7", fg: "#166534", border: "#86efac" };
const RED   = { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" };

export default function BulkPlanResultsPanel({ results, elapsedMs, onClose }) {
  if (!results) return null;
  const { passedCount, failedCount, failedRows } = results;
  const anyResult = passedCount + failedCount > 0;
  if (!anyResult) return null;

  return (
    <div
      className="card"
      style={{
        marginBottom: 16,
        border: failedCount > 0 ? "1px solid #fca5a5" : "1px solid #86efac",
        position: "relative",
      }}
    >
      <div className="card-body">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 22 }}>
            {failedCount > 0 ? "⚠️" : "✅"}
          </span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              Bulk Plan Results
            </div>
            <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
              <Pill color={GREEN}>{passedCount} passed</Pill>{" "}
              <Pill color={RED}>{failedCount} failed</Pill>
              {typeof elapsedMs === "number" && (
                <span style={{ marginLeft: 8, color: "var(--text3, #64748b)" }}>
                  in {(elapsedMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => downloadBulkPlanResults(results)}
            title="Download Passed + Failed sheets as .xlsx"
          >
            Download Results (.xlsx)
          </button>

          {/* QA #133: dismiss the per-run pass/fail rollup so the user can
              hide it after reviewing/downloading. Only rendered when an
              onClose handler is wired in. */}
          {typeof onClose === "function" && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Dismiss bulk plan results"
              title="Dismiss"
              style={{
                position: "absolute",
                top: 8,
                right: 10,
                background: "transparent",
                border: "none",
                fontSize: 18,
                lineHeight: 1,
                color: "var(--text3, #64748b)",
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              ×
            </button>
          )}
        </div>

        {failedCount > 0 && (
          <div
            style={{
              marginTop: 12,
              borderTop: "1px dashed #fca5a5",
              paddingTop: 10,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#991b1b",
                marginBottom: 6,
              }}
            >
              Failed orders
            </div>
            <div
              style={{
                maxHeight: 240,
                overflowY: "auto",
                fontSize: 12,
                display: "grid",
                gridTemplateColumns: "minmax(110px, auto) minmax(140px, auto) 1fr",
                columnGap: 12,
                rowGap: 6,
              }}
            >
              <div style={{ fontWeight: 700 }}>Order</div>
              <div style={{ fontWeight: 700 }}>Category</div>
              <div style={{ fontWeight: 700 }}>Reason</div>
              {failedRows.map((row) => (
                <FailedRow key={row.order_id} row={row} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FailedRow({ row }) {
  return (
    <>
      <div style={{ fontFamily: "monospace", color: "#1e293b" }}>{row.order_id}</div>
      <div style={{ color: "#475569" }}>{row.failure_category}</div>
      <div style={{ color: "#991b1b" }}>{row.reason}</div>
    </>
  );
}
