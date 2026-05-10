// ════════════════════════════════════════════════════════════════════
// PermissionsView — the default detail view. Shows the permissions of
// the *currently selected role only*, grouped by feature `module`,
// with a segmented Hide/View/Edit pill per module. Per-group counts
// give a one-glance summary; sections are collapsible.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import ModuleIcon from "./ModuleIcon";
import PermissionToggle from "./PermissionToggle";
import Pill from "./Pill";

export default function PermissionsView({
  sections = [],         // [{ name, items: feature[] }]
  roleKey,               // currently active role
  isLocked = false,
  canEdit = true,
  levelFor,              // (roleKey, featureKey) => 'edit' | 'view' | 'none'
  isPendingCell,         // (roleKey, featureKey) => bool
  onLevelChange,         // (roleKey, featureKey, nextLevel)
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());

  function toggle(name) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const summaries = useMemo(() => {
    const out = {};
    for (const s of sections) {
      let edit = 0, view = 0, none = 0;
      for (const f of s.items) {
        const v = levelFor?.(roleKey, f.feature_key) || "none";
        if (v === "edit") edit++;
        else if (v === "view") view++;
        else none++;
      }
      out[s.name] = { edit, view, none };
    }
    return out;
  }, [sections, roleKey, levelFor]);

  if (!roleKey) return null;
  if (sections.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--acc-muted)", fontSize: 13 }}>
        No modules to show.
      </div>
    );
  }

  const disabled = isLocked || !canEdit;

  return (
    <div className="acc-perm-body">
      {sections.map((section) => {
        const isCol = collapsed.has(section.name);
        const sum   = summaries[section.name] || { edit: 0, view: 0, none: 0 };
        return (
          <div key={section.name} className={`acc-pgroup${isCol ? " collapsed" : ""}`}>
            <button
              type="button"
              className="acc-pgroup-head"
              onClick={() => toggle(section.name)}
              aria-expanded={!isCol}
            >
              <svg
                className="chev" width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
              <span className="gname">{section.name}</span>
              <span className="gcount">· {section.items.length} module{section.items.length === 1 ? "" : "s"}</span>
              <span className="ginfo">
                {sum.edit > 0 && <Pill variant="edit" count={sum.edit} />}
                {sum.view > 0 && <Pill variant="view" count={sum.view} />}
                {sum.none > 0 && <Pill variant="hide" count={sum.none} />}
              </span>
            </button>

            <div className="acc-pgroup-body">
              {section.items.map((f) => {
                const level = levelFor?.(roleKey, f.feature_key) || "none";
                const dirty = isPendingCell?.(roleKey, f.feature_key);
                return (
                  <div
                    key={f.feature_key}
                    className={`acc-prow${dirty ? " dirty" : ""}`}
                  >
                    <div className="acc-pmod">
                      <ModuleIcon featureKey={f.feature_key} section={section.name} />
                      <div style={{ minWidth: 0 }}>
                        <div className="acc-mod-name">{f.label || f.feature_key}</div>
                        <span className="acc-mod-key">{f.feature_key.toUpperCase()}</span>
                      </div>
                    </div>
                    <PermissionToggle
                      value={level}
                      disabled={disabled}
                      onChange={(v) => onLevelChange?.(roleKey, f.feature_key, v)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
