// ═══════════════════════════════════════════════════════════════════
// Bot Framework connector — sends activities (replies) back to Teams.
//
// Uses the serviceUrl carried on each inbound activity; per Bot
// Framework contract that URL must be trusted only for replying to
// the conversation it arrived on, which is all we do here.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { getConnectorToken } = require('./botAuth');
const { debugLog } = require('./debugLog');

function cardActivity(card, textFallback) {
  return {
    type: 'message',
    textFormat: 'markdown',
    text: undefined,
    summary: textFallback || 'Zoree TMS',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: card,
      },
    ],
  };
}

function textActivity(text) {
  return { type: 'message', textFormat: 'markdown', text };
}

/**
 * Reply into the conversation an activity arrived on.
 * @param {object} inbound  the inbound activity (needs serviceUrl,
 *                          conversation.id, id, recipient, from)
 * @param {object} outbound the reply activity (from cardActivity/textActivity)
 */
async function replyToActivity(inbound, outbound) {
  const serviceUrl = String(inbound.serviceUrl || '').replace(/\/+$/, '');
  const convId = inbound.conversation && inbound.conversation.id;
  if (!serviceUrl || !convId) throw new Error('Inbound activity missing serviceUrl/conversation');

  const activity = {
    ...outbound,
    // bot ↔ user swap per Bot Framework reply contract
    from: inbound.recipient,
    recipient: inbound.from,
    conversation: inbound.conversation,
    replyToId: inbound.id,
  };

  const url = `${serviceUrl}/v3/conversations/${encodeURIComponent(convId)}/activities/${encodeURIComponent(inbound.id || '')}`;
  const headers = { 'Content-Type': 'application/json' };
  const token = await getConnectorToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  debugLog('REPLY_POST', { url, hasToken: !!token, tokenLen: token ? token.length : 0 });

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(activity) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Reply send failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json().catch(() => ({}));
}

module.exports = { replyToActivity, cardActivity, textActivity };
