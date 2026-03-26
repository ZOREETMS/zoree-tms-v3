import { useMemo, useState } from "react";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * OrderLinesEditor
 * mode="view" — read-only display (for Details tab)
 * mode="edit" — editable with item master dropdown (for Edit tab)
 * items — array from item master [{id, desc, weightUnit, ...}]
 */
export default function OrderLinesEditor({ orderId, lines, onChange, onSave, onClear, busy, mode = "edit", items = [], showSaveButtons = true }) {
  const [localError, setLocalError] = useState("");

  const totals = useMemo(() => {
    const totalWeight = lines.reduce((sum, l) => sum + toNumber(l.total_weight || l.totalWt), 0);
    const totalPieces = lines.reduce((sum, l) => sum + toNumber(l.qty_ordered || l.qty), 0);
    return { totalWeight, totalPieces };
  }, [lines]);

  function selectItem(index, itemId) {
    const item = items.find((it) => it.id === itemId);
    const unitWt = parseFloat(item?.weight_unit || item?.weight_per_unit || item?.weightUnit || 0);
    const qty = toNumber(lines[index]?.qty_ordered || lines[index]?.qty, 1);
    const next = lines.map((line, i) =>
      i === index
        ? { ...line, item_id: itemId, description: item ? `${item.id} — ${(item.description || item.desc || "").slice(0, 30)}` : "", unit_weight: unitWt, total_weight: qty * unitWt }
        : line
    );
    onChange(next);
  }

  function updateQty(index, qty) {
    const unitWt = toNumber(lines[index]?.unit_weight || lines[index]?.unitWt);
    const next = lines.map((line, i) =>
      i === index ? { ...line, qty_ordered: qty, total_weight: qty * unitWt } : line
    );
    onChange(next);
  }

  function updateUnitWeight(index, unitWt) {
    const qty = toNumber(lines[index]?.qty_ordered || lines[index]?.qty, 1);
    const next = lines.map((line, i) =>
      i === index ? { ...line, unit_weight: unitWt, total_weight: qty * unitWt } : line
    );
    onChange(next);
  }

  function addLine() {
    onChange([
      ...lines,
      { line_num: lines.length + 1, item_id: "", description: "", qty_ordered: 1, unit_weight: 0, total_weight: 0 },
    ]);
  }

  function removeLine(index) {
    const next = lines.filter((_, i) => i !== index).map((line, i) => ({ ...line, line_num: i + 1 }));
    onChange(next);
  }

  async function save() {
    setLocalError("");
    try { await onSave(); } catch (e) { setLocalError(e.message || "Failed to save lines"); }
  }

  const selectStyle = { width: "100%", padding: "6px 8px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box", background: "#fff" };
  const inputStyle = { width: "100%", padding: "6px 8px", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box" };
  const thStyle = { fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.5, padding: "7px 8px", textAlign: "left", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const tdStyle = { padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 12 };

  /* ── VIEW MODE ── */
  if (mode === "view") {
    if (!lines || lines.length === 0) {
      return <div style={{ fontSize: 12, color: "var(--text3)", fontStyle: "italic", padding: "4px 0" }}>No line items</div>;
    }
    return (
      <div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Qty</th>
              <th style={thStyle}>Unit Wt</th>
              <th style={thStyle}>Total Wt</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => {
              const itemInfo = items.find((it) => it.id === (line.item_id || line.itemId));
              const desc = line.description || (itemInfo ? `${itemInfo.id} — ${(itemInfo.description || itemInfo.desc || "").slice(0, 30)}` : line.item_id || "—");
              return (
                <tr key={i}>
                  <td style={tdStyle}>{line.line_num || i + 1}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{desc}</td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono',monospace" }}>{line.qty_ordered ?? line.qty ?? 0}</td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono',monospace" }}>{line.unit_weight ?? line.unitWt ?? 0}</td>
                  <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: "var(--accent)" }}>{toNumber(line.total_weight || line.totalWt)} lbs</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 16, padding: "8px 0", fontSize: 12 }}>
          <span><strong>Pieces:</strong> {totals.totalPieces}</span>
          <span><strong>Total Weight:</strong> {totals.totalWeight}</span>
        </div>
      </div>
    );
  }

  /* ── EDIT MODE ── */
  const colHeaderStyle = { fontSize: 10, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.5 };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      {/* Header with blue Add Item button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#f0f4ff", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#1e2d6b", textTransform: "uppercase", letterSpacing: 1 }}>📦 Line Items</div>
        <button onClick={addLine} disabled={busy} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 4px rgba(59,130,246,.3)" }}>+ Add Item</button>
      </div>
      {/* Column headers */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 28px", gap: 8, padding: "6px 14px", background: "#f8faff", borderBottom: "1px solid var(--border)" }}>
        <div style={colHeaderStyle}>Item</div>
        <div style={colHeaderStyle}>Qty</div>
        <div style={colHeaderStyle}>Unit Wt</div>
        <div style={colHeaderStyle}>Total Wt</div>
        <div></div>
      </div>
      <div style={{ minHeight: 48, padding: "0 14px" }}>
        {localError && <div style={{ color: "var(--red)", fontSize: 12, padding: "8px 0" }}>{localError}</div>}
        {lines.length === 0 ? (
          <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text3)", fontSize: 12 }}>No items added — click <strong>+ Add Item</strong></div>
        ) : (
          <>
            {lines.map((line, index) => {
              const qty = toNumber(line.qty_ordered || line.qty, 1);
              const unitWt = toNumber(line.unit_weight || line.unitWt);
              const totalWt = toNumber(line.total_weight || line.totalWt);
              const currentItemId = line.item_id || line.itemId || "";
              return (
                <div key={`${orderId}-${index}`} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 28px", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <select value={currentItemId} onChange={(e) => selectItem(index, e.target.value)} style={selectStyle}>
                    <option value="">— Select Item —</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>{it.id} — {(it.description || it.desc || "").slice(0, 22)}</option>
                    ))}
                  </select>
                  <input type="number" value={qty} min={1} onChange={(e) => updateQty(index, Number(e.target.value || 0))} style={inputStyle} />
                  <input type="number" value={unitWt} readOnly style={{ ...inputStyle, background: "#f8faff", color: "var(--text3)" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>{totalWt > 0 ? `${totalWt} lbs` : "— lbs"}</span>
                  <button onClick={() => removeLine(index)} disabled={busy} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 16, padding: "2px 6px" }}>✕</button>
                </div>
              );
            })}
            {showSaveButtons && (
              <div style={{ display: "flex", gap: 16, padding: "8px 0", fontSize: 12, alignItems: "center" }}>
                <span><strong>Pieces:</strong> {totals.totalPieces}</span>
                <span><strong>Total Weight:</strong> {totals.totalWeight}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button onClick={save} disabled={busy} className="btn btn-primary btn-sm" style={{ fontSize: 11 }}>{busy ? "Saving..." : "💾 Save Lines"}</button>
                  <button onClick={onClear} disabled={busy} className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}>Clear Lines</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
