import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useOutletContext } from "react-router-dom";
import {
  parseFscScheduleFile,
  fetchEiaPrice,
  setManualEiaPrice,
  fetchCarrierSchedule,
  saveCarrierSchedule,
  deleteCarrierSchedule,
  lookupFscPct,
} from "../services/fscService";

/**
 * Fuel Surcharge page (Migration 045).
 * Per-carrier EIA-indexed FSC schedules: shows the current EIA U.S.
 * On-Highway Diesel price, lets the user upload a bracket workbook
 * (like CHR_Fuel_Surcharge_Lookup.xlsx) per carrier, and previews the
 * FSC % / $ the rating engine will apply.
 */
export default function FuelSurchargePage() {
  const { carriers } = useOutletContext();
  const [carrierId, setCarrierId] = useState("");
  const [eia, setEia] = useState(null);
  const [eiaBusy, setEiaBusy] = useState(false);
  const [manualPrice, setManualPrice] = useState("");
  const [brackets, setBrackets] = useState([]);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [parsed, setParsed] = useState(null); // { brackets, sheetName, skipped, converted, fileName }
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [linehaul, setLinehaul] = useState("500");
  const fileRef = useRef(null);

  function toast(text, type = "info") {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 5000);
  }

  const carrier = useMemo(
    () => (carriers || []).find((c) => c.id === carrierId) || null,
    [carriers, carrierId]
  );

  useEffect(() => {
    fetchEiaPrice().then(setEia).catch((e) => toast(`EIA price unavailable: ${e.message}`, "warning"));
  }, []);

  useEffect(() => {
    if (!carrierId) { setBrackets([]); setParsed(null); return; }
    setLoadingSchedule(true);
    setParsed(null);
    fetchCarrierSchedule(carrierId)
      .then(setBrackets)
      .catch((e) => { setBrackets([]); toast(`Failed loading schedule: ${e.message}`, "error"); })
      .finally(() => setLoadingSchedule(false));
  }, [carrierId]);

  async function refreshEia() {
    setEiaBusy(true);
    try {
      setEia(await fetchEiaPrice({ refresh: true }));
      toast("EIA diesel price refreshed", "success");
    } catch (e) { toast(`EIA refresh failed: ${e.message}`, "error"); }
    finally { setEiaBusy(false); }
  }

  async function saveManualPrice() {
    const p = parseFloat(manualPrice);
    if (!Number.isFinite(p) || p <= 0) { toast("Enter a valid $/gal price", "warning"); return; }
    setEiaBusy(true);
    try {
      setEia(await setManualEiaPrice({ price: p }));
      setManualPrice("");
      toast("Manual diesel price saved", "success");
    } catch (e) { toast(`Failed: ${e.message}`, "error"); }
    finally { setEiaBusy(false); }
  }

  async function onFileChosen(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await parseFscScheduleFile(file);
      setParsed({ ...result, fileName: file.name });
      toast(`Parsed ${result.brackets.length} brackets from "${result.sheetName}"${result.converted ? " (fractions converted to %)" : ""}`, "success");
    } catch (err) {
      setParsed(null);
      toast(err.message, "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveSchedule() {
    if (!carrierId || !parsed?.brackets?.length) return;
    setBusy(true);
    try {
      const saved = await saveCarrierSchedule(carrierId, parsed.brackets);
      setBrackets(saved);
      setParsed(null);
      toast(`Schedule saved — ${saved.length} brackets for ${carrier?.name || carrierId}`, "success");
    } catch (e) { toast(`Save failed: ${e.message}`, "error"); }
    finally { setBusy(false); }
  }

  async function removeSchedule() {
    if (!carrierId || !brackets.length) return;
    if (!window.confirm(`Delete the ${brackets.length}-bracket FSC schedule for ${carrier?.name || carrierId}?`)) return;
    setBusy(true);
    try {
      await deleteCarrierSchedule(carrierId);
      setBrackets([]);
      toast("Schedule deleted", "success");
    } catch (e) { toast(`Delete failed: ${e.message}`, "error"); }
    finally { setBusy(false); }
  }

  const activeBrackets = parsed ? parsed.brackets : brackets;
  const currentPct = eia?.price != null ? lookupFscPct(activeBrackets, eia.price) : null;
  const linehaulNum = parseFloat(linehaul) || 0;
  const fscAmount = currentPct != null ? Math.round(linehaulNum * currentPct) / 100 : null;
  const appliedBracket = useMemo(() => {
    if (currentPct == null || eia?.price == null) return null;
    let best = null;
    for (const b of activeBrackets) {
      const min = parseFloat(b.min_price);
      if (min <= eia.price && (best == null || min > best)) best = min;
    }
    return best;
  }, [activeBrackets, currentPct, eia]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2>Fuel Surcharge (EIA)</h2>
          <div className="page-subtitle">Per-carrier FSC schedules indexed to the EIA U.S. On-Highway Diesel price</div>
        </div>
      </div>

      {message.text && <div className={`toast toast-${message.type}`} style={{ marginBottom: 12 }}>{message.text}</div>}

      {/* EIA index card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 1 }}>EIA U.S. NATIONAL AVERAGE — ON-HIGHWAY DIESEL</div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>
              {eia?.price != null ? `$${Number(eia.price).toFixed(3)}/gal` : "—"}
              {eia && (
                <span className="badge badge-blue" style={{ marginLeft: 10, fontSize: 10, verticalAlign: "middle" }}>
                  week of {eia.priceDate} · {eia.source}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2" style={{ flexWrap: "wrap" }}>
            <button className="btn" onClick={refreshEia} disabled={eiaBusy}>{eiaBusy ? "Refreshing..." : "🔄 Refresh from EIA"}</button>
            <input
              type="number" step="0.001" placeholder="Manual $/gal"
              value={manualPrice} onChange={(e) => setManualPrice(e.target.value)}
              style={{ width: 130 }}
            />
            <button className="btn" onClick={saveManualPrice} disabled={eiaBusy || !manualPrice}>Set</button>
          </div>
        </div>
      </div>

      {/* Carrier + schedule */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Carrier</label>
            <select value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
              <option value="">— Select carrier —</option>
              {(carriers || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name} {c.scac ? `(${c.scac})` : ""}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">EIA FSC status</label>
            <div style={{ paddingTop: 8 }}>
              {!carrier ? <span className="text-muted">—</span> : carrier.eia_fsc_enabled ? (
                <span className="badge badge-green">✅ ENABLED — rating uses this schedule</span>
              ) : (
                <span className="badge badge-red">
                  ☐ DISABLED — enable “EIA Fuel Surcharge” on the <Link to="/carriers">Carriers</Link> page
                </span>
              )}
            </div>
          </div>
        </div>

        {carrierId && (
          <>
            <div className="flex items-center gap-2" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <input
                ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv"
                onChange={onFileChosen} style={{ display: "none" }} id="fsc-file-input"
              />
              <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
                📤 Upload Schedule (Excel)
              </button>
              {parsed && (
                <>
                  <span className="text-sm">
                    <strong>{parsed.fileName}</strong> — {parsed.brackets.length} brackets from “{parsed.sheetName}”
                    {parsed.skipped ? `, ${parsed.skipped} note rows skipped` : ""}{parsed.converted ? ", fractions → %" : ""}
                  </span>
                  <button className="btn btn-green" onClick={saveSchedule} disabled={busy}>
                    {busy ? "Saving..." : `💾 Save ${parsed.brackets.length} Brackets`}
                  </button>
                  <button className="btn" onClick={() => setParsed(null)} disabled={busy}>Discard</button>
                </>
              )}
              {!parsed && brackets.length > 0 && (
                <button className="btn btn-red" onClick={removeSchedule} disabled={busy}>🗑️ Delete Schedule</button>
              )}
            </div>
            <div className="text-xs text-muted" style={{ marginTop: 6 }}>
              Expected format: a sheet with “PPG ($/gal)” and “FSC %” columns (e.g. CHR_Fuel_Surcharge_Lookup.xlsx). The bracket with the largest price ≤ the current EIA diesel price applies. Saving replaces the carrier's existing schedule.
            </div>
          </>
        )}
      </div>

      {/* Calculator + bracket table */}
      {carrierId && (
        <div className="flex gap-3" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="card" style={{ flex: "0 0 320px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 1, marginBottom: 8 }}>FSC CALCULATOR{parsed ? " (PREVIEWING UPLOAD)" : ""}</div>
            <div className="form-group">
              <label className="form-label">Net linehaul ($)</label>
              <input type="number" value={linehaul} onChange={(e) => setLinehaul(e.target.value)} />
            </div>
            <table className="grid" style={{ marginTop: 8 }}>
              <tbody>
                <tr><td>EIA diesel price</td><td className="mono">{eia?.price != null ? `$${Number(eia.price).toFixed(3)}/gal` : "—"}</td></tr>
                <tr><td>Matched bracket</td><td className="mono">{appliedBracket != null ? `≥ $${Number(appliedBracket).toFixed(2)}` : "—"}</td></tr>
                <tr><td>Fuel surcharge %</td><td className="mono fw-700">{currentPct != null ? `${currentPct}%` : "—"}</td></tr>
                <tr><td>Fuel surcharge $</td><td className="mono fw-700">{fscAmount != null ? `$${fscAmount.toFixed(2)}` : "—"}</td></tr>
                <tr><td>Linehaul + FSC</td><td className="mono">{fscAmount != null ? `$${(linehaulNum + fscAmount).toFixed(2)}` : "—"}</td></tr>
              </tbody>
            </table>
            {currentPct == null && activeBrackets.length > 0 && eia?.price != null && (
              <div className="text-xs text-muted" style={{ marginTop: 6 }}>No bracket ≤ ${Number(eia.price).toFixed(3)} — rating falls back to the static rate FSC.</div>
            )}
          </div>

          <div className="card" style={{ flex: 1, minWidth: 320 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", letterSpacing: 1, marginBottom: 8 }}>
              {parsed ? "UPLOAD PREVIEW" : "CURRENT SCHEDULE"} — {activeBrackets.length} BRACKETS
            </div>
            {loadingSchedule ? (
              <div className="text-muted">Loading schedule…</div>
            ) : activeBrackets.length === 0 ? (
              <div className="empty-state">No schedule uploaded for this carrier yet</div>
            ) : (
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <table className="grid">
                  <thead>
                    <tr><th>Diesel price ≥ ($/gal)</th><th>FSC %</th></tr>
                  </thead>
                  <tbody>
                    {activeBrackets.map((b, i) => {
                      const isApplied = appliedBracket != null && parseFloat(b.min_price) === appliedBracket;
                      return (
                        <tr key={i} style={isApplied ? { background: "rgba(245,158,11,0.12)" } : undefined}>
                          <td className="mono">${Number(b.min_price).toFixed(2)}{isApplied ? "  ← current" : ""}</td>
                          <td className="mono">{Number(b.fsc_pct).toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
