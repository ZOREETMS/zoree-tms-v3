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
