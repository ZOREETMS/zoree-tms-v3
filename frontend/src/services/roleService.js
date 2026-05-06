// ════════════════════════════════════════════════════════════════════
// roleService — UI-facing wrapper around the /api/roles endpoints.
// Components and pages should import from here, never directly from
// lib/api (CLAUDE_RULES.md Rule 6 — services-first).
// ════════════════════════════════════════════════════════════════════

import { AuthApi } from "../lib/api";

export async function fetchRolePermissions() {
  return AuthApi.roles();
}

export async function updateRolePermissions(roleName, permissions) {
  return AuthApi.updateRole(roleName, permissions);
}

export async function createRole({ roleKey, displayName, description, defaultLevel = "view" }) {
  return AuthApi.createRole({ roleKey, displayName, description, defaultLevel });
}

export async function deleteRole(roleName) {
  return AuthApi.deleteRole(roleName);
}
