// ════════════════════════════════════════════════════════════════════
// HeatmapView — compact dot grid (Module × Role). Click any module row
// to expand a per-role permission editor inline. Useful when you need
// to scan how a single module is exposed across every role at once.
// ════════════════════════════════════════════════════════════════════

import { useState } from "react";
import ModuleIcon from "./ModuleIcon";
import PermissionToggle from "./PermissionToggle";

const LABEL = { edit: "Edit", view: "View", none: "Hidden" };

export default function HeatmapView({
  sections = [],
  roleKeys = [],
  displayName,
  isLocked,
  canEdit = true,
  levelFor,
  onLevelChange,
}) {
  const [openMod, setOpenMod] = useState(null);

  if (sections.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--acc-muted)", fontSize: 13 }}>
        No modules to show.
      </div>
    );
  }

  return (
    <div className="acc-heat">
      <div
        className="acc-heat-grid"
        style={{ "--acc-rolecount": roleKeys.length }}
      >
        <div className="acc-heat-head">
          <div>Module</div>
          {roleKeys.map((k) => <div key={k}>{displayName(k)}</div>)}
        </div>

        {sections.map((section) => (
          <FragmentRows
            key={section.name}
            section={section}
            roleKeys={roleKeys}
            displayName={displayName}
            isLocked={isLocked}
            canEdit={canEdit}
            openMod={openMod}
            setOpenMod={setOpenMod}
            levelFor={levelFor}
            onLevelChange={onLevelChange}
          />
        ))}
      </div>

      <div className="acc-legend">
        <span className="item"><span className="acc-heat-dot edit" style={{ width: 10, height: 10 }} /> Edit</span>
        <span className="item"><span className="acc-heat-dot view" style={{ width: 10, height: 10 }} /> View</span>
        <span className="item"><span className="acc-heat-dot none" style={{ width: 10, height: 10 }} /> Hidden</span>
        <span style={{ marginLeft: "auto", color: "var(--acc-muted)" }}>
          Click any module row to edit per-role permissions.
        </span>
      </div>
    </div>
  );
}

function FragmentRows({
  section, roleKeys, displayName, isLocked, canEdit,
  openMod, setOpenMod, levelFor, onLevelChange,
}) {
  return (
    <>
      <div className="acc-heat-grouprow">
        <div>{section.name}</div>
        {roleKeys.map((k) => <div key={k} />)}
      </div>

      {section.items.map((f) => {
        const isOpen = openMod === f.feature_key;
        return (
          <RowAndDetail
            key={f.feature_key}
            section={section}
            feature={f}
            roleKeys={roleKeys}
            displayName={displayName}
            isLocked={isLocked}
            canEdit={canEdit}
            isOpen={isOpen}
            onToggle={() => setOpenMod(isOpen ? null : f.feature_key)}
            levelFor={levelFor}
            onLevelChange={onLevelChange}
          />
        );
      })}
    </>
  );
}

function RowAndDetail({
  section, feature, roleKeys, displayName,
  isLocked, canEdit, isOpen, onToggle,
  levelFor, onLevelChange,
}) {
  return (
    <>
      <div
        className="acc-heat-row"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      >
        <div>
          <ModuleIcon featureKey={feature.feature_key} section={section.name} size={28} glyphSize={16} />
          <div>
            <div className="acc-mod-name">{feature.label || feature.feature_key}</div>
            <span className="acc-mod-key">{feature.feature_key.toUpperCase()}</span>
          </div>
        </div>
        {roleKeys.map((rk) => {
          const v = levelFor?.(rk, feature.feature_key) || "none";
          return (
            <div key={rk}>
              <div className="acc-heat-cell">
                <span className={`acc-heat-dot ${v}`} />
                <span className="lbl">{LABEL[v]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {isOpen && (
        <div className="acc-heat-detail">
          <h4>{feature.label || feature.feature_key} — per-role permission</h4>
          {roleKeys.map((rk) => {
            const v = levelFor?.(rk, feature.feature_key) || "none";
            const lock = isLocked?.(rk) || !canEdit;
            return (
              <div key={rk} className="role-line">
                <div>
                  <span className="nm">{displayName(rk)}</span>
                </div>
                <div />
                <div>
                  <PermissionToggle
                    value={v}
                    disabled={lock}
                    onChange={(next) => onLevelChange?.(rk, feature.feature_key, next)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
