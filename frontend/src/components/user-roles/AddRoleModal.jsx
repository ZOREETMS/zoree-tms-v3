// ════════════════════════════════════════════════════════════════════
// AddRoleModal — collect the fields needed to create a new role.
// Calls back via onCreate({ roleKey, displayName, description, defaultLevel }).
// ════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";

const LEVELS = [
  { key: "view", label: "View only (Recommended)" },
  { key: "edit", label: "Edit" },
  { key: "none", label: "No access" },
];

const RESERVED_KEYS = new Set(["admin", "planner", "finance", "viewer"]);

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "r$1");
}

function isValidRoleKey(key) {
  return /^[a-z][a-z0-9_]*$/.test(key);
}

export default function AddRoleModal({
  open,
  busy = false,
  errorText = "",
  existingRoleKeys = [],
  onClose,
  onCreate,
}) {
  const [displayName, setDisplayName] = useState("");
  const [roleKey, setRoleKey] = useState("");
  const [description, setDescription] = useState("");
  const [defaultLevel, setDefaultLevel] = useState("view");
  const [touchedKey, setTouchedKey] = useState(false);
  const [localError, setLocalError] = useState("");

  // Reset form whenever the modal opens.
  useEffect(() => {
    if (open) {
      setDisplayName("");
      setRoleKey("");
      setDescription("");
      setDefaultLevel("view");
      setTouchedKey(false);
      setLocalError("");
    }
  }, [open]);

  // Auto-derive the role key from the display name until the user edits it.
  useEffect(() => {
    if (!touchedKey) setRoleKey(slugify(displayName));
  }, [displayName, touchedKey]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    setLocalError("");

    const finalKey = slugify(roleKey || displayName);
    if (!finalKey) {
      setLocalError("Role key is required");
      return;
    }
    if (!isValidRoleKey(finalKey)) {
      setLocalError("Role key must start with a letter and use only lowercase letters, digits, or underscores");
      return;
    }
    if (RESERVED_KEYS.has(finalKey)) {
      setLocalError(`'${finalKey}' is a system role and is reserved`);
      return;
    }
    if (existingRoleKeys.map((k) => k.toLowerCase()).includes(finalKey)) {
      setLocalError(`Role '${finalKey}' already exists`);
      return;
    }

    onCreate?.({
      roleKey: finalKey,
      displayName: displayName.trim() || finalKey,
      description: description.trim() || null,
      defaultLevel,
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Add Role">
      <div className="modal-card" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div className="modal-title">Add Role</div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: "grid", gap: 14 }}>
            {(localError || errorText) && (
              <div className="alert alert-danger">
                <div className="alert-icon">⛔</div>
                <div className="alert-text">{localError || errorText}</div>
              </div>
            )}

            <label className="form-field">
              <span className="form-label">Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Operations Manager"
                disabled={busy}
                autoFocus
                required
              />
            </label>

            <label className="form-field">
              <span className="form-label">Role key</span>
              <input
                type="text"
                value={roleKey}
                onChange={(e) => { setRoleKey(slugify(e.target.value)); setTouchedKey(true); }}
                placeholder="auto-generated from display name"
                disabled={busy}
                pattern="[a-z][a-z0-9_]*"
              />
              <span className="form-help">
                Lowercase letters, digits or underscores; starts with a letter. Used internally and on API URLs.
              </span>
            </label>

            <label className="form-field">
              <span className="form-label">Description (optional)</span>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={busy}
              />
            </label>

            <label className="form-field">
              <span className="form-label">Default access for new modules</span>
              <select
                value={defaultLevel}
                onChange={(e) => setDefaultLevel(e.target.value)}
                disabled={busy}
              >
                {LEVELS.map((l) => (
                  <option key={l.key} value={l.key}>{l.label}</option>
                ))}
              </select>
              <span className="form-help">
                You'll fine-tune Edit / View / No View per module after the role is created.
              </span>
            </label>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Creating…" : "Create role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
