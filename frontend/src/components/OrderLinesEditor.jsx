import { useMemo, useState } from "react";

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export default function OrderLinesEditor({ orderId, lines, onChange, onSave, onClear, busy }) {
  const [localError, setLocalError] = useState("");

  const totals = useMemo(() => {
    const totalWeight = lines.reduce((sum, l) => sum + toNumber(l.total_weight || l.totalWt), 0);
    const totalPieces = lines.reduce((sum, l) => sum + toNumber(l.qty_ordered || l.qty), 0);
    return { totalWeight, totalPieces };
  }, [lines]);

  function updateLine(index, key, value) {
    const next = lines.map((line, i) => (i === index ? { ...line, [key]: value } : line));
    onChange(next);
  }

  function addLine() {
    onChange([
      ...lines,
      { line_num: lines.length + 1, description: "", qty_ordered: 1, unit_weight: 0, total_weight: 0 },
    ]);
  }

  function removeLine(index) {
    const next = lines.filter((_, i) => i !== index).map((line, i) => ({ ...line, line_num: i + 1 }));
    onChange(next);
  }

  async function save() {
    setLocalError("");
    try {
      await onSave();
    } catch (e) {
      setLocalError(e.message || "Failed to save lines");
    }
  }

  return (
    <div className="card">
      <h3>Order Detail: {orderId}</h3>
      <div className="row gap">
        <button onClick={addLine} disabled={busy}>
          Add Line
        </button>
        <button onClick={save} disabled={busy}>
          {busy ? "Saving..." : "Save Lines"}
        </button>
        <button onClick={onClear} disabled={busy}>
          Clear Lines
        </button>
      </div>
      {localError ? <div className="error">{localError}</div> : null}
      <table className="grid">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit Wt</th>
            <th>Total Wt</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={`${orderId}-${index}`}>
              <td>{line.line_num || index + 1}</td>
              <td>
                <input
                  value={line.description || ""}
                  onChange={(e) => updateLine(index, "description", e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  value={line.qty_ordered ?? line.qty ?? 0}
                  onChange={(e) => updateLine(index, "qty_ordered", Number(e.target.value || 0))}
                />
              </td>
              <td>
                <input
                  type="number"
                  value={line.unit_weight ?? line.unitWt ?? 0}
                  onChange={(e) => updateLine(index, "unit_weight", Number(e.target.value || 0))}
                />
              </td>
              <td>
                <input
                  type="number"
                  value={line.total_weight ?? line.totalWt ?? 0}
                  onChange={(e) => updateLine(index, "total_weight", Number(e.target.value || 0))}
                />
              </td>
              <td>
                <button onClick={() => removeLine(index)} disabled={busy}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row gap">
        <strong>Pieces:</strong> {totals.totalPieces}
        <strong>Total Weight:</strong> {totals.totalWeight}
      </div>
    </div>
  );
}
