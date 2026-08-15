// ═══════════════════════════════════════════════════════════════════
// Teams bot messaging endpoint.
//
//   POST /api/teams/messages — the bot's configured endpoint
//   GET  /api/teams/status   — wiring diagnostics
//
// Transport + auth are owned by the official botbuilder SDK
// (services/teamsBot/adapter.js). The adapter validates the inbound
// JWT, hands us a TurnContext, and sends our reply back with a token
// it manages itself.
//
// Command logic is unchanged and lives in services/teamsBot/handlers.js;
// this file stays a thin dispatcher (CLAUDE_RULES §10).
//
// Setup: docs/TEAMS_SETUP.md. Requires `npm install botbuilder` in api/.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const router = require('express').Router();
const { getAdapter, sdkStatus } = require('../services/teamsBot/adapter');
const { handleActivity } = require('../services/teamsBot/handlers');
const { debugLog, ENABLED: DEBUG_ENABLED } = require('../services/teamsBot/debugLog');
const tms = require('../services/teamsBot/tmsClient');
const sentLog = require('../services/teamsBot/sentLog');

// Health/diagnostics for the bot wiring (public, no secrets).
router.get('/status', (_req, res) => {
  res.json({
    botAppIdConfigured: !!process.env.TEAMS_BOT_APP_ID,
    tmsUserConfigured: tms.isConfigured(),
    endpoint: 'POST /api/teams/messages',
    debugLogEnabled: DEBUG_ENABLED,
    ...sdkStatus(),
    build: 'teams-bot-sdk-1',
  });
});

router.post('/messages', async (req, res) => {
  const activity = req.body || {};
  debugLog('INBOUND', {
    type: activity.type,
    text: activity.text,
    value: activity.value,
    conversation: activity.conversation && activity.conversation.id,
    serviceUrl: activity.serviceUrl,
    hasAuth: !!req.headers.authorization,
  });

  const built = getAdapter();
  if (!built) {
    console.error('[teamsBot] botbuilder SDK missing — run `npm install botbuilder` in api/');
    return res.status(503).json({ error: 'Bot SDK not installed' });
  }

  try {
    // The adapter owns auth, the reply channel, and the HTTP response.
    await built.adapter.process(req, res, async (context) => {
      const reply = await handleActivity(context.activity);
      debugLog('REPLY_BUILT', reply ? { type: reply.type, attachments: (reply.attachments || []).length } : null);
      const convId = context.activity.conversation && context.activity.conversation.id;

      // `clear` command: handlers return a sentinel instead of a card —
      // deletion is transport-level (needs the SDK TurnContext), so it
      // lives here, keeping handlers pure command logic. Teams only
      // allows a bot to delete ITS OWN messages, by activity id; the
      // sentLog remembers every id we've sent into this conversation.
      if (reply && reply.type === 'clearConversation') {
        const ids = sentLog.take(convId);
        let deleted = 0;
        for (const id of ids) {
          try {
            await context.deleteActivity(id);
            deleted += 1;
          } catch (delErr) {
            debugLog('CLEAR_DELETE_FAIL', { id, error: delErr.message });
          }
        }
        const confirm = {
          type: 'message',
          textFormat: 'markdown',
          text: `🧹 Cleared ${deleted} bot message${deleted === 1 ? '' : 's'} from this chat. ` +
            'Teams only lets the bot delete its own messages — remove yours via each message’s ⋯ menu.',
        };
        const rr = await context.sendActivity(confirm);
        if (rr && rr.id) sentLog.record(convId, rr.id);
        debugLog('CLEARED', { requested: ids.length, deleted });
      } else if (reply) {
        const rr = await context.sendActivity(reply);
        // Remember what we sent so `clear` can delete it later.
        if (rr && rr.id) sentLog.record(convId, rr.id);
        debugLog('REPLY_SENT', true);
      }
    });
  } catch (err) {
    // Crash-prevention handlers swallow rejections; log explicitly.
    console.error('[teamsBot] activity handling failed:', err.message);
    debugLog('ERROR', err.message);
    if (!res.headersSent) res.status(500).end();
  }
});

module.exports = router;
