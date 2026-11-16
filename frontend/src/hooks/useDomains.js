// Client domains for the signed-in user (migration 052).
import { useQuery } from "@tanstack/react-query";
import { fetchMyDomains, switchDomain } from "../services/domainService";

export function useDomains(enabled = true) {
  const q = useQuery({
    queryKey: ["domains", "mine"],
    queryFn: fetchMyDomains,
    enabled,
    staleTime: 60_000,
  });
  const domains = q.data?.domains || [];
  const active = q.data?.active || "";
  const activeName = (domains.find((d) => d.code === active) || {}).name || active;
  return { domains, active, activeName, switchDomain, isLoading: q.isLoading, error: q.error };
}
