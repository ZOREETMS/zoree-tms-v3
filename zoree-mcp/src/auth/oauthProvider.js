// ════════════════════════════════════════════════════════════════════
// oauthProvider.js — OAuth 2.1 authorization server for Claude.
//
// Claude's custom connectors sign users in with OAuth (dynamic client
// registration + authorization code + PKCE). This provider plugs into
// the MCP SDK's mcpAuthRouter and lets a user sign in with their normal
// ZoreeTMS email + password:
//
//   1. Claude registers        → client id = sealed client metadata
//   2. Claude opens /authorize → we render the ZoreeTMS login page with
//                                a sealed, 10-minute transaction (tx)
//   3. User submits the form   → POST /api/auth/login on the TMS API;
//                                on success we redirect back to Claude
//                                with a sealed, 2-minute auth code
//   4. Claude calls /token     → we unseal the code and hand back the
//                                Supabase access + refresh tokens
//   5. Refresh                 → POST /api/auth/refresh on the TMS API
//
// Everything is sealed with AES-256-GCM (services/sealedBox.js), so no
// database table is needed and restarts don't sign anyone out. The only
// in-memory state is the used-code list that makes codes single-use.
// ════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const {
  InvalidGrantError, InvalidRequestError, ServerError, InvalidClientMetadataError,
} = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const { createSealedBox } = require('../services/sealedBox');
const { createZoreeApiClient } = require('../services/zoreeApiClient');
const { renderLoginPage } = require('./loginPage');

const TX_TTL_SECONDS = 600;
const CODE_TTL_SECONDS = 120;
const CLIENT_PREFIX = 'zc_';

// Only the fields we need survive into the sealed client id, which
// keeps the id short enough to sit comfortably in a URL.
const CLIENT_FIELDS = ['redirect_uris', 'token_endpoint_auth_method', 'grant_types', 'response_types',
  'client_name', 'client_uri', 'scope', 'client_secret', 'client_secret_expires_at'];

/**
 * Dynamic registration is open by design (that's how Claude connects),
 * so we restrict WHERE codes can be sent: Claude's own callback hosts
 * plus loopback (Claude Code). Anything else is refused at registration,
 * which stops a look-alike client from harvesting ZoreeTMS logins.
 */
function redirectAllowed(uri, allowedHosts) {
  try {
    const u = new URL(uri);
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return true;
    return u.protocol === 'https:' && allowedHosts.includes(u.hostname);
  } catch {
    return false;
  }
}

