// ═══════════════════════════════════════════════════════════════════
// Bot Framework adapter (official botbuilder SDK).
//
// Replaces the hand-rolled JWKS validation + connector-token minting
// that lived in botAuth.js / connector.js. Those produced a valid
// token that the Teams connector still rejected with 401; rather than
// keep reverse-engineering Microsoft's auth, we use their SDK, which
// owns the whole handshake (inbound JWT validation, outbound token
// acquisition + refresh, retry, and the reply protocol).
//
// Command logic is unchanged: handlers.js / cards.js / tmsClient.js
// are reused as-is. This module only owns transport + auth.
//
// Requires: npm install botbuilder   (run in api/)
// Loads lazily so the server still boots if the dep isn't installed
// yet — routes/teamsBot.js reports that state on GET /api/teams/status.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { debugLog } = require('./debugLog');

let cached = null;   // { adapter } once built
let loadError = null;

function getAdapter() {
  if (cached) return cached;
  if (loadError) return null;

  try {
    const {
      CloudAdapter,
      ConfigurationServiceClientCredentialFactory,
      createBotFrameworkAuthenticationFromConfiguration,
    } = require('botbuilder');

    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
      MicrosoftAppId: process.env.TEAMS_BOT_APP_ID || '',
      MicrosoftAppPassword: process.env.TEAMS_BOT_APP_PASSWORD || '',
      // Bots created in the Teams Developer Portal are multi-tenant.
      // Set TEAMS_BOT_TENANT_ID + type SingleTenant only if that changes.
      MicrosoftAppType: process.env.TEAMS_BOT_TENANT_ID ? 'SingleTenant' : 'MultiTenant',
      MicrosoftAppTenantId: process.env.TEAMS_BOT_TENANT_ID || '',
    });

    const botFrameworkAuthentication =
      createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);

    const adapter = new CloudAdapter(botFrameworkAuthentication);

    adapter.onTurnError = async (context, error) => {
      console.error('[teamsBot] turn error:', error.message);
      // The connector sometimes throws with an empty .message; capture the
      // whole shape so the log actually says what went wrong.
      debugLog('SDK_TURN_ERROR', {
        message: error.message || null,
        name: error.name || null,
        code: error.code || error.statusCode || null,
        body: error.body ? JSON.stringify(error.body).slice(0, 400) : null,
        stack: (error.stack || '').split('\n').slice(0, 4).join(' | '),
      });
      try { await context.sendActivity('Something went wrong handling that — check the API log.'); }
      catch (_) { /* connection already gone */ }
    };

    cached = { adapter };
    return cached;
  } catch (err) {
    loadError = err.message;
    console.warn('[teamsBot] botbuilder SDK not available:', err.message);
    debugLog('SDK_LOAD_FAILED', err.message);
    return null;
  }
}

function sdkStatus() {
  const a = getAdapter();
  return { sdkLoaded: !!a, sdkError: a ? null : loadError };
}

module.exports = { getAdapter, sdkStatus };
