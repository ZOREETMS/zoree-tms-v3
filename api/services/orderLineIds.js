// api/services/orderLineIds.js
// ---------------------------------------------------------------------------
// Canonical builder for order_lines.id. Every writer that inserts or
// upserts into order_lines MUST go through this helper so the ID format
// stays identical across code paths — otherwise upsert(onConflict:'id')
// creates duplicate rows for the same (order_id, line_num).
//
// Format: `${orderId}-L${lineNum zero-padded to 3 digits}`  e.g. ORD-276737-L001
// ---------------------------------------------------------------------------

function buildOrderLineId(orderId, lineNum) {
  const n = Number(lineNum) || 1;
  return `${orderId}-L${String(n).padStart(3, '0')}`;
}

module.exports = { buildOrderLineId };
