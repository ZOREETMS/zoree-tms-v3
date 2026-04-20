// ─────────────────────────────────────────────────────────────────────────────
// <Toast> — reusable dismissible toast
//
// A small, single-purpose presentational component. It renders the banner and
// the close button; it does NOT own the timer or the message state. Timer +
// message state live in `useToast` (hooks/useToast.js) so the same component
// can be dropped into any page that already holds its own message state
// (OrdersPage, BulkPlanPage, ...).
//
// Props
//   text         string   required  — the message to display.
//   type         string             — "success" | "error" | "warning" | "info".
//                                     Default "info".
//   dismissible  bool               — show the close (×) button. Default true.
//   onClose      function           — invoked when the user clicks ×.
//
// REQ-27: Order-creation toasts pass dismissible=true so users can choose
// to close the 60-second success banner early.
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE = {
  success: { bg: "#dcfce7", fg: "#14532d", border: "#86efac" },
  error:   { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
  warning: { bg: "#fef9c3", fg: "#854d0e", border: "#fde047" },
  info:    { bg: "#dbeafe", fg: "#1e3a8a", border: "#93c5fd" },
};

function palette(type) {
  return PALETTE[type] || PALETTE.info;
}

export default function Toast({ text, type = "info", dismissible = true, onClose }) {
  if (!text) return null;
  const c = palette(type);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: "10px 16px",
        borderRadius: 10,
        marginBottom: 12,
        fontSize: 13,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
      }}
    >
      <span style={{ flex: 1 }}>{text}</span>
      {dismissible && (
        <button
          type="button"
          onClick={onClose}
          title="Dismiss"
          aria-label="Dismiss notification"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: "inherit",
            opacity: 0.6,
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
