/**
 * Bulk-action bar shown above a list when rows are selected.
 *
 *   <SelectionBar
 *     count={sel.size}
 *     entityLabel="Shipment"
 *     onClear={sel.clear}
 *     extras={<button>Bulk action</button>}
 *   />
 *
 * Mirrors the visual style of OrdersPage's existing selection bar so all
 * pages feel the same. Hides itself when count is 0.
 */

export default function SelectionBar({ count, entityLabel = "Row", onClear, extras = null }) {
  if (!count) return null;
  const noun = `${entityLabel}${count === 1 ? "" : "s"}`;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 16px",
        marginBottom: 12,
        background: "linear-gradient(90deg, rgba(79,70,229,1) 0%, rgba(99,102,241,1) 100%)",
        color: "#fff",
        borderRadius: 8,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontWeight: 800, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {count.toLocaleString()} {noun} Selected
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {extras}
        {onClear && (
          <button
            onClick={onClear}
            style={{
              padding: "5px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,.4)",
              background: "rgba(255,255,255,.15)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ✕ Clear
          </button>
        )}
      </div>
    </div>
  );
}
