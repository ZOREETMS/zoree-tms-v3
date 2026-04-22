/**
 * ConfirmDialog — small, reusable confirm modal.
 *
 * Replaces ad-hoc window.confirm() calls. Controlled component: caller
 * owns `open` and the yes/no handlers. Keep this dumb (no data fetching,
 * no toasts) — those are the caller's concern (CLAUDE_RULES §2, §3).
 *
 * Props
 *   open          boolean           — show/hide
 *   title         string            — short heading
 *   message       string | node     — body text
 *   confirmLabel  string            — default "Confirm"
 *   cancelLabel   string            — default "Cancel"
 *   tone          "default"|"danger" — styles confirm button
 *   busy          boolean           — disables buttons during async work
 *   onConfirm     () => void
 *   onCancel      () => void
 */
export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  message = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  const isDanger = tone === "danger";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "20px 22px",
          width: "min(440px, 92vw)",
          boxShadow: "0 20px 40px rgba(15,23,42,0.25)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          id="confirm-dialog-title"
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: isDanger ? "#b91c1c" : "var(--text1)",
            marginBottom: 8,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, marginBottom: 18 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onConfirm}
            disabled={busy}
            style={
              isDanger
                ? {
                    background: "#dc2626",
                    color: "#fff",
                    borderColor: "#b91c1c",
                  }
                : undefined
            }
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
