-- ═══════════════════════════════════════════════════════════════════
-- Migration: Drop unused anon_insert policy on trial_signups
-- Date:      2026-04-25
-- Author:    Sridhar
-- Reason:    The earlier 20260425_fix_rls_advisor_errors.sql migration
--            added an `anon_insert` policy on `public.trial_signups`
--            on the assumption that the marketing landing page wrote
--            directly to Supabase with the anon key. Verified after
--            the fact that this is not the case — `marketing/index.html`
--            POSTs to the Express endpoint `/api/trial-signup`
--            (api/server.js:315), which uses the service role via
--            `dbUpsert`. There is no anon-key path to `trial_signups`
--            anywhere in the repo.
--
--            Dropping the policy removes the
--            `rls_policy_always_true` advisor warning without needing
--            any data-shape constraint workaround.
--
-- Affected APIs / services / UI:
--   • marketing/index.html  — unaffected (uses /api/trial-signup).
--   • api/server.js POST /api/trial-signup — unaffected (service role
--     bypasses RLS regardless of policies).
--
-- Rollback (if anon writes are ever needed again):
--   CREATE POLICY anon_insert ON public.trial_signups
--     FOR INSERT TO anon
--     WITH CHECK (
--       char_length(email) BETWEEN 5 AND 254
--       AND email LIKE '%@%.%'
--       AND char_length(first_name) BETWEEN 1 AND 100
--       AND char_length(last_name)  BETWEEN 1 AND 100
--       AND char_length(company)    BETWEEN 1 AND 200
--       AND status = 'pending'
--       AND source = 'landing_page'
--     );
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS anon_insert ON public.trial_signups;

COMMIT;
