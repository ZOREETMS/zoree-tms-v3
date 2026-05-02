/**
 * Reusable selection checkbox cells.
 *
 *   <SelectionHeaderCheckbox sel={sel} rows={visibleRows} />
 *   <SelectionRowCheckbox    sel={sel} rowKey={row.id} />
 *
 * `sel` is the object returned from useRowSelection().
 * Stops click propagation so checking a row doesn't open its detail.
 */

import { useEffect, useRef } from "react";

export function SelectionHeaderCheckbox({ sel, rows, ariaLabel = "Select all" }) {
  const ref = useRef(null);
  const all = sel.allSelected(rows);
  const some = sel.someSelected(rows);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !all && some;
  }, [all, some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={all}
      onChange={() => sel.toggleAll(rows)}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
    />
  );
}

export function SelectionRowCheckbox({ sel, rowKey, ariaLabel = "Select row" }) {
  return (
    <input
      type="checkbox"
      checked={sel.has(rowKey)}
      onChange={() => sel.toggle(rowKey)}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel}
    />
  );
}
