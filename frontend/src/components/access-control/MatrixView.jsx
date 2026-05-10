// ════════════════════════════════════════════════════════════════════
// MatrixView — the original power-admin matrix, modernized. Sticky
// first column + sticky header. Permission cells are segmented chips,
// not dropdowns. Group filter chips at the top let the admin focus on
// one section at a time.
// ════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import ModuleIcon from "./ModuleIcon";
import PermissionToggle from "./PermissionToggle";

export default function MatrixView({
  sections = [],
  roleKeys = [],
  displayName,
  isSystemRole,
  isLocked,
  canEdit = true,
  levelFor,
  isPendingCell,
  onLevelChange,
}) {
  const [filter, setFilter] = useState("all");

  const groups = useMemo(() => {
    const known = sections.map((s) => s.name);
    return ["all", ...known];
  }, [sections]);

  const visible = filter === "all" ? sections : sections.filter((s) => s.name === filter);

  if (sections.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--acc-muted)", fontSize: 13 }}>
        No modules to show.
      </div>
    );
  }

  return (
    <div className="acc-matrix-wrap">
      <div className="acc-matrix-toolbar">
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              className={`acc-chip-filter${filter === g ? " active" : ""}`}
              onClick={() => setFilter(g)}
            >
              {g === "all" ? "All groups" : g}
            </button>
          ))}
        </div>
        <div style={{ color: "var(--acc-muted)", fontSize: 12.5 }}>
          Power-admin view — edit any role · any module
        </div>
      </div>

      <div className="acc-matrix-scroll">
        <table className="acc-mx">
          <colgroup>
            <col className="col-mod" />
            {roleKeys.map((k) => <col key={k} className="col-role" />)}
          </colgroup>
          <thead>
            <tr>
              <th className="first-col">Module</th>
              {roleKeys.map((k) => {
                const sys = isSystemRole?.(k);
                const lock = isLocked?.(k);
                return (
                  <th key={k}>
                    {displayName(k)}
                    <span className="sub">
                      {lock ? "system · locked" : (sys ? "system" : "custom")}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((section) => (
              <SectionRows
                key={section.name}
                section={section}
                roleKeys={roleKeys}
                isLocked={isLocked}
                canEdit={canEdit}
                levelFor={levelFor}
                isPendingCell={isPendingCell}
                onLevelChange={onLevelChange}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="acc-legend">
        <span className="item"><span className="swatch edit" /> <strong style={{ color: "var(--acc-edit-ink)" }}>Edit</strong></span>
        <span className="item"><span className="swatch view" /> <strong style={{ color: "var(--acc-view-ink)" }}>View</strong></span>
        <span className="item"><span className="swatch none" /> <strong style={{ color: "var(--acc-hide-ink)" }}>Hidden</strong></span>
        <span style={{ marginLeft: "auto", color: "var(--acc-muted)" }}>Admin column is locked.</span>
      </div>
    </div>
  );
}

function SectionRows({
  section, roleKeys, isLocked, canEdit,
  levelFor, isPendingCell, onLevelChange,
}) {
  return (
    <>
      <tr className="grp-row">
        <td className="first-col" colSpan={roleKeys.length + 1}>
          {section.name}
          <span style={{ color: "var(--acc-muted)", fontWeight: 600, marginLeft: 6 }}>
            · {section.items.length}
          </span>
        </td>
      </tr>
      {section.items.map((f) => (
        <tr key={f.feature_key}>
          <td className="mod-cell">
            <div className="acc-pmod">
              <ModuleIcon featureKey={f.feature_key} section={section.name} />
              <div style={{ minWidth: 0 }}>
                <div className="acc-mod-name">{f.label || f.feature_key}</div>
                <span className="acc-mod-key">{f.feature_key.toUpperCase()}</span>
              </div>
            </div>
          </td>
          {roleKeys.map((rk) => {
            const lock  = isLocked?.(rk) || !canEdit;
            const level = levelFor?.(rk, f.feature_key) || "none";
            const dirty = isPendingCell?.(rk, f.feature_key);
            return (
              <td key={rk} className={dirty ? "dirty" : undefined}>
                <PermissionToggle
                  value={level}
                  disabled={lock}
                  onChange={(v) => onLevelChange?.(rk, f.feature_key, v)}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
