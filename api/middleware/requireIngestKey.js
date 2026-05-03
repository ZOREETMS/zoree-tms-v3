// ═══════════════════════════════════════════════════════════════════
// Ingest API-key middleware — shared by every server-to-server inbound
// route (OMS middleware + Fusion via OIC, today).
//
// Auth class: a process-wide shared key set in INGEST_API_KEY. The
// caller passes it as either:
//   - X-API-Key: <key>
//   - Authorization: Bearer <key>
//
// In dev/test where INGEST_API_KEY is unset, auth is skipped so local
// Playwright runs and curl smoke tests can exercise the endpoints
// without extra wiring. This is the same behavior the OMS ingest
// route has had since REQ-01.
//
// Why this is its own file:
//   - CLAUDE_RULES §13 anti-pattern "Copy-paste components" — same
//     middleware was inlined in api/routes/ingest.js and (until this
//     extraction) api/routes/fusionIngest.js.
//   - Single source of truth for what counts as a valid ingest auth
//     header — a future change (e.g. rotate key, support multiple
//     keys, allow IP allowlist) lands in one place.
// ═══════════════════════════════════════════════════════════════════

function requireIngestKey(req, res, next) {
  const required = process.env.INGEST_API_KEY;
  if (!required) return next(); // dev/test — auth disabled
  const header = req.headers['x-api-key']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (header && header === required) return next();
  return res.status(401).json({ ok: false, error: 'invalid or missing X-API-Key' });
}

module.exports = requireIngestKey;