function createOAuthProvider({ apiUrl, secret, scopes, verifier, fetchImpl, allowedRedirectHosts }) {
  const clientBox = createSealedBox(secret, 'oauth-client');
  const txBox = createSealedBox(secret, 'oauth-tx');
  const codeBox = createSealedBox(secret, 'oauth-code');
  const usedCodes = new Map(); // sha256(code) -> exp

  const api = () => createZoreeApiClient({ apiUrl, fetchImpl });

  // ── Client store (stateless) ──────────────────────────────────────
  const clientsStore = {
    getClient(clientId) {
      if (!String(clientId).startsWith(CLIENT_PREFIX)) return undefined;
      const body = clientBox.open(clientId.slice(CLIENT_PREFIX.length));
      if (!body || !body.m) return undefined;
      return { ...body.m, client_id: clientId, client_id_issued_at: body.iat };
    },
    registerClient(client) {
      const bad = (client.redirect_uris || []).filter((u) => !redirectAllowed(u, allowedRedirectHosts));
      if (bad.length) throw new InvalidClientMetadataError(`redirect_uri not allowed: ${bad.join(', ')}`);
      const m = {};
      for (const f of CLIENT_FIELDS) if (client[f] !== undefined) m[f] = client[f];
      const iat = Math.floor(Date.now() / 1000);
      const clientId = CLIENT_PREFIX + clientBox.seal({ m, iat });
      return { ...client, client_id: clientId, client_id_issued_at: iat };
    },
  };

  // ── Step 2: render the sign-in page ───────────────────────────────
  async function authorize(client, params, res) {
    const tx = txBox.seal({
      cid: client.client_id,
      ru: params.redirectUri,
      cc: params.codeChallenge,
      st: params.state,
      sc: params.scopes && params.scopes.length ? params.scopes : scopes,
      rs: params.resource ? params.resource.href : undefined,
    }, TX_TTL_SECONDS);
    res.status(200).type('html').send(renderLoginPage({
      tx, clientName: client.client_name, returnHost: new URL(params.redirectUri).host,
    }));
  }

  // ── Step 3: called by routes/loginRoutes.js after the form posts ──
  /**
   * Returns { redirectTo } on success, or { error, tx, clientName,
   * returnHost } to re-render the form. Throws InvalidRequestError for
   * a dead tx.
   */
  async function completeLogin({ tx, email, password }) {
    const t = txBox.open(tx);
    if (!t) throw new InvalidRequestError('This sign-in link has expired.');
    const client = clientsStore.getClient(t.cid);
    if (!client) throw new InvalidRequestError('Unknown client.');
    const pageCtx = { tx, clientName: client.client_name, returnHost: new URL(t.ru).host };

    let login;
    try {
      login = await api().post('/api/auth/login', { email, password });
    } catch (err) {
      const msg = err.status === 401 ? 'Incorrect email or password.' : `Sign-in failed: ${err.message}`;
      return { error: msg, ...pageCtx };
    }
    if (!login || !login.token) return { error: 'Sign-in failed.', ...pageCtx };
    if (login.user && login.user.disabled) {
      return { error: 'This ZoreeTMS account is disabled. Contact your admin.', ...pageCtx };
    }

    const code = codeBox.seal({
      cid: t.cid,
      ru: t.ru,
      cc: t.cc,
      sc: t.sc,
      rs: t.rs,
      at: login.token,
      rt: login.refresh_token,
      ei: login.expires_in,
    }, CODE_TTL_SECONDS);

    const target = new URL(t.ru);
    target.searchParams.set('code', code);
    if (t.st) target.searchParams.set('state', t.st);
    return { redirectTo: target.href };
  }

  // ── Step 4: code → tokens ─────────────────────────────────────────
  function openCode(client, code) {
    const c = codeBox.open(code);
    if (!c || c.cid !== client.client_id) throw new InvalidGrantError('Invalid or expired authorization code');
    return c;
  }

  async function challengeForAuthorizationCode(client, code) {
    return openCode(client, code).cc;
  }

  async function exchangeAuthorizationCode(client, code, _verifier, redirectUri) {
    const c = openCode(client, code);
    if (redirectUri && redirectUri !== c.ru) throw new InvalidGrantError('redirect_uri does not match');

    const now = Math.floor(Date.now() / 1000);
    for (const [k, exp] of usedCodes) if (exp < now) usedCodes.delete(k);
    const key = crypto.createHash('sha256').update(code).digest('hex');
    if (usedCodes.has(key)) throw new InvalidGrantError('Authorization code already used');
    usedCodes.set(key, now + CODE_TTL_SECONDS);

    return {
      access_token: c.at,
      token_type: 'bearer',
      expires_in: c.ei || 3600,
      refresh_token: c.rt,
      scope: (c.sc || scopes).join(' '),
    };
  }

  // ── Step 5: refresh ───────────────────────────────────────────────
  async function exchangeRefreshToken(_client, refreshToken) {
    let data;
    try {
      data = await api().post('/api/auth/refresh', { refresh_token: refreshToken });
    } catch (err) {
      if (err.status === 400 || err.status === 401) throw new InvalidGrantError('Refresh token is invalid or expired');
      throw new ServerError(`Refresh failed: ${err.message}`);
    }
    return {
      access_token: data.access_token,
      token_type: 'bearer',
      expires_in: data.expires_in || 3600,
      refresh_token: data.refresh_token,
      scope: scopes.join(' '),
    };
  }

  return {
    clientsStore,
    authorize,
    completeLogin,
    challengeForAuthorizationCode,
    exchangeAuthorizationCode,
    exchangeRefreshToken,
    verifyAccessToken: (token) => verifier.verifyAccessToken(token),
  };
}

module.exports = { createOAuthProvider };
