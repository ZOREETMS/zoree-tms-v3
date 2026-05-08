/**
 * OrderImportModal — Excel/CSV bulk-import UI for the Orders page.
 *
 * Presentational layer only. Parsing, header-mapping, validation, and
 * persistence all live in services/orderImportService.js (CLAUDE_RULES
 * §2 — services-first; §6/§9 — keep components free of large inline
 * logic blocks).
 *
 * Flow
 *   1. user picks (or drops) a .xlsx/.csv file
 *   2. service parses + analyzes
 *   3. preview shows total / valid / invalid and the first rows so the
 *      user can sanity-check their sheet
 *   4. "Import N Orders" runs the chunked POST with progress
 *   5. on done → onComplete() so the parent reloads orders
 */

import { useMemo, useRef, useState } from "react";
import {
  analyzeOrderUpload,
  bulkImportOrders,
  downloadOrderTemplate,
  parseOrderFile,
} from "../../services/orderImportService";

const ACCEPTED_EXTS = [".xlsx", ".xlsm", ".xls", ".csv"];
const PREVIEW_ROWS  = 8;
const PREVIEW_FIELDS = [
  { key: "customer",    label: "CUSTOMER" },
  { key: "origin",      label: "ORIGIN" },
  { key: "destination", label: "DESTINATION" },
  { key: "weight",      label: "WEIGHT" },
  { key: "pieces",      label: "PIECES" },
  { key: "commodity",   label: "COMMODITY" },
  { key: "readyDate",   label: "READY" },
  { key: "dueDate",     label: "DUE" },
];

function isAcceptable(file) {
  if (!file?.name) return false;
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function StatBlock({ label, value, color }) {
  return (
    <div style={{
      flex: 1, minWidth: 110, padding: "10px 12px",
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: 10, textAlign: "center",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text3)", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--text1)" }}>{value}</div>
    </div>
  );
}

