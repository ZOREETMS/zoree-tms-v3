import { AuthApi } from "../lib/api";

export async function fetchRolePermissions() {
  return AuthApi.roles();
}

export async function updateRolePermissions(roleName, permissions) {
  return AuthApi.updateRole(roleName, permissions);
}
