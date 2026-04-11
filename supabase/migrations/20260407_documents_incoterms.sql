-- =============================================================================
-- Migration: 20260407_documents_incoterms
-- Purpose:   Add incoterms field to documents table so BOL snapshots persist
--            the trade terms from the linked order at generation time.
-- =============================================================================
--
-- Schema Changes:
--   - incoterms (text, nullable): Trade terms snapshot (e.g. "FOB ORIGIN")
--
-- Backfill/Data Migration: None required. Existing documents will have NULL.
--   Regenerating a BOL will populate the field from the linked order.
--
-- Rollback:
--   ALTER TABLE public.documents DROP COLUMN IF EXISTS incoterms;
--
-- Affected APIs/Services/UI:
--   - Service: documentService.js — docToDb/dbToDoc maps incoterms
--   - Service: documentService.js — generateBOLForShipment() snapshots incoterms
--   - UI: BOLDocument.jsx — displays incoterms in Reference Numbers section
--
-- Risks/Assumptions:
--   - NULL means no incoterms set on the source order
--   - Value is snapshotted at BOL generation time; order edits won't auto-update
-- =============================================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS incoterms text;

COMMENT ON COLUMN public.documents.incoterms IS 'Trade terms snapshot from linked order (e.g. FOB ORIGIN, CIF, EXW)';
