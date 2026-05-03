# Fusion ↔ TMS Integration — Data Model Changes

**Migrations (apply in order):**
1. `supabase/migrations/20260502_fusion_integration.sql` — columns, new tables, indexes.
2. `supabase/migrations/20260502_fusion_integration_constraints.sql` — DB-rule compliance pass: CHECK constraints (Data Integrity rule 4), missing audit cols (Schema rule 5), justifying comments on JSONB / polymorphic columns (Schema rules 1 & 3).

**Status:** Forward-only. No destructive backfill. Safe to deploy with no downtime. Both migrations use `IF NOT EXISTS` and `NOT VALID` + `VALIDATE` for constraints, so they are idempotent and never block writes during deploy.

This file is the canonical 8-item DB checklist required by `docs/zoree_db_rules.pdf`. The actual DDL lives in the migration file referenced above.

---

## 1. Schema changes (DDL summary)

**Existing tables — additive columns only:**

| Table | Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|---|
| `orders` | `fusion_so_header_id` | `text` | yes | `null` | Fusion `HeaderId` for the source SO. |
| `orders` | `fusion_shipment_request_id` | `text` | yes | `null` | Fusion `ShipmentRequestId` (DOO). |
| `orders` | `fusion_business_unit_id` | `text` | yes | `null` | For tenant resolution + reporting. |
| `shipments` | `fusion_shipment_id` | `text` | yes | `null` | Fusion-side shipment once F3 has pushed status. |
| `items` | `fusion_item_id` | `text` | yes | `null` | UNIQUE (per tenant) when present. |
| `items` | `fusion_organization_id` | `text` | yes | `null` | Fusion inventory org. |
| `locations` | `fusion_location_id` | `text` | yes | `null` | Fusion organization or subinventory. |
| `locations` | `fusion_organization_code` | `text` | yes | `null` | Human code (e.g. `M1`). |
| `carriers` | `fusion_carrier_id` | `text` | yes | `null` | Source carrier id from Fusion. |

**Existing controlled-value extension:**

- `orders.sync_source` already accepts `'oms'` (REQ-01). Add `'fusion'` as an accepted value. No DB-level constraint to alter — the column is `text` today; the controlled list is enforced at the service layer.

> **Tenancy note.** This repo does multi-tenancy by separate Supabase project per tenant (`api/services/supabase.js`). None of the existing tables have a `tenant_id` column, and this migration does **not** add one. The `tenant_id` column on `integration_event_log` is just a free-text label for filtering ledger queries — it does not participate in any unique key.

**New tables:**

```sql
create table integration_event_log (
  id              bigserial primary key,
  source          text        not null,           -- 'fusion'
  object_type     text        not null,           -- 'sales_order' | 'shipment_request' | 'inventory_txn' | 'on_hand_snapshot' | 'item' | 'location' | 'carrier' | 'shipment_status' | 'pod'
  direction       text        not null,           -- 'inbound' | 'outbound'
  external_id     text,                           -- Fusion-side natural key
  internal_id     text,                           -- TMS id once resolved
  oic_instance_id text,                           -- OIC tracking id
  status          text        not null,           -- 'received' | 'processed' | 'failed_4xx' | 'failed_5xx' | 'replayed'
  error           text,
  payload         jsonb       not null,           -- raw inbound payload OR outbound request body
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  tenant_id       text,
  unique (source, oic_instance_id)                -- idempotency key
);

create index idx_iel_external on integration_event_log (source, object_type, external_id);
create index idx_iel_status   on integration_event_log (status, received_at desc);

create table integration_watermark (
  source        text not null,
  object_type   text not null,
  cursor_value  timestamptz,                       -- Fusion last-updated watermark
  cursor_token  text,                              -- alt cursor (e.g. nextPageToken)
  updated_at    timestamptz not null default now(),
  primary key (source, object_type)
);
```

Both tables get standard audit cols (`received_at` / `updated_at`) per Zoree DB rule 4.

## 2. Migration file(s)