export default function OrderImportModal({ open, onClose, onComplete }) {
  const [file, setFile]         = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [stage, setStage]       = useState("idle"); // idle | parsing | preview | importing | done
  const [error, setError]       = useState("");
  const [result, setResult]     = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const counts     = analysis?.counts || { total: 0, valid: 0, invalid: 0 };
  const importable = useMemo(() => {
    if (!analysis) return 0;
    return analysis.analyzed.filter((a) => a.errors.length === 0).length;
  }, [analysis]);

  function reset() {
    setFile(null);
    setAnalysis(null);
    setBusy(false);
    setProgress({ completed: 0, total: 0 });
    setStage("idle");
    setError("");
    setResult(null);
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose && onClose();
  }

  async function handlePickFile(picked) {
    if (!picked) return;
    if (!isAcceptable(picked)) {
      setError(`Unsupported file type. Accepted: ${ACCEPTED_EXTS.join(", ")}`);
      return;
    }
    setError("");
    setFile(picked);
    setStage("parsing");
    setAnalysis(null);
    setResult(null);
    try {
      // parseOrderFile returns the Orders sheet AND the optional Line
      // Items sheet (TMS bug #144). Forward both halves to analyze so
      // line-item rows get linked to their parent orders by Order Row #.
      // Defaults via destructuring keep this safe for legacy 8-column
      // single-sheet files where the Line Items sheet is absent.
      const parsed = await parseOrderFile(picked);
      const { headers, rows, lineItemHeaders = [], lineItemRows = [] } = parsed;
      if (rows.length === 0) {
        setError("The uploaded file has no data rows.");
        setStage("idle");
        return;
      }
      const a = analyzeOrderUpload({ headers, rows, lineItemHeaders, lineItemRows });
      setAnalysis(a);
      setStage("preview");
    } catch (err) {
      setError(err?.message || "Failed to parse file.");
      setStage("idle");
    }
  }

  function handleInputChange(e) {
    const picked = e.target.files?.[0];
    handlePickFile(picked);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const picked = e.dataTransfer?.files?.[0];
    handlePickFile(picked);
  }

  async function handleImport() {
    if (!analysis) return;
    setBusy(true);
    setStage("importing");
    setError("");
    try {
      const summary = await bulkImportOrders(analysis.analyzed, {
        onProgress: setProgress,
      });
      setResult(summary);
      setStage("done");
    } catch (err) {
      setError(err?.message || "Import failed.");
      setStage("preview");
    } finally {
      setBusy(false);
    }
  }

  function handleFinish() {
    const created = result?.created || 0;
    if (onComplete) onComplete({
      created,
      // Forward the new ORD- ids so the parent toast can show them
      // (bug #142). Default to an empty array so older callers that
      // only destructure `created` keep working.
      createdOrderIds: result?.createdOrderIds || [],
      failed: result?.failed || [],
    });
    reset();
    onClose && onClose();
  }

  if (!open) return null;

  /* ───────── Drop-zone (idle / parsing) ───────── */
  const renderDropZone = () => (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
        background: dragOver ? "rgba(79,70,229,.05)" : "var(--bg2)",
        borderRadius: 12, padding: "32px 20px", textAlign: "center",
        cursor: "pointer", transition: "all .15s",
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 6 }}>📥</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text1)" }}>
        {stage === "parsing" ? "Reading file..." : "Click or drop your order sheet here"}
      </div>
      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
        Accepted: {ACCEPTED_EXTS.join(", ")}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTS.join(",")}
        onChange={handleInputChange}
        style={{ display: "none" }}
      />
      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 12 }}>
        Don't have a sheet yet?{" "}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); downloadOrderTemplate(); }}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: 11 }}
        >
          Download the template
        </button>
      </div>
    </div>
  );

  /* ───────── Preview (post-parse) ───────── */
  const renderPreview = () => {
    const sampleRows = analysis.analyzed.slice(0, PREVIEW_ROWS);
    // Bug #144: surface the line-items summary (only if a Line Items
    // sheet was present + matched) so the user knows lines will land
    // on import. Suppressed entirely on legacy single-sheet imports
    // so the modal looks unchanged for users who don't use the new
    // sheet.
    const liTotal       = counts.lineItemsTotal      || 0;
    const liOrders      = counts.ordersWithLines     || 0;
    const liUnattached  = counts.unattachedLineItems || 0;
    const showLineItemsBanner = liTotal > 0 || liUnattached > 0;
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <StatBlock label="TOTAL"   value={counts.total} />
          <StatBlock label="VALID"   value={counts.valid}   color="#16a34a" />
          <StatBlock label="INVALID" value={counts.invalid} color="#b91c1c" />
          {liTotal > 0 && (
            <StatBlock label="LINE ITEMS" value={`${liTotal} / ${liOrders} ord`} color="#4f46e5" />
          )}
        </div>

        {showLineItemsBanner && liUnattached > 0 && (
          <div style={{
            background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.3)",
            borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#92400e",
          }}>
            <strong>{liUnattached} line item{liUnattached === 1 ? "" : "s"}</strong>
            {" "}on the Line Items sheet had no matching Order Row #
            {" "}— those rows will be ignored on import. Check that the Order Row #
            column points to the 1-based position in the Orders sheet (1 = first data row).
          </div>
        )}

        {analysis.unmappedHeaders.length > 0 && (
          <div style={{
            background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.3)",
            borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#92400e",
          }}>
            <strong>Ignored columns:</strong>{" "}
            {analysis.unmappedHeaders.join(", ")}
          </div>
        )}

        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", marginBottom: 6, letterSpacing: 0.5 }}>
          PREVIEW (FIRST {Math.min(PREVIEW_ROWS, sampleRows.length)} ROWS)
        </div>
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
          <table className="grid" style={{ border: "none", boxShadow: "none", width: "100%", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                {PREVIEW_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {sampleRows.map((a) => {
                const bad = a.errors.length > 0;
                const lineCount = Array.isArray(a.payload?.lineItems) ? a.payload.lineItems.length : 0;
                return (
                  <tr key={a.rowNumber} style={bad ? { background: "rgba(239,68,68,.05)" } : undefined}>
                    <td className="mono text-sm" style={{ whiteSpace: "nowrap" }}>
                      {a.rowNumber}
                      {lineCount > 0 && (
                        <span
                          title={`${lineCount} line item${lineCount === 1 ? "" : "s"} attached to this order`}
                          style={{
                            marginLeft: 6, padding: "1px 6px", borderRadius: 999,
                            background: "rgba(79,70,229,.12)", color: "#4338ca",
                            fontSize: 10, fontWeight: 700,
                          }}
                        >
                          +{lineCount}
                        </span>
                      )}
                    </td>
                    {PREVIEW_FIELDS.map((f) => (
                      <td key={f.key} className="text-sm" style={{ whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {String(a.payload[f.key] ?? "")}
                      </td>
                    ))}
                    <td className="text-sm">
                      {bad ? (
                        <span title={a.errors.join("\n")} style={{ color: "#b91c1c", fontWeight: 600 }}>
                          {a.errors.length} error{a.errors.length > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span style={{ color: "#16a34a", fontWeight: 600 }}>Ready</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {counts.invalid > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#b91c1c", fontWeight: 600 }}>
              Show validation errors ({counts.invalid})
            </summary>
            <ul style={{ marginTop: 6, fontSize: 11, color: "var(--text2)", maxHeight: 140, overflow: "auto", paddingLeft: 18 }}>
              {analysis.analyzed
                .filter((a) => a.errors.length > 0)
                .map((a) => (
                  <li key={a.rowNumber}>
                    <strong>Row {a.rowNumber}</strong>: {a.errors.join("; ")}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </div>
    );
  };

  /* ───────── Importing (progress) ───────── */
  const renderImporting = () => {
    const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
    return (
      <div style={{ padding: "20px 0", textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
          Importing {progress.completed} of {progress.total} orders...
        </div>
        <div style={{
          width: "100%", height: 10, background: "var(--bg2)",
          borderRadius: 999, overflow: "hidden", border: "1px solid var(--border)",
        }}>
          <div style={{
            width: `${pct}%`, height: "100%",
            background: "linear-gradient(90deg, #4f46e5, #6366f1)",
            transition: "width .15s",
          }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{pct}%</div>
      </div>
    );
  };

  /* ───────── Done summary ───────── */
  const renderDone = () => (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <StatBlock label="CREATED" value={result?.created || 0}        color="#16a34a" />
        <StatBlock label="FAILED"  value={result?.failed?.length || 0} color="#b91c1c" />
      </div>
      {result?.failed?.length > 0 && (
        <details open>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "#b91c1c", fontWeight: 600 }}>
            Failures ({result.failed.length})
          </summary>
          <ul style={{ marginTop: 6, fontSize: 11, color: "var(--text2)", maxHeight: 160, overflow: "auto", paddingLeft: 18 }}>
            {result.failed.map((f, i) => (
              <li key={i}>
                <strong>Row {f.rowNumber ?? "?"}</strong> ({f.customer || "—"}): {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-card" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ alignItems: "center", gap: 12 }}>
          <h3 style={{ margin: 0, flex: 1 }}>IMPORT ORDERS</h3>
          <button className="modal-close" onClick={handleClose} disabled={busy}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{
              background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.3)",
              borderRadius: 8, padding: "8px 12px", marginBottom: 10,
              fontSize: 12, color: "#b91c1c",
            }}>
              {error}
            </div>
          )}

          {file && stage !== "idle" && (
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
              <strong>File:</strong> {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </div>
          )}

          {stage === "idle"      && renderDropZone()}
          {stage === "parsing"   && renderDropZone()}
          {stage === "preview"   && analysis && renderPreview()}
          {stage === "importing" && renderImporting()}
          {stage === "done"      && renderDone()}
        </div>

        <div className="modal-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "14px 18px", borderTop: "1px solid var(--border)" }}>
          {stage === "preview" && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => { setFile(null); setAnalysis(null); setStage("idle"); }}>
                Choose different file
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleClose}>Cancel</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleImport}
                disabled={importable === 0}
                title={importable === 0 ? "Nothing to import — fix validation errors above" : ""}
              >
                Import {importable} Order{importable === 1 ? "" : "s"}
              </button>
            </>
          )}
          {stage === "importing" && (
            <button className="btn btn-secondary btn-sm" disabled>Importing…</button>
          )}
          {stage === "done" && (
            <button className="btn btn-primary btn-sm" onClick={handleFinish}>Done</button>
          )}
          {(stage === "idle" || stage === "parsing") && (
            <button className="btn btn-secondary btn-sm" onClick={handleClose} disabled={busy}>Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}
