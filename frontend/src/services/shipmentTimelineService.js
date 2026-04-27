// ═══════════════════════════════════════════════════════════════════
// Shipment Timeline Service
//
// Turns shaped change_history rows (see services/historyService.js)
// into the per-phase timestamps the Shipment Details timeline rungs
// need to render: when each transition (Tendered → Tender Accepted →
// Picked Up → In Transit → Delivered) actually happened, as opposed
// to the planned pickup/delivery dates from the shipment row.
//
// Architecture (CLAUDE_RULES §1, §3, §4): all derivation logic lives
// here so the page component stays thin. The page passes in the
// already-fetched historyRows and shipment row; this module returns
// a small object the JSX maps over.
// ═══════════════════════════════════════════════════════════════════

/** Phase keys the timeline cares about. */
export const TIMELINE_PHASES = Object.freeze([
  "tendered",
  "accepted",
  "pickedUp",
  "inTransit",
  "delivered",
]);

/**
 * Map a status string to the phase it represents. Returns null when the
 * status isn't a phase boundary we surface in the timeline rungs.
 */
function statusToPhase(status) {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "tendered") return "tendered";
  if (s === "tender accepted" || s === "confirmed") return "accepted";
  if (s === "picked up") return "pickedUp";
  if (s === "in transit") return "inTransit";
  if (s === "delivered") return "delivered";
  return null;
}

/**
 * Some side-effect rows record their phase via metadata.via instead of
 * a status-field change (e.g. the tender-accept auto-sync row).
 */
function metadataVia(row) {
  const via = row && row.metadata && (row.metadata.via || row.metadata.source);
  return String(via || "").toLowerCase();
}

function metadataViaToPhase(via) {
  if (!via) return null;
  if (via.includes("tender-accept")) return "accepted";
  if (via.includes("ship-confirm") || via.includes("picked-up")) return "pickedUp";
  if (via.includes("in-transit")) return "inTransit";
  if (via.includes("delivered"))  return "delivered";
  return null;
}

/**
 * Walk the historyRows (newest-first per historyService) and return the
 * EARLIEST timestamp at which each phase was recorded. Earliest wins so
 * a later "Status: Delivered → In Transit" correction won't backdate the
 * original transition.
 *
 * @param {Array}  historyRows  Output of services/historyService.shapeHistoryRows
 * @returns {{ tendered?: string, accepted?: string, pickedUp?: string, inTransit?: string, delivered?: string }}
 *   Map of phase key → ISO timestamp (raw `tsRaw`).
 */
export function derivePhaseTimestamps(historyRows) {
  const phases = {};
  const remember = (phase, tsRaw) => {
    if (!phase || !tsRaw) return;
    const existing = phases[phase];
    if (!existing || new Date(tsRaw) < new Date(existing)) {
      phases[phase] = tsRaw;
    }
  };

  for (const row of historyRows || []) {
    const tsRaw = row && (row.tsRaw || row.ts);
    if (!tsRaw) continue;

    // 1. Tender event itself — when the carrier was first tendered.
    if ((row.action || row.type) === "tender") {
      remember("tendered", tsRaw);
    }

    // 2. Status-field changes recorded as { label: 'Status', new: '<status>' }.
    if ((row.action || row.type) === "status" && Array.isArray(row.changes)) {
      for (const ch of row.changes) {
        const phase = statusToPhase(ch && ch.new);
        if (phase) remember(phase, tsRaw);
      }
    }

    // 3. Metadata.via fallback — auto-sync rows record the via tag rather
    //    than a status-field change.
    const phaseFromVia = metadataViaToPhase(metadataVia(row));
    if (phaseFromVia) remember(phaseFromVia, tsRaw);
  }

  return phases;
}

/**
 * Format a timestamp for the timeline rung sub-line (e.g. "Apr 26, 2026
 * · 12:28 PM"). Returns an empty string when the input is falsy or
 * unparseable so the caller can fall back to "Pending"/"Confirmed".
 */
export function formatTimelineTs(tsRaw) {
  if (!tsRaw) return "";
  const d = new Date(tsRaw);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/**
 * Convenience: return the formatted timestamp for a given phase, falling
 * back to the supplied default (e.g. "Pending" / "Confirmed") when the
 * history doesn't carry a record for that phase.
 */
export function timelineLineFor(phases, phase, fallback = "") {
  const ts = phases && phases[phase];
  const formatted = formatTimelineTs(ts);
  return formatted || fallback;
}
