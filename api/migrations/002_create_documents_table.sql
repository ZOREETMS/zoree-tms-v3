-- Migration: 002_create_documents_table
-- Date: 2026-04-07
-- Author: Claude (AI-assisted)
-- Description: Create documents table to persist BOL, POD, Invoice, and Hazmat documents.
--              Previously, documents only lived in frontend React state and were lost on refresh.
--
-- Schema Change:
--   Table: documents (NEW)
--   Columns: id, type, status, ship, carrier, generated, origin, dest, weight, pieces,
--            mode, bol_type, pickup_date, delivery_date, order_ids, orders, line_items,
--            created_at, updated_at
--
-- Affected APIs/Services/UI:
--   - API: Generic CRUD at /api/db/documents (after adding to ALLOWED whitelist)
--   - Frontend: documentService.js — new fetchDocuments(), saveDocument(), removeDocument()
--   - Frontend: useDocuments.js — fetch on mount, persist on generate/update
--   - Frontend: DocumentsPage.jsx — loading state while fetching
--
-- Backfill: No backfill needed. Existing seed data is frontend-only fallback.
--           New documents created via "Generate BOL" will be persisted going forward.
--
-- Index:
--   - idx_documents_ship: Index on ship column (DocumentsPage filters by shipmentId)
--   - idx_documents_type: Index on type column (DocumentTable type filter dropdown)
--
-- Risks:
--   - None. New table, no existing data affected.
--   - ship is a soft reference (text), not a foreign key — shipments can be deleted
--     without breaking documents.
--   - JSONB columns (order_ids, orders, line_items) store variable-length arrays.
--     For BOL documents these contain order details for the viewer. Acceptable use of
--     JSONB since this is document snapshot data, not relational.
--
-- Rollback:
--   DROP TABLE IF EXISTS documents;

-- Forward migration
CREATE TABLE IF NOT EXISTS documents (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK (type IN ('BOL', 'POD', 'Invoice', 'Hazmat')),
  status          TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Signed', 'Received', 'Filed', 'Pending', 'Sent', 'Draft')),
  ship            TEXT,
  carrier         TEXT,
  generated       TEXT,
  origin          TEXT,
  dest            TEXT,
  weight          NUMERIC,
  pieces          INTEGER,
  mode            TEXT,
  bol_type        TEXT,
  pickup_date     TEXT,
  delivery_date   TEXT,
  order_ids       JSONB DEFAULT '[]'::jsonb,
  orders          JSONB DEFAULT '[]'::jsonb,
  line_items      JSONB DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_documents_ship ON documents (ship);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents (type);

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_documents_updated_at ON documents;
CREATE TRIGGER trg_documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_documents_updated_at();

-- Documentation
COMMENT ON TABLE documents IS 'Persisted shipping documents: BOL, POD, Invoice, Hazmat. Generated via Documents page.';
COMMENT ON COLUMN documents.ship IS 'Shipment ID reference (e.g. SHP-2026-8910). Soft reference, no FK.';
COMMENT ON COLUMN documents.order_ids IS 'JSONB array of order IDs linked to this document.';
COMMENT ON COLUMN documents.orders IS 'JSONB snapshot of order objects at document generation time.';
COMMENT ON COLUMN documents.line_items IS 'JSONB snapshot of order line items at document generation time.';
