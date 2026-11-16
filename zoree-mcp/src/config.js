// ════════════════════════════════════════════════════════════════════
// config.js — environment parsing for the ZoreeTMS MCP server.
//
//   ZOREE_API_URL   Base URL of the ZoreeTMS Express API (no trailing /)
//                   e.g. http://localhost:3010 or https://api.zoree.io
//   PUBLIC_URL      Public HTTPS origin this MCP server is reachable at
//                   e.g. https://mcp.zoree.io  (used as OAuth issuer)
//   PORT            Listen port (default 3030)
//   MCP_SECRET      32+ char secret used to seal OAuth client ids and
//                   authorization codes (AES-256-GCM). Rotating it
//                   signs every connected Claude user out.
//   ALLOWED_REDIRECT_HOSTS  comma list of OAuth callback hosts
//                   (default claude.ai,claude.com; loopback always OK)
// ════════════════════════════════════════════════════════════════════

const DEFAULT_PORT = 3030;
// Hosts allowed as OAuth redirect targets (loopback is always allowed).
const DEFAULT_REDIRECT_HOSTS = 'claude.ai,claude.com';

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function loadConfig(env = process.env) {
  const port = Number(env.PORT || DEFAULT_PORT);
  const apiUrl = trimSlash(env.ZOREE_API_URL || 'http://localhost:3010');
  const publicUrl = trimSlash(env.PUBLIC_URL || `http://localhost:${port}`);
  const secret = env.MCP_SECRET || '';

  if (secret.length < 32) {
    throw new Error('MCP_SECRET must be set to at least 32 characters (e.g. `openssl rand -hex 32`)');
  }
  if (!/^https?:\/\//.test(apiUrl)) {
    throw new Error(`ZOREE_API_URL must be an http(s) URL (got '${apiUrl}')`);
  }

  const allowedRedirectHosts = (env.ALLOWED_REDIRECT_HOSTS || DEFAULT_REDIRECT_HOSTS)
    .split(',').map((h) => h.trim()).filter(Boolean);

  return {
    port,
    apiUrl,
    publicUrl,
    secret,
    allowedRedirectHosts,
    mcpPath: '/mcp',
    scopes: ['tms:read'],
  };
}

module.exports = { loadConfig };
