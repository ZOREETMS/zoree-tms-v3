// ═══════════════════════════════════════════════════════════════════
// useMwQueueStatus — server-state hook for the MW Queue Admin panel
//
// Polls the /mw-queue/status endpoint at a configurable interval and
// exposes shaped state to the UI. CLAUDE_RULES §3: components don't
// call services directly; this hook is the boundary. Returns a
// `refresh` callback so action handlers (start / stop / runOnce) can
// force-refresh after mutating without waiting for the next tick.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { getStatus } from "../services/mwQueueService";

const DEFAULT_POLL_MS = 5000;

export default function useMwQueueStatus({ pollMs = DEFAULT_POLL_MS } = {}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getStatus();
      if (cancelledRef.current) return;
      setStatus(next);
      setError(null);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err.message || "failed to load worker status");
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    const handle = setInterval(refresh, pollMs);
    return () => {
      cancelledRef.current = true;
      clearInterval(handle);
    };
  }, [pollMs, refresh]);

  return { status, loading, error, refresh };
}
