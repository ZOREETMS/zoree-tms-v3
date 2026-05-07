import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchRolePermissions,
  updateRolePermissions,
  createRole,
  deleteRole,
} from "../services/roleService";

const ROLE_QUERY_KEY = ["role-permissions"];

export function useRolePermissions() {
  return useQuery({
    queryKey: ROLE_QUERY_KEY,
    queryFn: fetchRolePermissions,
  });
}

// permissions is { [feature_key]: 'edit' | 'view' | 'none' }
export function useUpdateRolePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roleName, permissions }) => updateRolePermissions(roleName, permissions),
    onSuccess: (data) => {
      // QA #137: setQueryData primes the cache instantly so the UserRoles
      // matrix re-renders without a round-trip; invalidateQueries then
      // forces every other consumer (Layout's nav filter via
      // useFeatureAccessMap, page-level useFeatureAccess) to refetch on
      // their next render. Without the invalidate, a sibling tab's
      // navigation could still display stale 'edit' affordances after a
      // role was downgraded to 'view'.
      queryClient.setQueryData(ROLE_QUERY_KEY, data);
      queryClient.invalidateQueries({ queryKey: ROLE_QUERY_KEY, refetchType: "active" });
    },
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roleKey, displayName, description, defaultLevel }) =>
      createRole({ roleKey, displayName, description, defaultLevel }),
    onSuccess: (data) => {
      queryClient.setQueryData(ROLE_QUERY_KEY, data);
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (roleName) => deleteRole(roleName),
    onSuccess: (data) => {
      queryClient.setQueryData(ROLE_QUERY_KEY, data);
    },
  });
}
