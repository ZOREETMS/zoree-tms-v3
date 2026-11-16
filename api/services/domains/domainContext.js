// ═══════════════════════════════════════════════════════════════════
// Domain context — which domain the current request works in.
// Carried with AsyncLocalStorage so every database call made while
// handling a request (however deep) sees the same domain. Code that
// runs outside a request (pollers, timers) gets the default domain.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { DEFAULT_DOMAIN } = require('./domainCodes');

const als = new AsyncLocalStorage();

/** Run fn with `domain` as the current domain. */
function runInDomain(domain, fn) {
  return als.run({ domain }, fn);
}

/** The current domain, or the default outside a request. */
function currentDomain() {
  const store = als.getStore();
  return (store && store.domain) || DEFAULT_DOMAIN;
}

module.exports = { runInDomain, currentDomain };
