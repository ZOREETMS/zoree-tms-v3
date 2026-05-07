// ════════════════════════════════════════════════════════════════════
// useFeatureAccess — read-only hook that exposes effective access level
// for a feature_key based on the current user's active role and the
// role_feature_permissions matrix.
//
// QA #138 / QA #139:
//   Pages/components call this to gate Edit buttons (canEdit === false
//   when level is 'view') and to short-circuit module rendering when
//   level === 'none'. The server-side canWriteTable / canReadTable
//   gates are still authoritative; this hook only mirrors them in the
//   UI so the user gets the right buttons / nav.
// ════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import { useAuth } from "../state/AuthContext";
import { useRolePermissions } from "./useRolePermissions";
import {
  getFeatureLevel,
  canEditFeature,
  canReadFeature,
} from "../services/featureAccessService";

function activeRole(user) {
  return String(user?.activeRole || user?.role || "admin").toLowerCase();
}

/**
 * Resolve access for one feature.
 *
 * @param {string} featureKey  e.g. "orders", "shipments", "user_roles"
 * @returns {{ level: 'edit'|'view'|'none', canEdit: boolean, canRead: boolean, isLoading: boolean }}
 */
export function useFeatureAccess(featureKey) {
  const { user } = useAuth();
  const { data, isLoading } = useRolePermissions();
  return useMemo(() => {
    const role = activeRole(user);
    const level = getFeatureLevel(data, role, featureKey);
    return {
      level,
      canEdit: canEditFeature(data, role, featureKey),
      canRead: canReadFeature(data, role, featureKey),
      isLoading,
    };
  }, [data, user, featureKey, isLoading]);
}

/**
 * Bulk variant — returns a frozen object keyed by featureKey with
 * { level, canEdit, canRead }. Useful for Layout.jsx which needs every
 * module's access in one shot to filter the nav.
 */
export function useFeatureAccessMap() {
  const { user } = useAuth();
  const { data, isLoading } = useRolePermissions();
  return useMemo(() => {
    const role = activeRole(user);
    const out = {};
    const features = data?.featureKeys || [];
    for (const f of features) {
      const level = getFeatureLevel(data, role, f);
      out[f] = {
        level,
        canEdit: level === "edit",
        canRead: level === "edit" || level === "view",
      };
    }
    out._isLoading = isLoading;
    out._role = role;
    return Object.freeze(out);
  }, [data, user, isLoading]);
}