- `supabase/migrations/20260502_fusion_integration.sql` — single forward migration. Contains:
  - `ALTER TABLE` for each new column (all `IF NOT EXISTS`).
  - `CREATE TABLE` for the two new tables (`IF NOT EXISTS`).
  - `CREATE INDEX` statements, all `IF NOT EXISTS`.
  - `COMMENT ON COLUMN ...` for each new column so the DB Explorer surfaces the doc.

No data migration in this file. See item 3.

## 3. Backfill / data migration needs

**None at deploy time.** All new columns are nullable; existing rows simply have `null` until/unless they're rebound to a Fusion record.

If a tenant later cuts over from OMS to Fusion, a one-shot mapping job will populate `fusion_so_header_id` for already-existing TMS orders by joining on `oms_order_ref` → Fusion via OIC lookup. That job is out of scope for this migration; it gets its own ticket once a tenant requests cutover.

## 4. Index changes

- `idx_iel_external` — supports the per-object lookup we do in `markProcessed()` and the replay path.
- `idx_iel_status` — supports the ops query "show me everything in `failed_5xx` for the last 24h".
- No new indexes on `orders` / `shipments` / `items` etc. The `fusion_*_id` columns are looked up by service code only on the inbound path, where the volume is bounded by OIC throughput and the existing `id` PK index is sufficient.

We will add `idx_orders_fusion_so_header_id` later **if** we observe slow lookups in production (Zoree DB rule 7 — no speculative indexes).

## 5. Constraint changes

- `unique (source, oic_instance_id)` on `integration_event_log` — idempotency contract. If OIC retries an instance, the `INSERT` fails with `23505`, and the service treats that as a no-op (already processed).
- **Controlled-value CHECK constraints** on `integration_event_log` (added in the constraints migration, Data Integrity rule 4):
  - `source IN ('fusion','oms')`
  - `direction IN ('inbound','outbound')`
  - `status IN ('received','processed','failed_4xx','failed_5xx','replayed')`
  - `object_type IN ('sales_order','shipment_request','inventory_txn','on_hand_snapshot','item','location','carrier','shipment_status','pod','freight_invoice')`
  Each constraint is added with `NOT VALID` then `VALIDATE`d — deployment-safe even on a populated table.
- No new FKs against `orders` / `shipments` from `integration_event_log.internal_id` — the column is a polymorphic soft pointer (different `object_type` values resolve to different tables). Postgres does not support polymorphic FKs, and a hard FK would block writes for poison-message audit rows. Documented in a `COMMENT ON COLUMN`.
- `payload` is `JSONB` — justified denormalization (Schema rule 3) because the wire payload is polymorphic per `object_type` and intentionally immutable for replay. Documented in a `COMMENT ON COLUMN`.

## 6. Rollback considerations

The migration is reversible by:

```sql
drop table if exists integration_watermark;
drop table if exists integration_event_log;

alter table orders     drop column if exists fusion_so_header_id;
alter table orders     drop column if exists fusion_shipment_request_id;
alter table orders     drop column if exists fusion_business_unit_id;
alter table shipments  drop column if exists fusion_shipment_id;
alter table items      drop column if exists fusion_item_id;
alter table items      drop column if exists fusion_organization_id;
alter table locations  drop column if exists fusion_location_id;
alter table locations  drop column if exists fusion_organization_code;
alter table carriers   drop column if exists fusion_carrier_id;
```

A rollback statement is included as a commented-out block at the bottom of the migration file. We don't auto-run it — Zoree DB rule 1 says forward-only, and a rollback would discard ledger rows (which may be needed for audit). The rollback should only ever be used in pre-prod environments.

## 7. Affected APIs / services / UI

**Middleware (new — extracted, reusable):**

- `api/middleware/requireIngestKey.js` — single source of truth for ingest auth (was duplicated inline in `api/routes/ingest.js`; CLAUDE_RULES §13 anti-pattern).
- `api/middleware/asyncRoute.js` — async error wrapper that converts thrown service errors to normalized JSON 4xx/5xx responses, eliminating per-route try/catch boilerplate (CLAUDE_RULES §6).

