// ════════════════════════════════════════════════════════════════════
// format.js — shared helpers that keep tool output small and readable.
//
// The Express list endpoints return up to 500 wide rows (orders carry
// both snake_case and camelCase copies of most fields). Sending that to
// Claude wastes context, so every tool projects to a field subset,
// drops empty values and caps the row count.
// ════════════════════════════════════════════════════════════════════

const { ZoreeApiError } = require('../services/zoreeApiClient');

const MAX_STRING = 500;

function isEmpty(v) {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

/** Drop empty values and `_private` keys; truncate long strings. */
function compact(record) {
  if (!record || typeof record !== 'object') return record;
  const out = {};
  for (const [k, v] of Object.entries(record)) {
    if (k.startsWith('_') || isEmpty(v)) continue;
    out[k] = typeof v === 'string' && v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
  }
  return out;
}

/** Keep only `fields` (those present), then compact. */
function pick(record, fields) {
  const out = {};
  for (const f of fields) if (record && record[f] !== undefined) out[f] = record[f];
  return compact(out);
}

/** Case-insensitive "does any of these fields contain the needle". */
function matchesText(record, needle, fields) {
  if (!needle) return true;
  const n = String(needle).toLowerCase();
  return fields.some((f) => record[f] !== undefined && record[f] !== null
    && String(record[f]).toLowerCase().includes(n));
}

function equalsCi(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

function jsonResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(err) {
  const status = err instanceof ZoreeApiError ? err.status : 500;
  const hint = status === 401 || status === 403
    ? ' Your ZoreeTMS session may have expired or your role lacks access — reconnect the ZoreeTMS connector.'
    : '';
  return {
    isError: true,
    content: [{ type: 'text', text: `ZoreeTMS error (${status}): ${err.message}.${hint}` }],
  };
}

/** Wrap a tool handler so API failures come back as tool errors, not crashes. */
function safeHandler(fn) {
  return async (args, extra) => {
    try {
      return jsonResult(await fn(args || {}, extra));
    } catch (err) {
      return errorResult(err);
    }
  };
}

module.exports = { compact, pick, matchesText, equalsCi, jsonResult, errorResult, safeHandler };
