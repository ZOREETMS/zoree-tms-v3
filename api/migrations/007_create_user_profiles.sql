-- Migration: 007_create_user_profiles
-- Date: 2026-04-16
-- Author: Claude (AI-assisted)
-- Description: REQ-08 multi-role user management.
--              Introduces a `user_profiles` table that is the source of
--              truth for a user's assigned roles and the "active" role
--              currently selected in the UI. Supabase's auth.users
--              table remains the source of truth for credentials; this
--              table stores only the role + display information needed
--              by the TMS.
--
-- Affected APIs/UI:
--   api/routes/users.js (NEW)           — GET/POST/PATCH/DELETE /api/users
--   api/services/userManagement.js (NEW) — business logic wrapping
--                                          Supabase auth admin + this table
--   api/server.js                        — /api/auth/login, /api/auth/me
--                                          now return { roles, activeRole };
--                                          new PATCH /api/auth/active-role
--   frontend/src/state/AuthContext.jsx   — user.roles, user.activeRole,
--                                          switchRole(role)
--   frontend/src/pages/UserManagementPage.jsx (NEW) — admin-only CRUD UI
--   frontend/src/components/RoleSwitcher.jsx (NEW)  — sidebar role toggle
--
-- Backfill:
--   Inserts a profile row for admin@zoree.io mapping to roles=['admin']
--   with active_role='admin'. Looks the user up by email via
--   auth.users so we don't hard-code a UUID.
--
-- Index changes:
--   + idx_user_profiles_roles (GIN) — supports "who has role X" queries
--   + idx_user_profiles_email       — supports case-insensitive lookup
--
-- Constraint changes:
--   + CHECK roles only contains values from the whitelist
--   + CHECK active_role is present in roles
--   + FK id -> auth.users(id) ON DELETE CASCADE
--
-- Rollback SQL:
--   DROP INDEX IF EXISTS idx_user_profiles_roles;
--   DROP INDEX IF EXISTS idx_user_profiles_email;
--   DROP TABLE IF EXISTS user_profiles;
--
-- Risks:
--   Low. New table. RLS policies restrict direct reads/writes to the
--   service role — the API is the only writer. Listing users happens
--   server-side via the service key.

CREATE TABLE IF NOT EXISTS user_profiles (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  full_name    TEXT        NULL,
  roles        TEXT[]      NOT NULL DEFAULT ARRAY['viewer']::TEXT[],
  active_role  TEXT        NOT NULL DEFAULT 'viewer',
  tenant_id    TEXT        NULL,
  disabled     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'user_profiles' AND constraint_name = 'user_profiles_roles_whitelist_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_roles_whitelist_check
      CHECK (
        array_length(roles, 1) >= 1
        AND roles <@ ARRAY['admin','planner','finance','viewer']::TEXT[]
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'user_profiles' AND constraint_name = 'user_profiles_active_role_in_roles_check'
  ) THEN
    ALTER TABLE user_profiles
      ADD CONSTRAINT user_profiles_active_role_in_roles_check
      CHECK (active_role = ANY(roles));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_profiles_roles ON user_profiles USING GIN (roles);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles (lower(email));

COMMENT ON TABLE user_profiles IS
  'REQ-08: multi-role assignment per user. roles[] = all roles the user may adopt; active_role = currently-selected role (UI-driven via /api/auth/active-role).';
COMMENT ON COLUMN user_profiles.roles       IS 'Whitelisted subset of admin | planner | finance | viewer';
COMMENT ON COLUMN user_profiles.active_role IS 'Must be a member of roles. Switched via PATCH /api/auth/active-role.';

-- RLS: only the service role touches this table. The API is the broker.
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'user_profiles_self_read' AND tablename = 'user_profiles'
  ) THEN
    -- Each authenticated user can read their own profile.
    CREATE POLICY user_profiles_self_read ON user_profiles
      FOR SELECT TO authenticated
      USING (auth.uid() = id);
  END IF;
END $$;

-- Backfill: seed a profile row for admin@zoree.io if one doesn't already exist.
-- This lets the existing admin continue to sign in without an interruption.
INSERT INTO user_profiles (id, email, full_name, roles, active_role)
SELECT u.id, u.email,
       COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
       ARRAY['admin']::TEXT[],
       'admin'
FROM auth.users u
WHERE lower(u.email) = 'admin@zoree.io'
  AND NOT EXISTS (SELECT 1 FROM user_profiles p WHERE p.id = u.id);
