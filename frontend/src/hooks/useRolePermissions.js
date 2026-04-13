import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRolePermissions, updateRolePermissions } from "../services/roleService";

const ROLE_QUERY_KEY = ["role-permissions"];

export function useRolePermissions() {
  return useQuery({
    queryKey: ROLE_QUERY_KEY,
    queryFn: fetchRolePermissions,
  });
}

export function useUpdateRolePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roleName, permissions }) => updateRolePermissions(roleName, permissions),
    onSuccess: (data) => {
      queryClient.setQueryData(ROLE_QUERY_KEY, data);
    },
  });
}
