// ─────────────────────────────────────────────────────────────────────────────
// useToast — toast state + timer hook
//
// Owns:
//   • The message object ({ text, type, dismissible })
//   • The auto-dismiss timer (cancelable when the user manually dismisses or
//     when a new toast replaces the current one)
//
// Does NOT render anything. Pair with <Toast> from components/ui/Toast.jsx.
//
// Why a hook (not a provider)? The existing pages (OrdersPage, BulkPlanPage)
// manage their own local toast state — a hook is a drop-in replacement that
// keeps the same call-site ergonomics (`toast("message", "success")`).
//
// REQ-27
//   The order-creation toast must persist for 60 seconds unless the user
//   clicks close. Callers pass `durationMs: TOAST_DURATIONS.ORDER_CREATED`
//   (60_000) for that specific event. Any other toast keeps its existing
//   behaviour with `TOAST_DURATIONS.DEFAULT`.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { TOAST_DURATIONS } from "../constants/toast";

const EMPTY_MESSAGE = { text: "", type: "", dismissible: true };

/**
 * @returns {{
 *   message: { text: string, type: string, dismissible: boolean },
 *   toast:   (text: string, type?: string, opts?: { durationMs?: number, dismissible?: boolean }) => void,
 *   dismiss: () => void,
 * }}
 */
export default function useToast() {
  const [message, setMessage] = useState(EMPTY_MESSAGE);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setMessage(EMPTY_MESSAGE);
  }, [clearTimer]);

  const toast = useCallback((text, type = "info", opts = {}) => {
    clearTimer();
    const durationMs = typeof opts.durationMs === "number"
      ? opts.durationMs
      : TOAST_DURATIONS.DEFAULT;
    const dismissible = opts.dismissible !== false;

    setMessage({ text, type, dismissible });

    // durationMs === 0 ⇒ sticky toast, stays until user dismisses
    if (durationMs > 0) {
      timerRef.current = setTimeout(() => {
        setMessage(EMPTY_MESSAGE);
        timerRef.current = null;
      }, durationMs);
    }
  }, [clearTimer]);

  // Clean up the timer if the component using this hook unmounts.
  useEffect(() => () => clearTimer(), [clearTimer]);

  return { message, toast, dismiss };
}