**API (new):**

- `POST /api/ingest/fusion/sales-orders`
- `POST /api/ingest/fusion/shipment-requests`
- `POST /api/ingest/fusion/inventory/transactions`
- `POST /api/ingest/fusion/inventory/on-hand`
- `POST /api/ingest/fusion/items`
- `POST /api/ingest/fusion/locations`
- `POST /api/ingest/fusion/carriers`
- `POST /api/integration/fusion/replay`           (admin replay from `integration_event_log`)

**Services (new):**

- `api/services/fusionIngest/{index,orders,inventory,masterData}.js`
- `api/services/fusionPublisher/{index,transformer,retryQueue}.js`

**Services (extended):** none. Existing `eventBus`, `changeHistory`, `omsSync`, `shipConfirm`, `shipmentEvents` are reused as-is.

**UI:** no immediate change. A future "Integrations" admin tab will read `integration_event_log` for ops dashboards — out of scope for this delivery. Existing History tab automatically shows `metadata.via = 'fusion-oic'` rows because `changeHistory` is the single writer.

## 8. Risks and assumptions

**Risks**

- *Cardinality of `integration_event_log`*. At full F1+F2+F3 throughput, this could grow to 10s of millions of rows/year. Mitigation: archive job (out of scope) that moves rows older than 90 days to a `_archive` table, plus cold-storage export. The schema is designed so that pruning is safe (no FKs in).
- *Tenant isolation in master data*. Multi-tenancy in this repo is per-Supabase-project (see `api/services/supabase.js`'s `getClient(tenantConfig)`), not row-level — none of `items` / `locations` / `carriers` carry a `tenant_id` column. The unique index on `items.fusion_item_id` is therefore global within a single Supabase project (which IS one tenant). If row-level tenancy is added later, this index must be re-cut as `(tenant_id, fusion_item_id)`.
- *Concurrent replay*. If two replays run for the same `oic_instance_id`, the unique constraint protects us — but the second replay returns `23505`. The replay endpoint must catch and surface "already processed" cleanly (handled in service code).

**Assumptions**

- Fusion `HeaderId` and `ShipmentRequestId` fit in `text` (they're numeric in Fusion but we stringify at OIC).
- OIC's `instance_id` is unique per delivery attempt (yes — confirmed in the OIC docs).
- Existing `orders.sync_source` writers do not enforce a controlled list at the DB layer (verified — column is `text`, no CHECK constraint).
- We do not need to re-broadcast Fusion-sourced orders to the OMS middleware. Fusion replaces OMS for tenants on this integration; for tenants on both, a future routing rule will be added.

**If any assumption above is wrong, stop and renegotiate before applying the migration.**

---

## Appendix — Sample DDL (excerpt)

The full statements are in the migration file. Excerpt for review:

```sql
-- 1) Orders: source-of-truth pointers to Fusion
alter table orders
  add column if not exists fusion_so_header_id        text,
  add column if not exists fusion_shipment_request_id text,
  add column if not exists fusion_business_unit_id    text;
comment on column orders.fusion_so_header_id        is 'Fusion OM HeaderId for the SO that produced this order.';
comment on column orders.fusion_shipment_request_id is 'Fusion DOO ShipmentRequestId, when the source is a shipment request rather than the SO header.';
comment on column orders.fusion_business_unit_id    is 'Fusion BusinessUnit id; used by OIC to map → TMS tenant_id.';

-- 2) Items: per-tenant Fusion mapping
alter table items
  add column if not exists fusion_item_id         text,
  add column if not exists fusion_organization_id text;
create unique index if not exists ux_items_tenant_fusion_item
  on items(tenant_id, fusion_item_id)
  where fusion_item_id is not null;

-- 3) Integration audit ledger
create table if not exists integration_event_log (
  -- (see full DDL above)
);
```
