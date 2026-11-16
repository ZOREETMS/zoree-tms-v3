// ═══════════════════════════════════════════════════════════════════
// Agent outbound messages (quote replies, load offers, check calls,
// disputes, customer delay notices).
//
// Carrier-facing messages are recorded in message_log through the
// Messaging Hub single writer, so they show on the Messaging Hub page
// next to tenders. Every message is emailed only when
// AGENT_EMAIL_SEND=true and SMTP is configured; otherwise it is
// recorded and marked "not emailed" — the safe default for demos, where
// carrier contact addresses are sample data.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('crypto');
const writer = require('../../messagingHub/writer');
const { MESSAGE_TYPE, SYSTEM_PARTY } = require('../../messagingHub/types');
const { getSmtpTransport } = require('../../mail/smtpTransport');

const shouldEmail = (env = process.env) => env.AGENT_EMAIL_SEND === 'true';

async function sendEmail({ to, subject, body }) {
  if (!shouldEmail() || !to) return { emailed: false, reason: !to ? 'no recipient address' : 'AGENT_EMAIL_SEND is off (demo mode)' };
  const transport = getSmtpTransport();
  if (!transport) return { emailed: false, reason: 'SMTP is not configured' };
  const info = await transport.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text: body });
  return { emailed: true, smtpMessageId: info.messageId };
}

/**
 * @param {object} m
 * @param {'carrier'|'customer'} m.audience
 * @param {string} m.messageType  MESSAGE_TYPE key (carrier messages only)
 * @param {string} m.to
 * @param {string} m.subject
 * @param {string} m.body
 * @param {string} [m.shipmentId]
 * @param {string} [m.externalRef]
 * @param {object} ctx  runner ctx ({ user, trace })
 */
async function sendAgentMessage(m, ctx) {
  const correlationId = `agent-${ctx.trace.agent_action_id || crypto.randomUUID()}`;
  let messageId = null;
  if (m.audience === 'carrier') {
    const rec = await writer.recordOutbound({
      messageType: MESSAGE_TYPE[m.messageType],
      source: SYSTEM_PARTY.TMS,
      target: SYSTEM_PARTY.CARRIER,
      payload: { channel: 'email', to: m.to || null, subject: m.subject, body: m.body, ...ctx.trace },
      headers: { issuedAt: new Date().toISOString(), issuer: `agent:${ctx.trace.agent}`, approvedBy: (ctx.user && ctx.user.email) || null },
      correlationId,
      shipmentId: m.shipmentId || null,
      externalRef: m.externalRef || null,
      actor: (ctx.user && ctx.user.email) || `agent:${ctx.trace.agent}`,
      tenantId: ctx.user && ctx.user.tenantId,
    });
    messageId = rec && rec.id;
  }
  const mail = await sendEmail(m);
  return { to: m.to || null, subject: m.subject, messageLogId: messageId, correlationId, ...mail };
}

module.exports = { sendAgentMessage, shouldEmail };
