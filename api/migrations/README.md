# Database Migrations

Versioned, forward-only migration files for the ZoreeTMS Supabase database.

## Rules
- All schema changes go through migration files — never ad hoc
- Files are numbered sequentially: `001_`, `002_`, etc.
- Each file includes: description, affected APIs/UI, backfill needs, rollback SQL, risks
- Run migrations via Supabase Dashboard > SQL Editor (copy-paste)
- Document what was run and when

## Migration Log

| # | File | Description | Run Date | Run By |
|---|------|-------------|----------|--------|
| 001 | `001_add_rate_id_to_shipments.sql` | Add rate_id column to shipments | 2026-04-05 | Tulasi |
| 002 | `002_create_documents_table.sql` | Create documents table | _pending_ | _pending_ |
| 003 | `003_create_warehouse_dock_config.sql` | Warehouse dock configuration table | _pending_ | _pending_ |
| 004 | `004_add_dock_issue_to_shipments.sql` | dock_issue column on shipments | _pending_ | _pending_ |
| 005 | `005_add_oms_sync_columns.sql` | REQ-01: sync_source, auto_synced_at, oms_order_ref on orders | 2026-04-16 | Sridhar (SQL Editor) |
| 006 | `006_create_change_history.sql` | REQ-02: change_history table | 2026-04-16 | Sridhar (SQL Editor) |
| 007 | `007_create_user_profiles.sql`  | REQ-08: multi-role user_profiles table | 2026-04-17 | Sridhar |
| 008 | `008_create_invoices_and_carrier_tolerance.sql` | REQ-06: invoices table + carrier tolerance columns | _pending — apply via run-migration.js or SQL Editor_ | _pending_ |
| 009 | `009_change_history_add_invoice.sql` | REQ-06: allow 'invoice' in change_history.entity_type | _pending — apply via run-migration.js or SQL Editor_ | _pending_ |
| 010 | `010_invoices_add_shipment_ids.sql` | REQ-07: shipment_ids[] on invoices for consolidated invoicing | _pending — apply via run-migration.js or SQL Editor_ | _pending_ |
| 018 | `018_req24_ship_from_to_name_columns.sql` | REQ-24: ship_from_name/ship_to_name on orders & shipments; origin_zip/dest_zip on shipments | 2026-04-20 | Sridhar |
| 019 | `019_req24_oms_orders_ship_fields.sql` | REQ-24 (OMS): ship_from_name/city/state + ship_to_name/city/state on oms_orders | 2026-04-20 | Sridhar |
| 020 | `020_req24_drop_origin_location_fk.sql` | REQ-24 (OMS): drop oms_orders_origin_location_fkey so origin_location can hold composed free-text addresses | _pending — apply via run-migration.js or SQL Editor_ | _pending_ |
| 023 | `023_req24_oms_push_tracking_columns.sql` | REQ-24 (OMS): add tms_order_pushed_at / tms_ship_status_pushed_at / tms_pod_pushed_at on oms_orders + partial indexes + backfill. Unblocks inline tender-accept auto-sync (supersedes mistargeted 010_oms_add_tms_push_tracking.sql, which was never applied). | 2026-04-21 | Sridhar |
| 024 | `024_rates_add_equipment.sql` | Add `equipment` column to rates (soft reference to equipment_types.name) + backfill LTL→'LTL' / TL→'Dry Van 53ft'. Unblocks the planner replacing hardcoded LTL_MAX/TL_MAX constants with equipment_types.max_weight. | 2026-04-22 | Claude (Supabase MCP) |
| 025 | `025_shipments_add_equipment.sql` | Add `equipment` column to shipments so the planner can snapshot the rate's trailer onto the shipment row at planning time. No backfill — legacy rows stay NULL. | 2026-04-22 | Claude (Supabase MCP) |

> **Note on the duplicate `010_` filenames:** two files share the `010_` prefix — `010_invoices_add_shipment_ids.sql` (REQ-07, logged above) and `010_oms_add_tms_push_tracking.sql` (never applied; its header wrongly claimed a separate OMS Supabase project). The latter is superseded by `023_…` and kept on disk for history only.
