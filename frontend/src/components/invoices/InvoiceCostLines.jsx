import { useState, useEffect } from "react";
import { InvoicesApi } from "../../lib/api";
import {
  costTypeLabel,
  sumApprovedCosts,
  sumInvoiceCosts,
  lineVariance,
} from "../../services/invoiceService";

/**
 * REQ-186 — per-cost-line breakdown of an invoice.
 *
 * Renders two columns of cost data:
 *   - Invoice Cost  — read-only, what the carrier billed (or what was
 *                     copied off the shipment for direct-create invoices).
 *   - Approved Cost — editable, defaults to Invoice Cost. PATCHed on
 *                     blur via InvoicesApi.updateCostLine.
 *
 * The component owns its own data fetch — when the parent passes a
 * `invoiceId`, this component loads the lines and watches them. The
 * read-only `legacyAgreed` and `legacyAmount` props are the fallback
 * scalars used to display historical invoices (created before
 * migration 042) that have no cost-line rows.
 */
export default function InvoiceCostLines({
  invoiceId,
  canEdit = true,
  legacyAgreed = 0,
  legacyAmount = 0,
  onTotalsChange,
}) {
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invoiceId) { setLines([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError("");
      try {
        const data = await InvoicesApi.listCostLines(invoiceId);
        if (cancelled) return;
        const arr = Array.isArray(data?.costLines) ? data.costLines : [];
        setLines(arr);
        if (typeof onTotalsChange === "function") {
          onTotalsChange({
            invoiceTotal: sumInvoiceCosts(arr),
            approvedTotal: sumApprovedCosts(arr),
            lineCount: arr.length,
          });
        }
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || "Failed to load cost lines");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  function setLineLocal(lineId, patch) {
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l))
    );
  }

  async function commitApprovedCost(line, nextValue) {
    const next = Number(nextValue);
    if (!Number.isFinite(next) || next < 0) {
      setLineLocal(line.id, { approved_cost: line.approved_cost });
      return;
    }
    if (Number(line.approved_cost) === next) return;
    setSavingId(line.id);
    try {
      const updated = await InvoicesApi.updateCostLine(invoiceId, line.id, {
        approved_cost: next,
      });
      setLineLocal(line.id, updated);
      if (typeof onTotalsChange === "function") {
        const fresh = lines.map((l) => (l.id === updated.id ? updated : l));
        onTotalsChange({
          invoiceTotal: sumInvoiceCosts(fresh),
          approvedTotal: sumApprovedCosts(fresh),
          lineCount: fresh.length,
        });
      }
    } catch (e) {
      // Revert local state on server failure
      setLineLocal(line.id, { approved_cost: line.approved_cost });
      setError(e?.message || "Failed to save approved cost");
    } finally {
      setSavingId(null);
    }
  }

  // Legacy-invoice fallback: no rows in invoice_cost_lines, fall back
  // to the original scalar columns so the modal still shows something.
  if (!loading && !lines.length) {
    return (
      <LegacyCostBlock agreed={legacyAgreed} amount={legacyAmount} />
    );
  }

  const invoiceTotal  = sumInvoiceCosts(lines);
  const approvedTotal = sumApprovedCosts(lines);
  const totalVariance = Math.round((approvedTotal - invoiceTotal) * 100) / 100;

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Cost Lines ({lines.length})</div>
        {error && (
          <div style={{ color: "var(--red, #dc2626)", fontSize: 11 }}>⚠ {error}</div>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text3)" }}>
              <th style={{ padding: "4px 6px" }}>Type</th>
              <th style={{ padding: "4px 6px" }}>Description</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Invoice Cost</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Approved Cost</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const delta = lineVariance(l);
              return (
                <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px", fontWeight: 600 }}>{costTypeLabel(l.cost_type)}</td>
                  <td style={{ padding: "6px", color: "var(--text2)" }}>{l.description || "—"}</td>
                  <td className="mono" style={{ padding: "6px", textAlign: "right", opacity: 0.75 }}>
                    {fmtMoney(l.invoice_cost)}
                  </td>
                  <td className="mono" style={{ padding: "6px", textAlign: "right" }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      readOnly={!canEdit}
                      disabled={savingId === l.id}
                      value={l.approved_cost ?? ""}
                      onChange={(e) =>
                        setLineLocal(l.id, { approved_cost: e.target.value })
                      }
                      onBlur={(e) => canEdit && commitApprovedCost(l, e.target.value)}
                      style={{
                        width: 100, textAlign: "right", padding: "2px 4px",
                        background: canEdit ? "transparent" : "var(--bg2)",
                        border: "1px solid var(--border)", borderRadius: 4,
                      }}
                    />
                  </td>
                  <td
                    className="mono"
                    style={{
                      padding: "6px", textAlign: "right",
                      color: delta === 0 ? "var(--text3)" : (delta < 0 ? "var(--green, #16a34a)" : "var(--red, #dc2626)"),
                    }}
                  >
                    {delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${fmtMoney(delta)}`}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "2px solid var(--border)", fontWeight: 700 }}>
              <td colSpan={2} style={{ padding: "6px", textAlign: "right" }}>Totals</td>
              <td className="mono" style={{ padding: "6px", textAlign: "right" }}>{fmtMoney(invoiceTotal)}</td>
              <td className="mono" style={{ padding: "6px", textAlign: "right" }}>{fmtMoney(approvedTotal)}</td>
              <td
                className="mono"
                style={{
                  padding: "6px", textAlign: "right",
                  color: totalVariance === 0 ? "var(--text3)" : (totalVariance < 0 ? "var(--green, #16a34a)" : "var(--red, #dc2626)"),
                }}
              >
                {totalVariance === 0 ? "—" : `${totalVariance > 0 ? "+" : ""}${fmtMoney(totalVariance)}`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {!canEdit && (
        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 6 }}>
          Read-only — your role doesn't allow approving cost adjustments.
        </div>
      )}
    </div>
  );
}

function LegacyCostBlock({ agreed, amount }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, marginTop: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
        Cost Lines
      </div>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 8 }}>
        Legacy invoice — no per-line breakdown on file. Showing totals only.
      </div>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ padding: "6px" }}>Invoice Total (carrier-billed)</td>
            <td className="mono" style={{ padding: "6px", textAlign: "right" }}>{fmtMoney(amount)}</td>
          </tr>
          <tr>
            <td style={{ padding: "6px" }}>Approved Total (agreed)</td>
            <td className="mono" style={{ padding: "6px", textAlign: "right" }}>{fmtMoney(agreed)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
