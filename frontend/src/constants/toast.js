// ─────────────────────────────────────────────────────────────────────────────
// Toast duration constants
//
// Single source of truth for how long a toast stays on screen before the
// auto-dismiss timer fires. Callers pass these into `useToast` / `<Toast>`
// rather than hard-coding millisecond values.
//
// REQ-27 — order-creation toasts MUST stay for 60s unless the user dismisses
// them manually (click the close button).
// ─────────────────────────────────────────────────────────────────────────────

export const TOAST_DURATIONS = Object.freeze({
  /**
   * Default auto-dismiss for informational / error / success toasts.
   * 8s gives the reader time to absorb action confirmations like
   * "Copied SHP-2026-1234 → SHP-2026-9999" without feeling sticky.
   * Bumped from 5s after user feedback that messages dismissed too fast.
   */
  DEFAULT: 8000,

  /** Short-lived progress pings ("Planning 8 orders..."). */
  SHORT: 3500,

  /** REQ-27: success toast after an order is created must persist for 60s. */
  ORDER_CREATED: 60_000,

  /** Special: the toast never auto-dismisses; only the close button clears it. */
  STICKY: 0,
});

/**
 * Which of the above to use for a given toast "event key". Centralised so
 * both TMS (OrdersPage) and any future callers agree on semantics.
 */
export const TOAST_EVENT_DURATIONS = Object.freeze({
  order_created: TOAST_DURATIONS.ORDER_CREATED,
  order_booked:  TOAST_DURATIONS.ORDER_CREATED, // REQ-27 also covers OMS "booked"
});
