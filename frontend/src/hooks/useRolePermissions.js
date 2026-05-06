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
      queryClient.setQueryData(ROLE_QUERY_KEY, data);
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
