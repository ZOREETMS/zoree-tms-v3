// ═══════════════════════════════════════════════════════════════════
// ordersRepo — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Read-through cache for orders. Public surface:
//
//   listOrders()       → online: fetch + write-through; offline: read
//                         from SQLite. Returns whichever is freshest.
//   getOrder(id)       → same pattern for a single order.
//   primeFromServer(rows)
//                      → bulk write-through used by DataContext after
//                         a successful refreshData() call.
//   cachedCount()      → quick local-row count for the UI badge.
//
// Cache shape: each row is the full server JSON, plus an `updated_at`
// column lifted to the top level so we can index by it (for stale
// detection in a future eviction pass). Cache reads return arrays of
// the original server-shape objects — no shape changes — so consuming
// code (services/ordersService.ts, screens) does not have to care
// whether the row came from the network or the cache.
//
// Cache invalidation: we never silently drop rows. Eviction is
// caller-driven (DataContext clears on logout via {@link clearAll}).
// ═══════════════════════════════════════════════════════════════════

// @ts-expect-error — shared/api.js is JS, no .d.ts.
import { DbApi } from '../../lib/api';
import { getDb } from '../../lib/localDb';
import { isOnline } from '../../lib/connectivity';

// ── Public API ──────────────────────────────────────────────────────

/**
 * Fetch the full orders list. Online path: hit DbApi.orders(), then
 * write the result to the local cache. Offline path: read from SQLite.
 *
 * If the network call fails for any reason, we fall back to the cache
 * (without surfacing the error) — every screen that calls this has
 * already accepted that orders may be stale offline.
 */
export async function listOrders(): Promise<any[]> {
  if (isOnline()) {
    try {
      const rows = await DbApi.orders();
      const list = Array.isArray(rows) ? rows : [];
      await primeFromServer(list);
      return list;
    } catch (_e) {
      return await readAllCached();
    }
  }
  return await readAllCached();
}

/**
 * Fetch a single order. Online: prefer DbApi.full (richest payload)
 * and write-through; offline: read from cache. Returns null if not
 * cached and offline.
 */
export async function getOrder(orderId: string): Promise<any | null> {
  if (!orderId) return null;
  if (isOnline()) {
    try {
      // OrdersApi.full is the canonical "give me one order with the
      // shapes the detail screen expects" endpoint. Live on web too.
      // We hit DbApi for offline parity because DataContext seeds the
      // list with DbApi.orders() — same key, same shape. Re-keying
      // would invite shape-drift bugs.
      const list = await DbApi.orders();
      const all = Array.isArray(list) ? list : [];
      const row = all.find((r) => String(r.id ?? r.order_id) === String(orderId));
      if (row) {
        await writeOne(row);
        return row;
      }
    } catch (_e) {
      // fall through to cache
    }
  }
  return await readOneCached(orderId);
}

/**
 * Bulk write-through. Called by DataContext after a successful network
 * refresh so the cache always reflects the most recent online state.
 */
export async function primeFromServer(rows: any[]): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const db = await getDb();
  const nowIso = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      const id = pickId(r);
      if (!id) continue;
      const updatedAt = typeof r.updated_at === 'string' ? r.updated_at
                     : typeof r.updatedAt  === 'string' ? r.updatedAt
                     : null;
      await db.runAsync(
        `INSERT INTO cached_orders (id, data, updated_at, cached_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           data       = excluded.data,
           updated_at = excluded.updated_at,
           cached_at  = excluded.cached_at;`,
        id,
        JSON.stringify(r),
        updatedAt,
        nowIso,
      );
    }
  });
}

/** Drop every cached order. Used on logout. */
export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`DELETE FROM cached_orders;`);
}

/** Number of orders currently in the local cache. */
export async function cachedCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM cached_orders;`,
  );
  return row?.c ?? 0;
}

// ── Internal helpers ────────────────────────────────────────────────

async function writeOne(row: any): Promise<void> {
  const id = pickId(row);
  if (!id) return;
  const db = await getDb();
  const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
  await db.runAsync(
    `INSERT INTO cached_orders (id, data, updated_at, cached_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data       = excluded.data,
       updated_at = excluded.updated_at,
       cached_at  = excluded.cached_at;`,
    id,
    JSON.stringify(row),
    updatedAt,
    new Date().toISOString(),
  );
}

async function readAllCached(): Promise<any[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ data: string }>(
    `SELECT data FROM cached_orders ORDER BY updated_at DESC NULLS LAST;`,
  );
  return rows.map((r) => safeParse(r.data)).filter(Boolean);
}

async function readOneCached(id: string): Promise<any | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>(
    `SELECT data FROM cached_orders WHERE id = ?;`,
    String(id),
  );
  return row ? safeParse(row.data) : null;
}

function pickId(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  const v = row.id ?? row.order_id;
  return v === null || v === undefined ? null : String(v);
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

// ── Test-only internal handles ──────────────────────────────────────

export const _internal = {
  pickId,
  safeParse,
  readAllCached,
  readOneCached,
};
