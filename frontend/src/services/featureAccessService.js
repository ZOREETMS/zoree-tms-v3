// ════════════════════════════════════════════════════════════════════
// featureAccessService — frontend mirror of api/services/rolePermissions.js
//
// Purpose:
//   Pure helpers that resolve a user's effective access level
//   ('edit' | 'view' | 'none') for a given module feature_key. The page
//   layer / nav layer reads these so QA #138 (View → no edit) and
//   QA #139 (No View → module hidden) are honoured in the UI to match
//   the server-side canWriteTable enforcement.
//
// Data source:
//   The role/permission matrix is loaded once via useRolePermissions()
//   (React Query). This service operates on the matrix object that
//   hook returns; it does not fetch on its own.
//
// Rules (CLAUDE_RULES §4):
//   - No React deps in this module — pure data.
//   - The corresponding hook lives in hooks/useFeatureAccess.js and
//     is the only caller from components.
// ════════════════════════════════════════════════════════════════════

const ACCESS_LEVELS = ['edit', 'view', 'none'];

export function normalizeLevel(value) {
  const v = String(value || '').trim().toLowerCase();
  return ACCESS_LEVELS.includes(v) ? v : 'none';
}

/**
 * Look up the access level for a given (role, featureKey) pair from a
 * matrix shaped like { roles: { [roleKey]: { [featureKey]: level } } }.
 * Returns 'edit' for admin regardless of stored value (matches the
 * server-side ADMIN override) and 'none' when nothing matches.
 */
export function getFeatureLevel(matrix, role, featureKey) {
  if (!featureKey) return 'none';
  const r = String(role || '').trim().toLowerCase();
  if (r === 'admin') return 'edit';
  const map = matrix?.roles?.[r];
  if (!map) return 'none';
  return normalizeLevel(map[featureKey]);
}

export function canEditFeature(matrix, role, featureKey) {
  return getFeatureLevel(matrix, role, featureKey) === 'edit';
}

export function canReadFeature(matrix, role, featureKey) {
  const lvl = getFeatureLevel(matrix, role, featureKey);
  return lvl === 'edit' || lvl === 'view';
}
