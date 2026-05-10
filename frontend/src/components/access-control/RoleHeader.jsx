// ════════════════════════════════════════════════════════════════════
// RoleHeader — hero section above the active role's permissions.
// Shows the role name + tag, an inline-editable description (read-only
// for system roles), and live counts of Edit / View / Hidden modules.
// Description editing is local-only here — the orchestrator owns
// persistence and is free to wire it up later when the API exists.
// ════════════════════════════════════════════════════════════════════

import Pill from "./Pill";

function initials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "—";
}

function colorClass(roleKey) {
  if (roleKey === "admin") return "c1";
  const palette = ["c2", "c3", "c4", "c5"];
  let h = 0;
  for (let i = 0; i < (roleKey || "").length; i++) h = (h * 31 + roleKey.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function RoleHeader({
  roleKey,
  displayName,
  description = "",
  isSystem = false,
  isLocked = false,
  userCount,
  counts = { edit: 0, view: 0, none: 0 },
  onDescriptionChange,
  onDelete,
  canManage = false,
}) {
  if (!roleKey) return null;
  const tagText = isLocked ? "LOCKED" : (isSystem ? "SYSTEM" : "CUSTOM");
  const tagCls  = isLocked ? "locked" : (isSystem ? "" : "custom");

  return (
    <div className="acc-detail-head">
      <span className={`acc-role-hero ${colorClass(roleKey)}`}>
        {initials(displayName)}
      </span>

      <div className="acc-role-id">
        <div className="name">
          <h2>{displayName}</h2>
          <span className={`acc-tag-mini ${tagCls}`}>{tagText}</span>
        </div>
        <div className="desc">
          <input
            value={description || ""}
            placeholder={isLocked ? "" : "Add a short description for this role…"}
            disabled={isLocked || !canManage}
            onChange={(e) => onDescriptionChange?.(e.target.value)}
          />
        </div>
      </div>

      <div className="acc-head-pills">
        {userCount != null && (
          <Pill variant="assigned">
            <strong>{userCount}</strong>&nbsp;{userCount === 1 ? "user" : "users"}
          </Pill>
        )}
        <Pill variant="edit"><strong>{counts.edit}</strong>&nbsp;Edit</Pill>
        <Pill variant="view"><strong>{counts.view}</strong>&nbsp;View</Pill>
        <Pill variant="hide"><strong>{counts.none}</strong>&nbsp;Hidden</Pill>

        {canManage && !isSystem && !isLocked && onDelete && (
          <button
            type="button"
            className="acc-btn danger"
            onClick={onDelete}
            title={`Delete ${displayName}`}
            style={{ marginLeft: 4 }}
          >
            Delete role
          </button>
        )}
      </div>
    </div>
  );
}
