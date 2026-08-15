// ═══════════════════════════════════════════════════════════════════
// Shared config for the Microsoft Teams integration.
//
// Single source of truth for the ZOREE_WEB_URL env read and the
// deep-link URLs used in Adaptive Card "Open in Zoree TMS" buttons.
// Imported by services/teamsNotify.js and services/teamsBot/cards.js
// (CLAUDE_RULES §2: no duplicated env parsing across modules).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const WEB_URL = (process.env.ZOREE_WEB_URL || 'http://localhost:5173').replace(/\/+$/, '');

/** Deep link to a screen, e.g. webLink('shipments', 'SHP-1') or webLink() for home. */
function webLink(screen, id) {
  if (!screen) return WEB_URL;
  const idPart = id ? `&id=${encodeURIComponent(id)}` : '';
  return `${WEB_URL}/?screen=${encodeURIComponent(screen)}${idPart}`;
}

module.exports = { WEB_URL, webLink };
