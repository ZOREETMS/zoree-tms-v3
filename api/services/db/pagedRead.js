// ═══════════════════════════════════════════════════════════════════
// Paged PostgREST read — fetchAllRows
//
// PostgREST truncates any response to its db-max-rows ceiling (1000 on
// Supabase) and says nothing about it: a query with no `limit` LOOKS
// like "give me everything" and quietly returns the first page.
//
// That silently broke rating once the rates table outgrew the cap. With
// 6,678 active TL rates, the rating fetch saw ~1,000 of them, so a lane
// whose rates sat outside that window failed with "no carrier returned a
// quote for this lane" while the rates were sitting in the table.
//
// Ordering by `id` gives a total order so offset paging is deterministic;
// created_at alone is not enough because a bulk insert puts thousands of
// rows on one timestamp and tied rows may come back in any order, which
// duplicates some and skips others across page boundaries.
//
// Moved out of api/server.js (2026-10-25, CLAUDE_RULES §1/§6): data
// access belongs in the services layer, not the route file.
// ═══════════════════════════════════════════════════════════════════

'use strict';

/**
 * Read every row behind a PostgREST URL, one page at a time.
 * @param {string} baseUrl  full /rest/v1/<table>?select=... URL (no order/limit/offset)
 * @param {object} opts
 * @param {object} opts.headers   request headers (apikey + Authorization)
 * @param {number} [opts.pageSize=1000]
 * @param {number} [opts.max=100000]   hard stop
 * @param {string} [opts.order='id.asc'] must give a total order
 * @param {Function} [opts.fetchImpl=fetch] injectable for tests
 * @returns {Promise<object[]>}
 */
async function fetchAllRows(baseUrl, opts = {}) {
  const { headers = {}, pageSize = 1000, max = 100000, order = 'id.asc', fetchImpl = fetch } = opts;
  const sep = baseUrl.includes('?') ? '&' : '?';
  const out = [];
  for (let offset = 0; offset < max; offset += pageSize) {
    const url = `${baseUrl}${sep}order=${order}&limit=${pageSize}&offset=${offset}`;
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw new Error(`DB read failed (${res.status}): ${await res.text()}`);
    // eslint-disable-next-line no-await-in-loop
    const rows = await res.json();
    if (!Array.isArray(rows)) break;
    out.push(...rows);
    if (rows.length < pageSize) break; // short page = table exhausted
  }
  return out;
}

module.exports = { fetchAllRows };
