-- ════════════════════════════════════════════════════════════════════
-- 20260505_role_module_access_levels.sql
--
-- Adds a tri-state access level (edit / view / none) to
-- role_feature_permissions and seeds the 4 system roles plus the 6
-- left-hand-menu modules used by the User Roles screen.
--
-- Forward-only. The legacy `enabled` boolean is preserved and
-- backfilled from access_level for one release; a follow-up migration
-- will drop it once all readers are switched.
--
-- Rollback (manual):
--   ALTER TABLE public.role_feature_permissions DROP COLUMN access_level;
--   DELETE FROM public.role_feature_permissions
--     WHERE feature_key IN ('orders','shipments','invoices','items','locations','equipments');
--   DELETE FROM public.access_features
--     WHERE feature_key IN ('orders','shipments','invoices','items','locations','equipments');
--   DELETE FROM public.access_roles WHERE role_key = 'viewer';
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── access_roles: ensure metadata columns exist ──────────────────────
ALTER TABLE public.access_roles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS description  text,
  ADD COLUMN IF NOT EXISTS is_system    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'access_roles_role_key_format'
  ) THEN
    ALTER TABLE public.access_roles
      ADD CONSTRAINT access_roles_role_key_format
      CHECK (role_key ~ '^[a-z][a-z0-9_]*$');
  END IF;
END $$;

-- ── access_features: ensure module column exists ─────────────────────
ALTER TABLE public.access_features
  ADD COLUMN IF NOT EXISTS module      text,
  ADD COLUMN IF NOT EXISTS sort_order  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- ── role_feature_permissions: add access_level tri-state ─────────────
ALTER TABLE public.role_feature_permissions
  ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz NOT NULL DEFAULT now();

-- Backfill: any pre-existing rows with enabled=true become 'edit'.
UPDATE public.role_feature_permissions
   SET access_level = CASE WHEN enabled THEN 'edit' ELSE 'none' END
 WHERE access_level NOT IN ('edit','view','none')
    OR access_level IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'role_feature_permissions_level_check'
  ) THEN
    ALTER TABLE public.role_feature_permissions
      ADD CONSTRAINT role_feature_permissions_level_check
      CHECK (access_level IN ('edit','view','none'));
  END IF;
END $$;

-- ── Index supporting the page's read path ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rfp_tenant_role
  ON public.role_feature_permissions (tenant_id, role_key);

-- ── Seed the 6 left-hand-menu modules for the default tenant ─────────
INSERT INTO public.access_features (id, tenant_id, feature_key, label, description, module, sort_order, updated_at)
VALUES
  ('feature:zoree-default:orders',     'zoree-default', 'orders',     'Orders',     'Order management',     'orders',     10, now()),
  ('feature:zoree-default:shipments',  'zoree-default', 'shipments',  'Shipments',  'Shipment lifecycle',   'shipments',  20, now()),
  ('feature:zoree-default:invoices',   'zoree-default', 'invoices',   'Invoices',   'Freight invoices',     'invoices',   30, now()),
  ('feature:zoree-default:items',      'zoree-default', 'items',      'Items',      'Item master',          'items',      40, now()),
  ('feature:zoree-default:locations',  'zoree-default', 'locations',  'Locations',  'Location master',      'locations',  50, now()),
  ('feature:zoree-default:equipments', 'zoree-default', 'equipments', 'Equipments', 'Equipment master',     'equipments', 60, now())
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      module      = EXCLUDED.module,
      sort_order  = EXCLUDED.sort_order,
      updated_at  = EXCLUDED.updated_at;

