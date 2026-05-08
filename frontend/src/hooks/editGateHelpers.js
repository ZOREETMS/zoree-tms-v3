// ════════════════════════════════════════════════════════════════════
// editGateHelpers — pure helpers behind useEditGate.
//
// QA #147 / #148 / #149: extracting the prop-bag and short-circuit
// logic from the React hook lets us unit-test it without spinning up
// React or react-dom. The hook in useEditGate.js stays a thin wrapper
// that memoises these.
//
// Rules (CLAUDE_RULES §4): pure data, no React imports, no side effects.
// ════════════════════════════════════════════════════════════════════

const VIEW_TITLE = "Read-only — your role does not have edit access for this module.";

/**
 * Build the {disabled, title, aria-disabled} prop bag that gates edit
 * affordances. When canEdit is true, returns `extra` unchanged. When
 * false, forces disabled + a tooltip explaining why.
 *
 * @param {boolean} canEdit
 * @param {object} [extra]
 * @returns {object}
 */
export function buildEditProps(canEdit, extra = {}) {
  if (canEdit) return { ...extra };
  return {
    ...extra,
    disabled: true,
    title: extra.title || VIEW_TITLE,
    "aria-disabled": true,
  };
}

/**
 * Run `fn` only when canEdit is true. Returns whatever fn() returns,
 * or undefined when blocked. Treats non-functions as no-ops so callers
 * can guard side-effecting paths without a manual check.
 *
 * @template T
 * @param {boolean} canEdit
 * @param {() => T} fn
 * @returns {T | undefined}
 */
export function runIfCanEdit(canEdit, fn) {
  if (!canEdit) return undefined;
  return typeof fn === "function" ? fn() : undefined;
}

export const VIEW_TITLE_TEXT = VIEW_TITLE;
