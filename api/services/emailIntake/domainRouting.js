// ═══════════════════════════════════════════════════════════════════
// Which client domain an inbound email belongs to.
//
// Each domain can have its own AP / orders address on the shared
// mailbox. An email addressed (To or Cc) to that address is processed
// in that domain; everything else goes to the default domain.
//
//   EMAIL_INTAKE_DOMAIN_ADDRESSES=KESTREL_BAY=ap+kestrelbay@x.com,ACME=ap+acme@x.com
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { DEFAULT_DOMAIN, normalizeCode } = require('../domains/domainCodes');

const clean = (a) => String(a || '').trim().toLowerCase();

/** address → domain code, from the env setting. */
function addressMap(raw = process.env.EMAIL_INTAKE_DOMAIN_ADDRESSES) {
  const map = new Map();
  for (const pair of String(raw || '').split(',')) {
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const code = normalizeCode(pair.slice(0, i));
    const address = clean(pair.slice(i + 1));
    if (code && address.includes('@')) map.set(address, code);
  }
  return map;
}

/** Domain for an email, by its recipients. */
function resolve(email, map = addressMap()) {
  for (const to of (email && email.toAddresses) || []) {
    const code = map.get(clean(to));
    if (code) return code;
  }
  return DEFAULT_DOMAIN;
}

/** Every address that routes mail to `domain`, in the order configured. */
function addressesFor(domain, map = addressMap()) {
  return [...map].filter(([, code]) => code === domain).map(([address]) => address);
}

/**
 * The address that routes mail to `domain`. With `mailboxUser`, prefer an
 * address that lands in that mailbox (same account, with or without a
 * +tag), so the screen names an address the mailbox being read receives.
 */
function addressFor(domain, map = addressMap(), mailboxUser = null) {
  const all = addressesFor(domain, map);
  if (mailboxUser) {
    const base = (a) => clean(a).replace(/\+[^@]*@/, '@');
    const mine = all.find((a) => base(a) === clean(mailboxUser));
    if (mine) return mine;
  }
  return all[0] || null;
}

/** Domains whose address lands in the mailbox `mailboxUser` (same account, with or without a +tag). */
function domainsForMailbox(mailboxUser, map = addressMap()) {
  const base = (a) => clean(a).replace(/\+[^@]*@/, '@');
  const user = clean(mailboxUser);
  return [...new Set([...map].filter(([address]) => base(address) === user).map(([, code]) => code))];
}

module.exports = { addressMap, resolve, addressFor, addressesFor, domainsForMailbox };
