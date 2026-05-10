// ════════════════════════════════════════════════════════════════════
// SaveBar — fixed-position dark pill at the bottom of the viewport.
// Stays hidden when there's nothing to save, slides in when the
// orchestrator reports any pending edits.
// ════════════════════════════════════════════════════════════════════

export default function SaveBar({
  pendingCount = 0,
  saving = false,
  disabled = false,
  onDiscard,
  onSave,
}) {
  const hidden = pendingCount === 0;
  const label = pendingCount === 1 ? "1 unsaved change" : `${pendingCount} unsaved changes`;
  return (
    <div className={`acc-savebar${hidden ? " hidden" : ""}`} role="region" aria-label="Unsaved changes">
      <div className="count">
        <span className="dot" />
        <span>{label}</span>
      </div>
      <div className="actions">
        <button
          type="button"
          className="acc-btn"
          onClick={onDiscard}
          disabled={saving}
        >
          Discard
        </button>
        <button
          type="button"
          className="acc-btn primary"
          onClick={onSave}
          disabled={saving || disabled}
          title={disabled ? "Admin role required" : ""}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
