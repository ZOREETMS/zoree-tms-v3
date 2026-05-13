import { useState, useEffect } from "react";
import { InvoicesApi } from "../../lib/api";
import {
  costTypeLabel,
  sumApprovedCosts,
  sumInvoiceCosts,
  lineVariance,
  COST_TYPE_LABELS,
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
  // QA 226 (2026-05-12): "Add Cost" form state — Cost Type + Value.
  // Stays local; parent gets totals via onTotalsChange after each insert.
  const [draftType, setDraftType] = useState("accessorial");
  const [draftValue, setDraftValue] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [adding, setAdding] = useState(false);

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

  // QA 226 (2026-05-12): handler for the Add Cost button. Validates
  // the value, POSTs to /api/invoices/:id/cost-lines, appends locally,
  // and notifies the parent so the modal totals refresh.
  async function handleAddCost() {
    setError("");
    if (!invoiceId) {
      setError("Save the invoice before adding cost lines");
      return;
    }
    const value = Number(draftValue);
    if (!Number.isFinite(value) || value < 0) {
      setError("Value must be a non-negative number");
      return;
    }
    if (!draftType) {
      setError("Pick a cost type");
      return;
    }
    setAdding(true);
    try {
      const created = await InvoicesApi.addCostLine(invoiceId, {
        cost_type:     draftType,
        invoice_cost:  value,
        approved_cost: value,
        description:   draftDescription.trim() || null,
      });
      const next = [...lines, created];
      setLines(next);
      setDraftValue("");
      setDraftDescription("");
      if (typeof onTotalsChange === "function") {
        onTotalsChange({
          invoiceTotal:  sumInvoiceCosts(next),
          approvedTotal: sumApprovedCosts(next),
          lineCount:     next.length,
        });
      }
    } catch (e) {
      setError(e?.message || "Failed to add cost line");
    } finally {
      setAdding(false);
    }
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
  // QA 226: still render the Add Cost form when canEdit + invoiceId so
  // a finance user can attach the first line on an empty invoice.
  if (!loading && !lines.length) {
    return (
      <>
        <LegacyCostBlock agreed={legacyAgreed} amount={legacyAmount} />
        {canEdit && invoiceId && (
          <AddCostForm
            type={draftType} setType={setDraftType}
            value={draftValue} setValue={setDraftValue}
            description={draftDescription} setDescription={setDraftDescription}
            onAdd={handleAddCost} busy={adding} error={error}
          />
        )}
      </>
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
      {/* QA 226 (2026-05-12): Add Cost form — Cost Type + Value + Add
          button. Hidden when read-only and when the invoice has not
          been persisted (no id to POST to). */}
      {canEdit && invoiceId && (
        <AddCostForm
          type={draftType} setType={setDraftType}
          value={draftValue} setValue={setDraftValue}
          description={draftDescription} setDescription={setDraftDescription}
          onAdd={handleAddCost} busy={adding} error={error}
        />
      )}
    </div>
  );
}

// ── Add Cost form ─────────────────────────────────────────────────
// QA 226: Cost Type dropdown + Value field + Add Cost button.
function AddCostForm({
  type, setType, value, setValue, description, setDescription,
  onAdd, busy, error,
}) {
  return (
    <div
      style={{
        marginTop: 12, paddingTop: 12,
        borderTop: "1px dashed var(--border)",
        display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12, minWidth: 78 }}>Add cost</div>
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        style={{
          padding: "4px 8px", border: "1px solid var(--border)",
          borderRadius: 6, fontSize: 12, background: "#fff",
        }}
        aria-label="Cost type"
      >
        {Object.entries(COST_TYPE_LABELS).map(([k, label]) => (
          <option key={k} value={k}>{label}</option>
        ))}
      </select>
      <input
        type="number"
        step="0.01"
        min="0"
        placeholder="Value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{
          width: 110, padding: "4px 8px", border: "1px solid var(--border)",
          borderRadius: 6, fontSize: 12, textAlign: "right",
        }}
        aria-label="Cost value"
      />
      <input
        type="text"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        style={{
          flex: 1, minWidth: 160, padding: "4px 8px",
          border: "1px solid var(--border)", borderRadius: 6, fontSize: 12,
        }}
        aria-label="Cost description"
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={onAdd}
        disabled={busy || !value}
      >
        {busy ? "Adding\u2026" : "+ Add Cost"}
      </button>
      {error && (
        <div style={{ flexBasis: "100%", color: "var(--red, #dc2626)", fontSize: 11 }}>
          \u26a0 {error}
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
