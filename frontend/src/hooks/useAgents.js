// Server state for the AI Agent Console (React Query). Network calls go
// through services/agentsService only.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getCatalog, listRuns, runAgent, approveAction, rejectAction } from "../services/agentsService";

const ROOT = ["agents"];

export function useAgentCatalog() {
  return useQuery({ queryKey: [...ROOT, "catalog"], queryFn: getCatalog, refetchInterval: 15000 });
}

export function useAgentRuns(agent) {
  return useQuery({ queryKey: [...ROOT, "runs", agent], queryFn: () => listRuns(agent), enabled: !!agent, refetchInterval: 10000 });
}

function useInvalidateAgents() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ROOT });
}

export function useRunAgent() {
  const refresh = useInvalidateAgents();
  return useMutation({ mutationFn: ({ agent, input }) => runAgent(agent, input), onSuccess: refresh });
}

export function useApproveAction() {
  const refresh = useInvalidateAgents();
  return useMutation({ mutationFn: ({ id, edits }) => approveAction(id, edits), onSettled: refresh });
}

export function useRejectAction() {
  const refresh = useInvalidateAgents();
  return useMutation({ mutationFn: ({ id, reason }) => rejectAction(id, reason), onSettled: refresh });
}
