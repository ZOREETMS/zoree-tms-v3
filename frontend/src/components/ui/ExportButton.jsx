/**
 * Shared Export-to-Excel button.
 * Pages pass `entity` + `rows` (the filtered/sorted view); the service
 * resolves columns + filename. UI never imports xlsx directly.
 *
 * Selection behavior: if `selectedRows` is provided AND non-empty, the
 * button exports those instead of `rows` and labels itself "Export
 * Selected (N)". Otherwise it falls back to `rows` and the supplied
 * label. Pages without a selection model can omit `selectedRows`.
 *
 * Usage:
 *   <ExportButton entity="orders"    rows={visibleOrders}    selectedRows={selectedOrderRows} />
 *   <ExportButton entity="shipments" rows={visibleShipments} />
 */

import { useCallback, useState } from "react";
import { exportEntityToExcel } from "../../services/exportService";

export default function ExportButton({
  entity,
  rows,
  selectedRows,
  label = "Export",
  className = "btn btn-secondary btn-sm",
  disabled = false,
  onError,
}) {
  const [busy, setBusy] = useState(false);

  const hasSelection = Array.isArray(selectedRows) && selectedRows.length > 0;
  const effectiveRows = hasSelection ? selectedRows : (Array.isArray(rows) ? rows : []);
  const count = effectiveRows.length;
  const effectiveLabel = hasSelection ? "Export Selected" : label;

  const handleClick = useCallback(() => {
    if (busy || disabled || count === 0) return;
    setBusy(true);
    try {
      exportEntityToExcel(entity, effectiveRows);
    } catch (err) {
      if (typeof onError === "function") onError(err);
      else console.error("[ExportButton] export failed:", err);
    } finally {
      setBusy(false);
    }
  }, [entity, effectiveRows, count, disabled, busy, onError]);

  const isDisabled = disabled || busy || count === 0;

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={isDisabled}
      title={count === 0 ? "No rows to export" : `Export ${count} row${count === 1 ? "" : "s"} to Excel`}
    >
      {busy ? "Exporting…" : `📥 ${effectiveLabel} (${count})`}
    </button>
  );
}
