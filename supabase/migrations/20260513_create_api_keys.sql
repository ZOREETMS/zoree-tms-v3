-- ════════════════════════════════════════════════════════════════════
-- 20260513_create_api_keys.sql — QA bug #261c.
--
-- Adds an `api_keys` table so admins can issue programmatic-access
-- tokens (an alternative to a per-user JWT) for integrations, batch
-- jobs, EDI senders, BI exporters, etc. Keys authenticate via
--   Authorization: ApiKey <raw_token>
-- in api/server.js verifyToken(); see api/services/apiKeys.js for the
-- hash + verify path.
--
-- Design notes (kept in sync with the 8-item DB checklist):
--   • Tokens are 256 bits from crypto.randomBytes(32), base64url
--     encoded. Server stores only the sha-256 hash and an 8-char
--     prefix (for UI display — admins see "ze_a3f0c..." in lists).
--     The raw token is returned to the issuer ONCE at create time.
--   • Tenant isolation: stamped at create from the issuer's JWT, not
--     accepted from the request body. Verify path additionally checks
--     key.tenant_id matches the resolved user context.
--   • Soft delete only (revoked_at). A revoked key cannot
--     authenticate but stays in the table for audit and so the same
--     name can be re-used after revocation. Names are not unique.
--   • Role inheritance is MVP-scoped to the four system roles —
--     admin / planner / finance / viewer. A check constraint enforces
--     this so a deleted custom role can't strand a key in an
--     undefined state. If custom-role keys are desired later, drop
--     the check and FK to access_roles.role_key.
--
-- No backfill: new table, no existing data to migrate.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE public.api_keys (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT         NOT NULL,
  name          TEXT         NOT NULL,
  key_prefix    TEXT         NOT NULL,
  key_hash      TEXT         NOT NULL,
  role          TEXT         NOT NULL,
  created_by    UUID         NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ  NULL,
  revoked_at    TIMESTAMPTZ  NULL,
  revoked_by    UUID         NULL REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT chk_api_keys_role
    CHECK (role IN ('admin', 'planner', 'finance', 'viewer')),

  CONSTRAINT uq_api_keys_key_hash
    UNIQUE (key_hash)
);

-- Hot-path lookup: list active keys for a tenant. Partial index so
-- revoked keys (the long tail) don't bloat the working set.
CREATE INDEX idx_api_keys_tenant_active
  ON public.api_keys (tenant_id)
  WHERE revoked_at IS NULL;

-- Verify-path lookup is satisfied by the UNIQUE constraint on
-- key_hash (a unique constraint creates a btree index implicitly), so
-- no separate index is needed.

-- ── updated_at trigger ───────────────────────────────────────────────
-- Mirrors the pattern used by access_roles / access_features. Keeps
-- updated_at honest without requiring every UPDATE call site to set it.
CREATE OR REPLACE FUNCTION public.api_keys_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_api_keys_touch_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.api_keys_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
-- The service role bypasses RLS, and all server-side reads/writes go
-- through the service role (api/server.js uses SERVICE_KEY for
-- elevated operations). Enable RLS as a defence-in-depth measure so a
-- compromised anon/auth token cannot enumerate keys directly. No
-- policies are added — the table is service-role-only by design.
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.api_keys IS
  'Programmatic-access tokens for non-interactive callers. See api/services/apiKeys.js and QA bug #261c.';
COMMENT ON COLUMN public.api_keys.key_prefix IS
  'First 8 chars of the raw token, stored in plaintext so admin UIs can render a stable preview without revealing the secret.';
COMMENT ON COLUMN public.api_keys.key_hash IS
  'sha-256(raw_token), hex-encoded. Raw token is never persisted — it is returned to the issuer exactly once at creation.';
COMMENT ON COLUMN public.api_keys.role IS
  'The role this key authenticates as. Limited to the four system roles by chk_api_keys_role.';
COMMENT ON COLUMN public.api_keys.revoked_at IS
  'Soft-delete tombstone. Non-null means the key cannot authenticate. Set by DELETE /api/api-keys/:id.';
