// ════════════════════════════════════════════════════════════════════
// useEditGate — page-level permission gate for module pages.
//
// QA #147 / #148 / #149:
//   The Execution and Finance pages (Dock Scheduling, Fleet Management,
//   Carrier Portal, Freight Audit, Carrier Bids, Freight Invoices) used
//   to mount their action buttons unconditionally. When a Planner or
//   Finance role had `view` access on the parent module the buttons
//   still fired their handlers — the server's canWriteTable would
//   reject the underlying write, but only after the user had clicked
//   and seen a misleading success-looking flow.
//
//   This hook centralises the matrix lookup so each page can collapse
//   its edit affordances with one call:
//
//     const gate = useEditGate('dock_scheduling');
//     <button {...gate.editProps()}>Save</button>
//     gate.requireEdit(() => doSave())   // no-op when canEdit === false
//
//   Pages should also wrap their save handlers in `gate.requireEdit`
//   so a misbehaving child component can't bypass the disabled prop.
//
// Rules (CLAUDE_RULES §4 / §6 — services-first, hooks own React glue):
//   - Wraps useFeatureAccess, never reads matrices directly.
//   - Returns plain props/objects; no JSX. UI styling is the page's job.
// ════════════════════════════════════════════════════════════════════

import { useCallback, useMemo } from "react";
import { useFeatureAccess } from "./useFeatureAccess";

const VIEW_TITLE = "Read-only — your role does not have edit access for this module.";

/**
 * @param {string} featureKey  — module feature_key (e.g. 'dock_scheduling').
 * @returns {{
 *   level: 'edit'|'view'|'none',
 *   canEdit: boolean,
 *   canRead: boolean,
 *   isLoading: boolean,
 *   editProps: (extra?: object) => { disabled: boolean, title?: string },
 *   requireEdit: <T>(fn: () => T) => T | undefined,
 * }}
 */
export function useEditGate(featureKey) {
  const { level, canEdit, canRead, isLoading } = useFeatureAccess(featureKey);

  const editProps = useCallback((extra = {}) => {
    if (canEdit) return { ...extra };
    return {
      ...extra,
      disabled: true,
      title: extra.title || VIEW_TITLE,
      "aria-disabled": true,
    };
  }, [canEdit]);

  const requireEdit = useCallback((fn) => {
    if (!canEdit) return undefined;
    return typeof fn === "function" ? fn() : undefined;
  }, [canEdit]);

  return useMemo(
    () => ({ level, canEdit, canRead, isLoading, editProps, requireEdit }),
    [level, canEdit, canRead, isLoading, editProps, requireEdit],
  );
}

export default useEditGate;
