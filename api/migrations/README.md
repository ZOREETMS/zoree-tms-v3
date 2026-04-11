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
