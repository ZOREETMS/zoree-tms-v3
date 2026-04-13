import { useMemo, useState } from "react";
import { useAuth } from "../state/AuthContext";
import ToggleSwitch from "../components/ToggleSwitch";
import { useRolePermissions, useUpdateRolePermissions } from "../hooks/useRolePermissions";

export default function UserRolesPage() {
  const { user } = useAuth();
  const [savingRole, setSavingRole] = useState("");
  const [saveError, setSaveError] = useState("");
  const isAdmin = (user?.role || "").toLowerCase() === "admin";
  const roleQuery = useRolePermissions();
  const updateMutation = useUpdateRolePermissions();
  const roles = roleQuery.data?.roles || {};
  const features = roleQuery.data?.features || [];
  const featureKeys = roleQuery.data?.featureKeys || features.map((f) => f.feature_key);
  const loading = roleQuery.isLoading;
  const error = roleQuery.error?.message || "";

  const roleNames = useMemo(() => Object.keys(roles).sort(), [roles]);

  async function onToggle(roleName, feature, checked) {
    if (!isAdmin) return;
    const current = roles[roleName] || {};
    const updated = { ...current, [feature]: checked };
    setSavingRole(roleName);
    setSaveError("");
    try {
      await updateMutation.mutateAsync({ roleName, permissions: updated });
    } catch (e) {
      setSaveError(e.message || "Failed saving role permission");
    } finally {
      setSavingRole("");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">User Roles</div>
          <div className="page-sub">Configure access by role for core planning functions</div>
        </div>
      </div>

      <div className="page-content">
        {!isAdmin && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            <div className="alert-icon">⚠️</div>
            <div className="alert-text">
              <div className="alert-title">Read-only access</div>
              Only admins can update role permissions.
            </div>
          </div>
        )}
        {!!error && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <div className="alert-icon">⛔</div>
            <div className="alert-text">
              <div className="alert-title">Could not load roles</div>
              {error}
            </div>
          </div>
        )}
        {!!saveError && (
          <div className="alert alert-danger" style={{ marginBottom: 16 }}>
            <div className="alert-icon">⛔</div>
            <div className="alert-text">
              <div className="alert-title">Could not save roles</div>
              {saveError}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <span className="card-title">Role Permission Matrix</span>
            {loading && <span className="text-sm text-muted">Loading...</span>}
          </div>
          <div className="card-body">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Role</th>
                    {features.map((feature) => (
                      <th key={feature.feature_key}>{feature.label || feature.feature_key}</th>
                    ))}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roleNames.map((roleName) => (
                    <tr key={roleName}>
                      <td>
                        <span className="tag">{roleName}</span>
                      </td>
                      {featureKeys.map((featureKey) => {
                        const checked = !!roles?.[roleName]?.[featureKey];
                        return (
                          <td key={`${roleName}-${featureKey}`}>
                            <ToggleSwitch
                              checked={checked}
                              disabled={!isAdmin || savingRole === roleName}
                              onChange={(nextChecked) => onToggle(roleName, featureKey, nextChecked)}
                              label={`${roleName}-${featureKey}`}
                            />
                          </td>
                        );
                      })}
                      <td>{savingRole === roleName ? "Saving..." : "Ready"}</td>
                    </tr>
                  ))}
                  {!loading && roleNames.length === 0 && (
                    <tr>
                      <td colSpan={featureKeys.length + 2} className="text-muted">No role data found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
