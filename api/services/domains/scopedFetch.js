// ═══════════════════════════════════════════════════════════════════
// Scoped fetch — the single enforcement point for domains in the API.
//
// The API reaches Supabase through several paths (server.js REST
// helpers, services/supabase.js, pagedRead, a few direct calls). All of
// them use fetch. install() wraps the global fetch once at startup so
// every PostgREST call to a scoped table is rewritten by domainScope for
// the current request's domain. Must run before any Supabase client is
// created (server.js does it right after dotenv).
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { scopeRequest } = require('./domainScope');
const { currentDomain } = require('./domainContext');
const { isScopingEnabled } = require('./domainCodes');

let installed = false;

function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return null; // Request objects are passed through untouched
}

function makeScopedFetch(baseFetch, restBase) {
  return function scopedFetch(input, init = {}) {
    const url = urlOf(input);
    if (!url || !isScopingEnabled() || !url.startsWith(restBase)) return baseFetch(input, init);
    const out = scopeRequest({ url, method: init.method || 'GET', body: init.body }, currentDomain(), restBase);
    if (!out.scoped) return baseFetch(input, init);
    return baseFetch(out.url, { ...init, body: out.body });
  };
}

/** Wrap globalThis.fetch for PostgREST calls under SUPABASE_URL. Idempotent. */
function install({ supabaseUrl = process.env.SUPABASE_URL } = {}) {
  if (installed || !supabaseUrl || typeof globalThis.fetch !== 'function') return false;
  const restBase = `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/`;
  globalThis.fetch = makeScopedFetch(globalThis.fetch.bind(globalThis), restBase);
  installed = true;
  return true;
}

module.exports = { install, makeScopedFetch };
