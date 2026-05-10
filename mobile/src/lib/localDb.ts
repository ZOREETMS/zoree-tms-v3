// ═══════════════════════════════════════════════════════════════════
// localDb — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Thin wrapper around expo-sqlite that owns:
//   • The shared on-device DB handle (singleton, async).
//   • Schema versioning via PRAGMA user_version (mirrors the
//     "no ad-hoc schema, versioned migrations" rule from
//     docs/zoree_db_rules.pdf — applied to local SQLite, not just
//     the server-side Postgres).
//   • The three tables the offline-first layer needs:
//       cached_orders     — read-through cache for orders.
//       cached_shipments  — read-through cache for shipments.
//       write_queue       — pending writes when offline.
//       sync_metadata     — key/value store for last-sync timestamps, etc.
//
// The repositories (services/offline/ordersRepo.ts,
// services/offline/shipmentsRepo.ts) and the writeQueue service own
// the SQL for their respective tables. This module owns nothing
// domain-specific.
//
// Test mode
// ─────────
// Tests can call openInMemory() to get an isolated DB they fully
// control. expo-sqlite supports the special name ':memory:' which
// keeps the DB in process memory and disappears on close — perfect
// for the "real DB, not mocks" rule from feedback_db_rules memory.
// ═══════════════════════════════════════════════════════════════════

import * as SQLite from 'expo-sqlite';

// ── Constants ───────────────────────────────────────────────────────

/** Production DB filename. Co-located with other Expo app data. */
const DB_FILENAME = 'zoree-tms-offline.db';

/**
 * Current expected schema version. Bumped whenever a SQL migration
 * is added to {@link runMigrations}. Existing devices migrate from
 * their stored PRAGMA user_version up to this number on first open
 * after an app update.
 */
export const SCHEMA_VERSION = 1;

// ── Module-singleton state ──────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;
let _opening: Promise<SQLite.SQLiteDatabase> | null = null;

// ── Schema migrations ───────────────────────────────────────────────

/**
 * Apply pending migrations to bring `db` up to {@link SCHEMA_VERSION}.
 *
 * The migration runner is intentionally simple: each version owns one
 * SQL block. To bump the schema, append a new `if (from < N)` block
 * AND increment {@link SCHEMA_VERSION}. Migrations are applied inside
 * an explicit transaction so a failure rolls back cleanly.
 *
 * Mirrors the server-side discipline from api/migrations/*.sql.
 */
async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version;',
  );
  const from = versionRow?.user_version ?? 0;
  if (from >= SCHEMA_VERSION) return;

  await db.withTransactionAsync(async () => {
    if (from < 1) {
      // Schema v1: initial offline tables.
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS sync_metadata (
          key   TEXT PRIMARY KEY,
          value TEXT
        );

        CREATE TABLE IF NOT EXISTS cached_orders (
          id          TEXT PRIMARY KEY,
          data        TEXT NOT NULL,
          updated_at  TEXT,
          cached_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cached_orders_updated_at
          ON cached_orders(updated_at);

        CREATE TABLE IF NOT EXISTS cached_shipments (
          id          TEXT PRIMARY KEY,
          data        TEXT NOT NULL,
          updated_at  TEXT,
          cached_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_cached_shipments_updated_at
          ON cached_shipments(updated_at);

        CREATE TABLE IF NOT EXISTS write_queue (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type     TEXT    NOT NULL,
          entity_id       TEXT    NOT NULL,
          operation       TEXT    NOT NULL,
          payload         TEXT    NOT NULL,
          base_version    TEXT,
          enqueued_at     TEXT    NOT NULL,
          last_attempt_at TEXT,
          attempts        INTEGER NOT NULL DEFAULT 0,
          status          TEXT    NOT NULL DEFAULT 'pending',
          error_message   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_write_queue_status
          ON write_queue(status, enqueued_at);
        CREATE INDEX IF NOT EXISTS idx_write_queue_entity
          ON write_queue(entity_type, entity_id, status);
      `);
    }

    // Bump version inside the same transaction so an aborted upgrade
    // doesn't leave us with a fresh schema and an old PRAGMA value.
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  });
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Open (or return the cached handle to) the production DB. Async; the
 * first call kicks off the open + migrations. Subsequent calls reuse
 * the same handle.
 *
 * Throws only on programmer errors (e.g. expo-sqlite not linked).
 * Failures inside migrations bubble up to the caller — the offline
 * layer should treat that as "no local cache available" rather than
 * crashing the app.
 */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_opening) return _opening;
  _opening = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_FILENAME);
    await runMigrations(db);
    _db = db;
    return db;
  })();
  try {
    return await _opening;
  } finally {
    _opening = null;
  }
}

/**
 * Tests: open a fresh in-memory DB and run migrations against it.
 * Each call produces an independent DB. The returned handle is also
 * stored in the module singleton so any subsequent getDb() call in
 * the same test process reuses it — call resetForTest() to flush.
 */
export async function openInMemoryForTest(): Promise<SQLite.SQLiteDatabase> {
  // expo-sqlite uses ':memory:' as a magic filename for an in-process
  // DB that disappears on close. Each call to openDatabaseAsync(':memory:')
  // gives a new instance.
  const db = await SQLite.openDatabaseAsync(':memory:');
  await runMigrations(db);
  _db = db;
  return db;
}

/**
 * Reset the module singleton without closing the underlying handle.
 * Used between tests to ensure the next getDb() picks up the fresh
 * in-memory instance.
 */
export function resetForTest(): void {
  _db = null;
  _opening = null;
}

// ── Test-only internal handles ──────────────────────────────────────

export const _internal = {
  runMigrations,
  DB_FILENAME,
};
