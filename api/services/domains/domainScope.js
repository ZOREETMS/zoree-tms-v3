// ═══════════════════════════════════════════════════════════════════
// Domain scope — pure rewrite of one PostgREST request so it only
// reads or writes rows in `domain`. No I/O; unit-tested.
//
//   GET / HEAD / PATCH / DELETE on a scoped table → add domain_code=eq.X
//   POST (insert / upsert)                        → stamp domain_code on rows
//   PATCH body                                    → domain_code removed (rows
//                                                   never move between domains)
//   anything else (rpc, auth, storage, other tables) → unchanged
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { SCOPED_TABLES } = require('./domainCodes');

/** Table name for a PostgREST URL under restBase, or null. */
function tableOf(url, restBase) {
  if (!url.startsWith(restBase)) return null;
  const rest = url.slice(restBase.length);
  const name = rest.split(/[?/#]/)[0];
  return name && name !== 'rpc' ? decodeURIComponent(name) : null;
}

function addFilter(url, domain) {
  if (/[?&]domain_code=/.test(url)) return url; // explicit filter wins
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}domain_code=eq.${encodeURIComponent(domain)}`;
}

function stampRows(body, domain) {
  if (typeof body !== 'string' || !body) return body;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return body; }
  const stamp = (row) => (row && typeof row === 'object' && !Array.isArray(row)
    ? { ...row, domain_code: row.domain_code || domain } : row);
  return JSON.stringify(Array.isArray(parsed) ? parsed.map(stamp) : stamp(parsed));
}

function stripDomain(body) {
  if (typeof body !== 'string' || !body) return body;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return body; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('domain_code' in parsed)) return body;
  const { domain_code, ...rest } = parsed; // eslint-disable-line no-unused-vars
  return JSON.stringify(rest);
}

/**
 * @param {{url:string, method?:string, body?:any}} req
 * @param {string} domain
 * @param {string} restBase   e.g. https://xyz.supabase.co/rest/v1/
 * @returns {{url:string, body:any, scoped:boolean}}
 */
function scopeRequest({ url, method = 'GET', body }, domain, restBase) {
  const table = tableOf(url, restBase);
  if (!table || !SCOPED_TABLES.has(table)) return { url, body, scoped: false };
  const m = String(method).toUpperCase();
  if (m === 'POST') return { url, body: stampRows(body, domain), scoped: true };
  if (m === 'PATCH') return { url: addFilter(url, domain), body: stripDomain(body), scoped: true };
  if (m === 'GET' || m === 'HEAD' || m === 'DELETE') return { url: addFilter(url, domain), body, scoped: true };
  return { url, body, scoped: false };
}

module.exports = { scopeRequest, tableOf };
