/**
 * Generic row-selection hook.
 *
 * Owns: a Set<string|number> of selected row keys plus toggle helpers.
 * Pure UI state — no API, no business knowledge — so any list page can
 * share the same selection contract.
 *
 * Usage:
 *   const sel = useRowSelection();           // default key = row.id
 *   sel.has(row.id);                         // is selected?
 *   sel.toggle(row.id);                      // flip one
 *   sel.toggleAll(visibleRows);              // header checkbox
 *   sel.clear();                             // reset
 *   sel.size                                 // selected count
 *   sel.selectedRows(visibleRows)            // visible ∩ selected
 */

import { useCallback, useMemo, useState } from "react";

const defaultGetKey = (row) => row?.id;

export function useRowSelection({ getKey = defaultGetKey } = {}) {
  const [selected, setSelected] = useState(() => new Set());

  const has = useCallback((key) => selected.has(key), [selected]);

  const toggle = useCallback((key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const setMany = useCallback((keys, on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => { if (on) next.add(k); else next.delete(k); });
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const toggleAll = useCallback((rows) => {
    const keys = (rows || []).map(getKey).filter((k) => k !== undefined && k !== null);
    if (keys.length === 0) return;
    setSelected((prev) => {
      const allSelected = keys.every((k) => prev.has(k));
      const next = new Set(prev);
      keys.forEach((k) => { if (allSelected) next.delete(k); else next.add(k); });
      return next;
    });
  }, [getKey]);

  const allSelected = useCallback((rows) => {
    const keys = (rows || []).map(getKey).filter((k) => k !== undefined && k !== null);
    return keys.length > 0 && keys.every((k) => selected.has(k));
  }, [selected, getKey]);

  const someSelected = useCallback((rows) => {
    const keys = (rows || []).map(getKey).filter((k) => k !== undefined && k !== null);
    return keys.some((k) => selected.has(k)) && !keys.every((k) => selected.has(k));
  }, [selected, getKey]);

  const selectedRows = useCallback(
    (rows) => (rows || []).filter((r) => selected.has(getKey(r))),
    [selected, getKey]
  );

  return useMemo(() => ({
    selected,
    size: selected.size,
    has,
    toggle,
    setMany,
    clear,
    toggleAll,
    allSelected,
    someSelected,
    selectedRows,
  }), [selected, has, toggle, setMany, clear, toggleAll, allSelected, someSelected, selectedRows]);
}
