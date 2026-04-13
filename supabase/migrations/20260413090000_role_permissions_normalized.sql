-- ============================================================
-- Migration: Normalize role permissions model
-- Description: Replaces JSON-based role permissions with relational tables
-- Date: 2026-04-13
-- Affected: Role permissions API, User Roles page, authz checks for order/shipment writes
-- Rollback/Fallback: Keep legacy `system_config.key = role_permissions` untouched for fallback reads
-- ============================================================

-- Feature catalog (controlled values)
CREATE TABLE IF NOT EXISTS access_features (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'zoree-default',
  feature_key   TEXT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT,
  module        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_access_features_tenant_feature UNIQUE (tenant_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_access_features_tenant ON access_features (tenant_id);
CREATE INDEX IF NOT EXISTS idx_access_features_module ON access_features (module);

-- Role catalog
CREATE TABLE IF NOT EXISTS access_roles (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'zoree-default',
  role_key      TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  is_system     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_access_roles_tenant_role UNIQUE (tenant_id, role_key)
);

CREATE INDEX IF NOT EXISTS idx_access_roles_tenant ON access_roles (tenant_id);

-- Role x Feature permission matrix
CREATE TABLE IF NOT EXISTS role_feature_permissions (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'zoree-default',
  role_key      TEXT NOT NULL,
  feature_key   TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_role_feature_permissions_role
    FOREIGN KEY (tenant_id, role_key) REFERENCES access_roles (tenant_id, role_key),
  CONSTRAINT fk_role_feature_permissions_feature
    FOREIGN KEY (tenant_id, feature_key) REFERENCES access_features (tenant_id, feature_key),
  CONSTRAINT uq_role_feature_permissions UNIQUE (tenant_id, role_key, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_role_feature_permissions_tenant_role
  ON role_feature_permissions (tenant_id, role_key);
CREATE INDEX IF NOT EXISTS idx_role_feature_permissions_tenant_feature
  ON role_feature_permissions (tenant_id, feature_key);
CREATE INDEX IF NOT EXISTS idx_role_feature_permissions_enabled
  ON role_feature_permissions (enabled);

-- Seed roles
INSERT INTO access_roles (id, tenant_id, role_key, display_name, is_system)
VALUES
  ('role:zoree-default:admin', 'zoree-default', 'admin', 'Admin', true),
  ('role:zoree-default:planner', 'zoree-default', 'planner', 'Planner', true),
  ('role:zoree-default:dispatcher', 'zoree-default', 'dispatcher', 'Dispatcher', true)
ON CONFLICT (id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    updated_at = now();

-- Seed feature catalog
INSERT INTO access_features (id, tenant_id, feature_key, label, description, module)
VALUES
  (
    'feature:zoree-default:orders.plan',
    'zoree-default',
    'orders.plan',
    'Plan Orders',
    'Create, update, and delete order planning assignments',
    'orders'
  ),
  (
    'feature:zoree-default:shipments.edit',
    'zoree-default',
    'shipments.edit',
    'Edit Shipments',
    'Create, update, and delete shipment records and shipment status',
    'shipments'
  )
ON CONFLICT (id) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description,
    module = EXCLUDED.module,
    updated_at = now();

-- Seed role permissions
INSERT INTO role_feature_permissions (id, tenant_id, role_key, feature_key, enabled)
VALUES
  ('perm:zoree-default:admin:orders.plan', 'zoree-default', 'admin', 'orders.plan', true),
  ('perm:zoree-default:admin:shipments.edit', 'zoree-default', 'admin', 'shipments.edit', true),
  ('perm:zoree-default:planner:orders.plan', 'zoree-default', 'planner', 'orders.plan', true),
  ('perm:zoree-default:planner:shipments.edit', 'zoree-default', 'planner', 'shipments.edit', true),
  ('perm:zoree-default:dispatcher:orders.plan', 'zoree-default', 'dispatcher', 'orders.plan', false),
  ('perm:zoree-default:dispatcher:shipments.edit', 'zoree-default', 'dispatcher', 'shipments.edit', true)
ON CONFLICT (id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    updated_at = now();
