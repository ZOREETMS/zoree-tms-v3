// "Unassign selected" and "Unplan all" for the Orders page.
// Orchestration lives in services/bulkUnplanService (REQ-02 audited path,
// empty-shipment cleanup); this hook owns only the UI state, the confirm
// prompts and the scheduler-log lines.
import { useCallback, useMemo, useState } from "react";
import {
  unplanAll, selectUnplannable, summarize, DOWNSTREAM_STATUSES,
} from "../services/bulkUnplanService";

const stamp = () => new Date().toLocaleTimeString();
const shipmentCountOf = (orders) =>
  new Set(orders.map((o) => o.shipment_id || o.shipmentId).filter(Boolean)).size;

/** Confirm text for "Unassign selected". Exported for tests. */
export function unassignConfirmText(targetCount, shipmentCount, skipped) {
  return `Unassign ${targetCount} order(s)?\n\n` +
    "They return to Unplanned" +
    (shipmentCount ? `; any of the ${shipmentCount} affected shipment(s) left with no orders is removed` : "") + ".\n" +
    "The orders themselves are not deleted." +
    (skipped ? `\n\n${skipped} selected order(s) are tendered or later and will be SKIPPED.` : "");
}

/** Confirm text for "Unplan all". Exported for tests. */
export function unplanAllConfirmText(targetCount, shipmentCount) {
  return `Unplan ${targetCount} order(s)?\n\n` +
    `They return to Unplanned and ${shipmentCount} shipment(s) will be removed once empty.\n` +
    "Tendered, accepted, shipped, in-transit and delivered orders are NOT touched.\n\n" +
    "This cannot be undone in one click — each order has to be re-planned.";
}

/**
 * @param {object} args
 * @param {object[]} args.orders
 * @param {object[]} args.shipments
 * @param {Set<string>} args.selectedOrders
 * @param {Function} args.refreshData
 * @param {Function} args.toast        (text, type) => void
 * @param {Function} args.log          (line) => void   scheduler log
 * @param {Function} args.clearSelection
 * @param {Function} [args.confirm]    injectable for tests; defaults to window.confirm
 */
export function useBulkUnplan({ orders, shipments, selectedOrders, refreshData, toast, log, clearSelection, confirm }) {
  const ask = confirm || ((msg) => window.confirm(msg)); // eslint-disable-line no-alert
  const [unassignBusy, setUnassignBusy] = useState(false);
  const [unplanBusy, setUnplanBusy] = useState(false);

  const isSelected = useCallback((o) => selectedOrders.has(o.id), [selectedOrders]);

  // Tendered and later are excluded — a committed carrier is a business event, not a UI undo.
  const unassignableSelected = useMemo(
    () => selectUnplannable(orders, { filter: isSelected }),
    [orders, isSelected]
  );
  const unplannableCount = useMemo(() => selectUnplannable(orders).length, [orders]);

  const run = useCallback(async ({ label, filter, every, setBusy, after }) => {
    setBusy(true);
    try {
      const result = await unplanAll(orders, shipments, {
        ...(filter ? { filter } : {}),
        onProgress: (done, total) => {
          if (done === total || done % every === 0) log(`[${stamp()}] ${label} ${done}/${total}...`);
        },
      });
      const line = summarize(result);
      log(`[${stamp()}] ↩ ${line}`);
      toast(line, result.failed.length ? "warning" : "success");
      if (result.failed.length) console.warn(`[${label}] failures:`, result.failed);
      if (after) after();
      await refreshData();
    } catch (err) {
      log(`[${stamp()}] ❌ ${label} failed: ${err.message}`);
      toast(`${label} failed: ${err.message}`, "error");
    } finally {
      setBusy(false);
    }
  }, [orders, shipments, refreshData, toast, log]);

  const runUnassignSelected = useCallback(async () => {
    const targets = unassignableSelected;
    if (!targets.length) {
      const downstream = orders.filter((o) => isSelected(o) && DOWNSTREAM_STATUSES.includes(o.status || "")).length;
      toast(downstream
        ? `All ${downstream} selected order(s) are tendered or later — withdraw the tender first.`
        : "Nothing to unassign — none of the selected orders are planned.", "warning");
      return;
    }
    const skipped = selectedOrders.size - targets.length;
    if (!ask(unassignConfirmText(targets.length, shipmentCountOf(targets), skipped))) return;
    log(`[${stamp()}] Unassigning ${targets.length} order(s)...`);
    await run({ label: "Unassign", filter: isSelected, every: 50, setBusy: setUnassignBusy, after: clearSelection });
  }, [unassignableSelected, orders, isSelected, selectedOrders, toast, log, run, clearSelection]); // eslint-disable-line react-hooks/exhaustive-deps

  const runUnplanAll = useCallback(async () => {
    const targets = selectUnplannable(orders);
    if (!targets.length) { toast("Nothing to unplan — no planned orders.", "info"); return; }
    if (!ask(unplanAllConfirmText(targets.length, shipmentCountOf(targets)))) return;
    log(`[${stamp()}] Unplanning ${targets.length} order(s)...`);
    await run({ label: "Unplan all", every: 25, setBusy: setUnplanBusy });
  }, [orders, toast, log, run]); // eslint-disable-line react-hooks/exhaustive-deps

  return { unassignableSelected, unplannableCount, unassignBusy, unplanBusy, runUnassignSelected, runUnplanAll };
}