-- ── Seed the 4 system roles for the default tenant ───────────────────
INSERT INTO public.access_roles (id, tenant_id, role_key, display_name, description, is_system, is_active, updated_at)
VALUES
  ('role:zoree-default:admin',   'zoree-default', 'admin',   'Admin',        'Full edit access; cannot be modified or deleted', true,  true, now()),
  ('role:zoree-default:planner', 'zoree-default', 'planner', 'Planner',      'Plan orders, shipments and master data',          true,  true, now()),
  ('role:zoree-default:finance', 'zoree-default', 'finance', 'Finance user', 'Owns invoices and finance modules',               true,  true, now()),
  ('role:zoree-default:viewer',  'zoree-default', 'viewer',  'Viewer',       'Read-only across modules',                        true,  true, now())
ON CONFLICT (id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description  = EXCLUDED.description,
      is_system    = EXCLUDED.is_system,
      is_active    = EXCLUDED.is_active,
      updated_at   = EXCLUDED.updated_at;

-- ── Seed the role × module access matrix ─────────────────────────────
-- admin: edit everything
-- planner: edit planning + view finance
-- finance: edit invoices + view orders/shipments + none on master data
-- viewer: view everything
INSERT INTO public.role_feature_permissions
  (id, tenant_id, role_key, feature_key, access_level, enabled, updated_at)
VALUES
  -- admin
  ('perm:zoree-default:admin:orders',     'zoree-default','admin','orders',     'edit', true,  now()),
  ('perm:zoree-default:admin:shipments',  'zoree-default','admin','shipments',  'edit', true,  now()),
  ('perm:zoree-default:admin:invoices',   'zoree-default','admin','invoices',   'edit', true,  now()),
  ('perm:zoree-default:admin:items',      'zoree-default','admin','items',      'edit', true,  now()),
  ('perm:zoree-default:admin:locations',  'zoree-default','admin','locations',  'edit', true,  now()),
  ('perm:zoree-default:admin:equipments', 'zoree-default','admin','equipments', 'edit', true,  now()),
  -- planner
  ('perm:zoree-default:planner:orders',     'zoree-default','planner','orders',     'edit', true,  now()),
  ('perm:zoree-default:planner:shipments',  'zoree-default','planner','shipments',  'edit', true,  now()),
  ('perm:zoree-default:planner:invoices',   'zoree-default','planner','invoices',   'view', false, now()),
  ('perm:zoree-default:planner:items',      'zoree-default','planner','items',      'edit', true,  now()),
  ('perm:zoree-default:planner:locations',  'zoree-default','planner','locations',  'edit', true,  now()),
  ('perm:zoree-default:planner:equipments', 'zoree-default','planner','equipments', 'edit', true,  now()),
  -- finance
  ('perm:zoree-default:finance:orders',     'zoree-default','finance','orders',     'view', false, now()),
  ('perm:zoree-default:finance:shipments',  'zoree-default','finance','shipments',  'view', false, now()),
  ('perm:zoree-default:finance:invoices',   'zoree-default','finance','invoices',   'edit', true,  now()),
  ('perm:zoree-default:finance:items',      'zoree-default','finance','items',      'none', false, now()),
  ('perm:zoree-default:finance:locations',  'zoree-default','finance','locations',  'none', false, now()),
  ('perm:zoree-default:finance:equipments', 'zoree-default','finance','equipments', 'none', false, now()),
  -- viewer
  ('perm:zoree-default:viewer:orders',     'zoree-default','viewer','orders',     'view', false, now()),
  ('perm:zoree-default:viewer:shipments',  'zoree-default','viewer','shipments',  'view', false, now()),
  ('perm:zoree-default:viewer:invoices',   'zoree-default','viewer','invoices',   'view', false, now()),
  ('perm:zoree-default:viewer:items',      'zoree-default','viewer','items',      'view', false, now()),
  ('perm:zoree-default:viewer:locations',  'zoree-default','viewer','locations',  'view', false, now()),
  ('perm:zoree-default:viewer:equipments', 'zoree-default','viewer','equipments', 'view', false, now())
ON CONFLICT (id) DO UPDATE
  SET access_level = EXCLUDED.access_level,
      enabled      = EXCLUDED.enabled,
      updated_at   = EXCLUDED.updated_at;

COMMIT;
