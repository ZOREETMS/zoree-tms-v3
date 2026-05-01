/**
 * Shared Export-to-Excel button.
 * Pages pass `entity` + `rows` (the filtered/sorted view); the service
 * resolves columns + filename. UI never imports xlsx directly.
 *
 * Usage:
 *   <ExportButton entity="orders" rows={visibleOrders} />
 *   <ExportButton entity="shipments" rows={visibleShipments} disabled={loading} />
 */

import { useCallback, useState } from "react";
import { exportEntityToExcel } from "../../services/exportService";

export default function ExportButton({
  entity,
  rows,
  label = "Export",
  className = "btn btn-secondary btn-sm",
  disabled = false,
  onError,
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = useCallback(() => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      exportEntityToExcel(entity, rows || []);
    } catch (err) {
      if (typeof onError === "function") onError(err);
      else console.error("[ExportButton] export failed:", err);
    } finally {
      setBusy(false);
    }
  }, [entity, rows, disabled, busy, onError]);

  const count = Array.isArray(rows) ? rows.length : 0;
  const isDisabled = disabled || busy || count === 0;

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={isDisabled}
      title={count === 0 ? "No rows to export" : `Export ${count} row${count === 1 ? "" : "s"} to Excel`}
    >
      {busy ? "Exporting…" : `📥 ${label} (${count})`}
    </button>
  );
}
