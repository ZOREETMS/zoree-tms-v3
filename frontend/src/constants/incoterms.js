// ════════════════════════════════════════════════════════════════════
// QA #154 — Canonical Incoterms list shared by every "create order"
// surface in the web app (NewOrderModal, OrderDetailModal Edit tab).
//
// Why a constants module:
//   The OMS HTML (frontend/zoree-oms.html) ships with FOUR Incoterms —
//   FOB Origin, FOB Destination, CIF, DDP. The React modals had grown a
//   different set (11 options including obscure ones like CFR, DPU, FAS)
//   and the mobile app (mobile/src/shared/constants/orderConstants.js)
//   yet another. That divergence is what QA #154 reported: a Mobile
//   user could pick 'EXW' / 'FCA' that the web side could never produce
//   on the same order.
//
//   Keeping the source-of-truth here lets every web-side dropdown share
//   the same array, and the mobile constant exports the same strings so
//   round-tripping an order between platforms produces the same value.
//
// Deliberately not exported as TS — this module is consumed by JSX/TSX
// callers and the legacy zoree-oms.html (which only loads its own
// hardcoded list, but the labels here mirror it 1:1).
// ════════════════════════════════════════════════════════════════════

/** Canonical, ordered Incoterms shown anywhere a user picks one. */
export const INCOTERMS = Object.freeze([
  "FOB Origin",
  "FOB Destination",
  "CIF",
  "DDP",
]);

/** Default value for new orders — matches the OMS HTML default. */
export const DEFAULT_INCOTERM = "FOB Origin";
