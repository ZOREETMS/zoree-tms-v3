-- ════════════════════════════════════════════════════════════════════
-- 20260506_role_module_full_catalog.sql
--
-- Builds out the User Roles screen to cover every left-hand nav item.
-- Removes the legacy orders.plan / shipments.edit features, relabels
-- the six original module rows to match sidebar labels, then seeds
-- the remaining ~24 sidebar items as access_features rows grouped by
-- section (Overview / Planning / Execution / Finance / Documents /
-- Integration / Insights / System).
--
-- Also seeds the default role × module access_level matrix for the
-- four system roles (admin / planner / finance / viewer).
--
-- Idempotent. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Remove legacy feature rows (orders.plan / shipments.edit) ─────
DELETE FROM public.role_feature_permissions
 WHERE feature_key IN ('orders.plan', 'shipments.edit');
DELETE FROM public.access_features
 WHERE feature_key IN ('orders.plan', 'shipments.edit');

-- ── 2. Relabel the existing six module rows to match sidebar copy ────
UPDATE public.access_features SET label = 'Item Master',      module = 'Planning',  sort_order = 110, updated_at = now()
 WHERE feature_key = 'items';
UPDATE public.access_features SET label = 'Location Master',  module = 'Planning',  sort_order = 120, updated_at = now()
 WHERE feature_key = 'locations';
UPDATE public.access_features SET label = 'Equipment Master', module = 'Planning',  sort_order = 130, updated_at = now()
 WHERE feature_key = 'equipments';
UPDATE public.access_features SET label = 'Shipments',        module = 'Planning',  sort_order = 140, updated_at = now()
 WHERE feature_key = 'shipments';
UPDATE public.access_features SET label = 'Orders',           module = 'Planning',  sort_order = 150, updated_at = now()
 WHERE feature_key = 'orders';
UPDATE public.access_features SET label = 'Freight Invoices', module = 'Finance',   sort_order = 410, updated_at = now()
 WHERE feature_key = 'invoices';

-- ── 3. Seed the rest of the sidebar nav items as access_features ────
-- Sort orders are striped per section so new items in a section can be
-- inserted between existing rows without reshuffling everything.
INSERT INTO public.access_features (id, tenant_id, feature_key, label, description, module, sort_order, updated_at)
VALUES
  -- Overview ─────────────────────────────────────────────────────────
  ('feature:zoree-default:home',              'zoree-default','home',              'Home',              'Landing page',                                  'Overview',    10,  now()),
  ('feature:zoree-default:dashboard',         'zoree-default','dashboard',         'Dashboard',         'Operational dashboard',                         'Overview',    20,  now()),

  -- Planning ─────────────────────────────────────────────────────────
  ('feature:zoree-default:route_optimizer',   'zoree-default','route_optimizer',   'Route Optimizer',   'Single-shipment route optimization',            'Planning',   160,  now()),
  ('feature:zoree-default:bulk_plan',         'zoree-default','bulk_plan',         'Bulk Plan',         'Bulk planning runs',                            'Planning',   170,  now()),
  ('feature:zoree-default:multi_stop_routes', 'zoree-default','multi_stop_routes', 'Multi-Stop Routes', 'Multi-stop route templates and execution',      'Planning',   180,  now()),
  ('feature:zoree-default:planning_params',   'zoree-default','planning_params',   'Planning Params',   'Planning parameters & constraints',             'Planning',   190,  now()),

  -- Execution ────────────────────────────────────────────────────────
  ('feature:zoree-default:live_tracking',     'zoree-default','live_tracking',     'Live Tracking',     'Real-time shipment tracking',                   'Execution',  210,  now()),
  ('feature:zoree-default:carriers',          'zoree-default','carriers',          'Carriers',          'Carrier directory',                             'Execution',  220,  now()),
  ('feature:zoree-default:carrier_portal',    'zoree-default','carrier_portal',    'Carrier Portal',    'Tender response surface for carriers',          'Execution',  230,  now()),
  ('feature:zoree-default:dock_scheduling',   'zoree-default','dock_scheduling',   'Dock Scheduling',   'Dock door appointment scheduling',              'Execution',  240,  now()),
  ('feature:zoree-default:fleet_management',  'zoree-default','fleet_management',  'Fleet Management',  'Vehicles & drivers',                            'Execution',  250,  now()),
  ('feature:zoree-default:compliance',        'zoree-default','compliance',        'Compliance',        'HOS, weight, hazmat, certifications',           'Execution',  260,  now()),

  -- Finance ──────────────────────────────────────────────────────────
  ('feature:zoree-default:rate_management',   'zoree-default','rate_management',   'Rate Management',   'Carrier rate cards',                            'Finance',    420,  now()),
  ('feature:zoree-default:lane_preferences',  'zoree-default','lane_preferences',  'Lane Preferences',  'Preferred carrier per lane',                    'Finance',    430,  now()),
  ('feature:zoree-default:carrier_bids',      'zoree-default','carrier_bids',      'Carrier Bids',      'RFQ / bid lifecycle',                           'Finance',    440,  now()),
  ('feature:zoree-default:freight_audit',     'zoree-default','freight_audit',     'Freight Audit',     'Invoice variance auditing',                     'Finance',    450,  now()),

  -- Documents ────────────────────────────────────────────────────────
  ('feature:zoree-default:documents',         'zoree-default','documents',         'Documents & BOL',   'BOL, POD, hazmat, invoice docs',                'Documents',  510,  now()),
  ('feature:zoree-default:customer_portal',   'zoree-default','customer_portal',   'Customer Portal',   'Customer-facing visibility',                    'Documents',  520,  now()),

  -- Integration ──────────────────────────────────────────────────────
  ('feature:zoree-default:messaging',         'zoree-default','messaging',         'Messaging Hub',     'Inbound / outbound EDI / API messages',         'Integration', 610, now()),

  -- Insights ─────────────────────────────────────────────────────────
  ('feature:zoree-default:network_modeling',  'zoree-default','network_modeling',  'Network Modeling',  'Network design scenarios',                      'Insights',   710,  now()),
  ('feature:zoree-default:analytics',         'zoree-default','analytics',         'Analytics',         'Spend, performance and KPI analytics',          'Insights',   720,  now()),
  ('feature:zoree-default:reports',           'zoree-default','reports',           'Reports',           'Saved reports & exports',                       'Insights',   730,  now()),
  ('feature:zoree-default:alerts',            'zoree-default','alerts',            'Alerts',            'Operational alerts',                            'Insights',   740,  now()),
  ('feature:zoree-default:db_explorer',       'zoree-default','db_explorer',       'DB Explorer',       'Raw database explorer',                         'Insights',   750,  now()),

  -- System ───────────────────────────────────────────────────────────
  ('feature:zoree-default:user_management',   'zoree-default','user_management',   'User Management',   'Manage users and assignments',                  'System',     810,  now()),
  ('feature:zoree-default:user_roles',        'zoree-default','user_roles',        'User Roles',        'Configure roles and permissions',               'System',     820,  now()),
  ('feature:zoree-default:settings',          'zoree-default','settings',          'Settings',          'Tenant & system settings',                      'System',     830,  now())
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      module      = EXCLUDED.module,
      sort_order  = EXCLUDED.sort_order,
      updated_at  = EXCLUDED.updated_at;

