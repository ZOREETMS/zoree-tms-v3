// ═══════════════════════════════════════════════════════════════════
// Domain scope middleware (migration 052).
//
// Resolves which domain this request works in and runs the rest of the
// request inside it (services/domains/domainContext):
//   - X-Zoree-Domain header, if the user has access to it  → that domain
//   - header set but no access                              → 403
//   - no header                                             → user's default
//   - no user token (login, API keys, webhooks, public)     → ZOREE, header ignored
//
// The user id is read from the bearer token's `sub` claim to look up
// access. The token itself is still verified by each route's
// verifyToken — a forged token gets a 401 there, so it can never read
// data in any domain.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { DEFAULT_DOMAIN, DOMAIN_HEADER, isScopingEnabled, normalizeCode } = require('../services/domains/domainCodes');
const { runInDomain } = require('../services/domains/domainContext');
const domainAccess = require('../services/domains/domainAccess');

/** `sub` claim of a JWT, without verifying it (see note above). */
function subjectOf(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const parts = authHeader.slice(7).split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch { return null; }
}

function createDomainScopeMiddleware({ listForUser = domainAccess.listForUser } = {}) {
  return async function domainScope(req, res, next) {
    if (!isScopingEnabled()) return runInDomain(DEFAULT_DOMAIN, () => next());
    const raw = req.headers[DOMAIN_HEADER];
    const requested = raw ? normalizeCode(raw) : null;
    if (raw && !requested) return res.status(400).json({ error: `Invalid domain "${raw}"` });

    const userId = subjectOf(req.headers.authorization);
    // No signed-in user (login, token refresh, API keys, webhooks): the
    // header is ignored and the request runs in the default domain. A
    // browser that remembers another domain must still be able to log in.
    if (!userId) return runInDomain(DEFAULT_DOMAIN, () => next());
    let domains;
    try { domains = await listForUser(userId); } catch (e) {
      return res.status(503).json({ error: `Could not resolve domain access: ${e.message}` });
    }
    const domain = domainAccess.pickDomain(domains, requested);
    if (!domain) return res.status(403).json({ error: `No access to domain ${requested}` });
    req.domain = domain;
    req.domains = domains;
    res.setHeader('X-Zoree-Domain', domain);
    return runInDomain(domain, () => next());
  };
}

module.exports = { createDomainScopeMiddleware, subjectOf };
