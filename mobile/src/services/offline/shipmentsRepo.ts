// ═══════════════════════════════════════════════════════════════════
// shipmentsRepo — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Read-through cache for shipments. Mirror of ordersRepo.ts — see
// that file for the full design notes. We keep this file separate
// (rather than parameterizing one Repo helper by table name) because
// the on-disk schema is per-entity, the indexes differ, and a future
// schema-version-2 may need to diverge. The duplication is
// intentional and well-bounded.
// ═══════════════════════════════════════════════════════════════════

// @ts-expect-error — shared/api.js is JS, no .d.ts.
import { DbApi, ShipmentsApi } from '../../lib/api';
import { getDb } from '../../lib/localDb';
import { isOnline } from '../../lib/connectivity';

// ── Public API ──────────────────────────────────────────────────────

export async function listShipments(): Promise<any[]> {
  if (isOnline()) {
    try {
      const rows = await DbApi.shipments();
      const list = Array.isArray(rows) ? rows : [];
      await primeFromServer(list);
      return list;
    } catch (_e) {
      return await readAllCached();
    }
  }
  return await readAllCached();
}

export async function getShipment(shipmentId: string): Promise<any | null> {
  if (!shipmentId) return null;
  if (isOnline()) {
    try {
      // ShipmentsApi.get is the single-row endpoint; for parity with
      // the list-call shape, prefer it over DbApi.shipments() filter
      // for one-off detail fetches.
      const row = await ShipmentsApi.get(shipmentId);
      if (row && typeof row === 'object') {
        await writeOne(row);
        return row;
      }
    } catch (_e) {
      // fall through to cache
    }
  }
  return await readOneCached(shipmentId);
}

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
        `INSERT INTO cached_shipments (id, data, updated_at, cached_at)
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

export async function clearAll(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`DELETE FROM cached_shipments;`);
}

export async function cachedCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) AS c FROM cached_shipments;`,
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
    `INSERT INTO cached_shipments (id, data, updated_at, cached_at)
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
    `SELECT data FROM cached_shipments ORDER BY updated_at DESC NULLS LAST;`,
  );
  return rows.map((r) => safeParse(r.data)).filter(Boolean);
}

async function readOneCached(id: string): Promise<any | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ data: string }>(
    `SELECT data FROM cached_shipments WHERE id = ?;`,
    String(id),
  );
  return row ? safeParse(row.data) : null;
}

function pickId(row: any): string | null {
  if (!row || typeof row !== 'object') return null;
  const v = row.id ?? row.shipment_id;
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
