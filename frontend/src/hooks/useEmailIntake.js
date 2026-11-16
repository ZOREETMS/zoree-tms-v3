// Server state for the Email Orders page (CLAUDE_RULES §3: React Query
// for server state). All network calls go through services/emailIntakeService.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAgentStatus, listIntake, checkInboxNow } from "../services/emailIntakeService";

const ROOT = ["email-intake"];
const REFRESH_MS = 30000;

export function useEmailIntakeStatus() {
  return useQuery({ queryKey: [...ROOT, "status"], queryFn: getAgentStatus, refetchInterval: REFRESH_MS });
}

export function useEmailIntakeList(status) {
  return useQuery({
    queryKey: [...ROOT, "list", status],
    queryFn: () => listIntake(status).then((rows) => (Array.isArray(rows) ? rows : [])),
    refetchInterval: REFRESH_MS,
  });
}

/** Invalidate every email-intake query (after approve/reject/retry/paste). */
export function useRefreshEmailIntake() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ROOT });
}

export function useCheckInbox() {
  const refresh = useRefreshEmailIntake();
  return useMutation({ mutationFn: checkInboxNow, onSuccess: refresh });
}
