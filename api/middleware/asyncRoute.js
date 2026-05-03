// ═══════════════════════════════════════════════════════════════════
// asyncRoute(handler) — wraps an async route function so that any
// thrown / rejected error is converted to a normalized JSON response
// in one place.
//
// Eliminates the repeated `try { ... } catch (err) { sendError(...) }`
// boilerplate every route in api/routes/fusionIngest.js used to carry
// (CLAUDE_RULES §6 "No large inline logic blocks" + §13 copy-paste).
//
// Convention:
//   - service throws an Error with optional `.status` and `.details`
//   - response shape: { ok:false, error: string, details?: any }
//   - default status: 500
//
// The success-path payload shape is the route's responsibility — the
// handler returns whatever it wants and the caller (e.g. the route's
// own res.status(202).json(...)) handles formatting. This keeps the
// helper unopinionated about success shape.
// ═══════════════════════════════════════════════════════════════════

function asyncRoute(handler) {
  return async function (req, res, next) {
    try {
      await handler(req, res, next);
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      res.status(status).json({
        ok: false,
        error: (err && err.message) || 'Internal error',
        details: err && err.details ? err.details : undefined,
      });
    }
  };
}

module.exports = asyncRoute;
