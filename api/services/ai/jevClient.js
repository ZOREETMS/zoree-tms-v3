// ═══════════════════════════════════════════════════════════════════
// Jev (TypeSafe AI System One) HTTP client — server-side only.
//
// One call: systemOne(state, questions) → { model, answers, usage, latencyMs }.
// Uses global fetch (Node 18+), so no SDK dependency.
//
// Config (api/.env):
//   TYPESAFE_API_KEY   required (JEV_API_KEY also accepted). Never sent to the browser.
//   JEV_MODEL          pinned model id; default jev-1.13.0. Pin it — jev-latest
//                      moves between releases and silently shifts every threshold.
//   JEV_BASE_URL       default https://api.typesafe.ai
//   JEV_TIMEOUT_MS     per-attempt timeout; default 1500
//
// 429 / 503 / 529 are retried once with a short backoff; everything else
// throws a JevError so callers can fail open.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const DEFAULTS = Object.freeze({
  baseUrl: 'https://api.typesafe.ai',
  model: 'jev-1.13.0',
  timeoutMs: 1500,
  retries: 1,
});
const RETRYABLE_STATUS = new Set([429, 503, 529]);

class JevError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'JevError';
    this.status = status;
  }
}

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Read lazily so dotenv (loaded in server.js) and tests can set env first.
function getConfig() {
  const env = process.env;
  return {
    apiKey: String(env.TYPESAFE_API_KEY || env.JEV_API_KEY || '').trim(),
    baseUrl: String(env.JEV_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, ''),
    model: env.JEV_MODEL || DEFAULTS.model,
    timeoutMs: toPositiveInt(env.JEV_TIMEOUT_MS, DEFAULTS.timeoutMs),
  };
}

function isConfigured() {
  return Boolean(getConfig().apiKey);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readErrorBody(res) {
  try { return (await res.text()).slice(0, 200); } catch (_) { return ''; }
}

async function postOnce(cfg, body, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new JevError(`Jev HTTP ${res.status}: ${await readErrorBody(res)}`, res.status);
    }
    return await res.json();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new JevError(`Jev timed out after ${cfg.timeoutMs}ms`, 408);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string|object|Array} state      what Jev judges — send only the fields the questions need
 * @param {object} questions               { name: choice(...) | noul(...) | score(...) }
 * @param {object} [opts]                  { fetch, config } — test seams
 */
async function systemOne(state, questions, opts = {}) {
  const cfg = { ...getConfig(), ...(opts.config || {}) };
  if (!cfg.apiKey) throw new JevError('TYPESAFE_API_KEY is not set', 0);
  const fetchImpl = opts.fetch || globalThis.fetch;
  const body = { model: cfg.model, state, questions };
  const started = Date.now();

  let lastErr;
  for (let attempt = 0; attempt <= DEFAULTS.retries; attempt += 1) {
    try {
      const data = await postOnce(cfg, body, fetchImpl);
      return { ...data, latencyMs: Date.now() - started };
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof JevError && RETRYABLE_STATUS.has(err.status);
      if (!retryable || attempt === DEFAULTS.retries) break;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastErr;
}

module.exports = { systemOne, isConfigured, getConfig, JevError, DEFAULTS };
