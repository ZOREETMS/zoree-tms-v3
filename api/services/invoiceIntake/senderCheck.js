// ═══════════════════════════════════════════════════════════════════
// Sender verification for carrier invoices that arrive by email.
//
// Invoice correctness and payment authorization are separate questions.
// An unverified sender never stops the audit; it only stops automatic
// approval, so a person confirms the sender through a known carrier
// contact before the invoice is released.
//
//   verified     the sender's domain is one the carrier is on file with,
//                and the email did not fail SPF / DKIM / DMARC
//   unverified   a different domain, or the email failed authentication
//                (possible fraud)
//   unregistered the carrier has no billing email on file to compare with
//   not_checked  not an email (upload, inbox folder) or the check is off
//
// Pure: no I/O. Configurable guardrail:
//   EMAIL_INVOICE_SENDER_CHECK=on|off   (default on)
// ═══════════════════════════════════════════════════════════════════
'use strict';

const domainOf = (addr) => String(addr || '').trim().toLowerCase().split('@')[1] || '';

function enabled(env = process.env) {
  return !/^(off|false|0|no)$/i.test(String(env.EMAIL_INVOICE_SENDER_CHECK || '').trim());
}

/**
 * Pull spf / dkim / dmarc results out of an Authentication-Results header.
 * @param {string|string[]|null} header
 * @returns {{ spf?:string, dkim?:string, dmarc?:string }}
 */
function parseAuthResults(header) {
  const text = [].concat(header || []).join(' ; ').toLowerCase();
  const out = {};
  for (const k of ['spf', 'dkim', 'dmarc']) {
    const m = new RegExp(`\\b${k}=([a-z]+)`).exec(text);
    if (m) out[k] = m[1];
  }
  return out;
}

const FAILED = new Set(['fail', 'softfail', 'permerror']);

/**
 * @param {{ sender:string|null, auth?:object, carrierRow:object|null, source:string, env?:object }} args
 * @returns {{ status:'verified'|'unverified'|'unregistered'|'not_checked', sender:string|null, detail:string, auth:object }}
 */
function verify({ sender, auth = {}, carrierRow, source, env = process.env }) {
  const base = { sender: sender || null, auth: auth || {} };
  if (source !== 'email' || !enabled(env)) return { ...base, status: 'not_checked', detail: 'Not received by email.' };
  if (!carrierRow) return { ...base, status: 'unverified', detail: 'The carrier is not on file, so the sender cannot be verified.' };
  const name = carrierRow.name || 'The carrier';
  const onFile = [...new Set([carrierRow.contact_email, carrierRow.email].map(domainOf).filter(Boolean))];
  const from = domainOf(sender);
  const failed = ['dmarc', 'dkim', 'spf'].filter((k) => FAILED.has(String((auth || {})[k] || '')));
  if (!onFile.length) {
    return { ...base, status: 'unregistered', detail: `${name} has no billing email on file, so the sender ${sender || '(unknown)'} cannot be verified. Add the carrier's billing email to verify future invoices.` };
  }
  if (!onFile.includes(from)) {
    return { ...base, status: 'unverified', detail: `Sent from ${from || 'an unknown address'}, but ${name} is on file as ${onFile.join(' / ')}. Possible fraud — confirm with the carrier through a known contact.` };
  }
  if (failed.length) {
    return { ...base, status: 'unverified', detail: `Sent from ${from}, which matches ${name} on file, but the email failed ${failed.map((k) => k.toUpperCase()).join(' / ')} authentication. The From address may be forged.` };
  }
  const passed = ['dmarc', 'dkim', 'spf'].filter((k) => String((auth || {})[k] || '') === 'pass');
  return { ...base, status: 'verified', detail: `Sent from ${from}, the domain ${name} is on file with${passed.length ? ` (${passed.map((k) => k.toUpperCase()).join(', ')} pass)` : ''}.` };
}

module.exports = { verify, parseAuthResults, enabled, domainOf };
