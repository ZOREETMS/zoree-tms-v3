// ═══════════════════════════════════════════════════════════════════
// SMTP transport — one place that turns SMTP_* env vars into a
// nodemailer transport. Used by the tender email route (server.js) and
// by agent outbound messages.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const nodemailer = require('nodemailer');

/** @returns {import('nodemailer').Transporter|null} null when SMTP_HOST is unset */
function getSmtpTransport(env = process.env) {
  const host = env.SMTP_HOST;
  if (!host) return null;
  const opts = {
    host,
    port: parseInt(env.SMTP_PORT || '587', 10),
    secure: env.SMTP_SECURE === 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' } : undefined,
  };
  if (env.SMTP_DEBUG === 'true') opts.debug = true;
  return nodemailer.createTransport(opts);
}

module.exports = { getSmtpTransport };