-- ── 4. Seed default role × module access matrix ─────────────────────
-- Strategy: for every (role, feature) pair, derive the level in SQL
-- using CASE on the feature's section + role_key. This keeps the
-- matrix definition in one place and lets us re-run idempotently.
--
-- Levels:
--   admin   → 'edit' everywhere
--   planner → edit Overview/Planning/Execution/Documents/Integration,
--             view Finance/Insights, none on System.
--   finance → view Overview/orders/shipments/Execution/Documents/Integration/Insights,
--             edit Finance, none on Planning master data + System.
--   viewer  → view everywhere except System (none).
INSERT INTO public.role_feature_permissions
  (id, tenant_id, role_key, feature_key, access_level, enabled, updated_at)
SELECT
  'perm:zoree-default:' || r.role_key || ':' || f.feature_key                          AS id,
  'zoree-default'                                                                       AS tenant_id,
  r.role_key                                                                            AS role_key,
  f.feature_key                                                                         AS feature_key,
  CASE
    WHEN r.role_key = 'admin' THEN 'edit'
    WHEN r.role_key = 'planner' THEN
      CASE
        WHEN f.module IN ('Overview','Planning','Execution','Documents','Integration') THEN 'edit'
        WHEN f.module IN ('Finance','Insights') THEN 'view'
        WHEN f.module = 'System' THEN 'none'
        ELSE 'view'
      END
    WHEN r.role_key = 'finance' THEN
      CASE
        WHEN f.module = 'Finance' THEN 'edit'
        WHEN f.feature_key IN ('item_master','location_master','equipment_master','planning_params',
                               'items','locations','equipments') THEN 'none'
        WHEN f.module = 'System' THEN 'none'
        ELSE 'view'
      END
    WHEN r.role_key = 'viewer' THEN
      CASE
        WHEN f.module = 'System' THEN 'none'
        ELSE 'view'
      END
    ELSE 'none'
  END                                                                                   AS access_level,
  CASE
    WHEN r.role_key = 'admin' THEN true
    WHEN r.role_key = 'planner' AND f.module IN ('Overview','Planning','Execution','Documents','Integration') THEN true
    WHEN r.role_key = 'finance' AND f.module = 'Finance' THEN true
    ELSE false
  END                                                                                   AS enabled,
  now()                                                                                 AS updated_at
FROM public.access_roles r
CROSS JOIN public.access_features f
WHERE r.tenant_id = 'zoree-default'
  AND f.tenant_id = 'zoree-default'
  AND r.role_key IN ('admin','planner','finance','viewer')
ON CONFLICT (id) DO UPDATE
  SET access_level = EXCLUDED.access_level,
      enabled      = EXCLUDED.enabled,
      updated_at   = EXCLUDED.updated_at;

COMMIT;
