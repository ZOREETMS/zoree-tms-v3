// ════════════════════════════════════════════════════════════════════
// app.js — Express wiring for the ZoreeTMS MCP server.
//
//   /.well-known/*, /authorize, /token, /register   MCP SDK auth router
//   POST /oauth/login                               ZoreeTMS sign-in form
//   POST /mcp                                       Streamable HTTP (stateless)
//   GET  /health                                    liveness
// ════════════════════════════════════════════════════════════════════

const express = require('express');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { createMcpServer } = require('./mcpServer');
const { createTokenVerifier } = require('./auth/tokenVerifier');
const { createOAuthProvider } = require('./auth/oauthProvider');
const { createLoginRouter } = require('./auth/loginRoutes');

function createApp(config, { fetchImpl } = {}) {
  const { apiUrl, publicUrl, secret, scopes, mcpPath, allowedRedirectHosts = ['claude.ai', 'claude.com'] } = config;
  const resourceUrl = new URL(publicUrl + mcpPath);

  const verifier = createTokenVerifier({ apiUrl, scopes, fetchImpl });
  const provider = createOAuthProvider({ apiUrl, secret, scopes, verifier, fetchImpl, allowedRedirectHosts });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind DigitalOcean / Cloudflare TLS termination

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'zoree-mcp' }));

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(publicUrl),
    resourceServerUrl: resourceUrl,
    resourceName: 'ZoreeTMS',
    scopesSupported: scopes,
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
  }));
  app.use(createLoginRouter({ provider }));

  const bearer = requireBearerAuth({
    verifier,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  });

  app.post(mcpPath, express.json({ limit: '1mb' }), bearer, async (req, res) => {
    const server = createMcpServer({ apiUrl, token: req.auth.token, fetchImpl });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] request failed:', err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
      }
    }
  });

  // Stateless server: no SSE stream or session to resume/delete.
  const notAllowed = (_req, res) => res.status(405).set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get(mcpPath, notAllowed);
  app.delete(mcpPath, notAllowed);

  return app;
}

module.exports = { createApp };
