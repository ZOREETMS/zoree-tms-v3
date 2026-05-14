/**
 * mobile/src/config/roleMatrix.ts — REQ-04 mobile parity.
 *
 * Mirrors frontend/src/config/roleMatrix.js. The web app gates its
 * sidebar with visibleNavLabels(role); mobile previously had no
 * equivalent and showed every drawer entry regardless of the active
 * role (QA #303 — "modules are not changing based on role selection").
 *
 * Recognized roles:
 *   admin   — full access (also the safe fallback when the role string
 *             is unknown, so a new role rolling out doesn't lock anyone
 *             out of mobile until the matrix catches up).
 *   planner — planning + execution + docs + a read slice of finance and
 *             insights.
 *   finance — invoices, rates, lane prefs, bids, audit, docs, analytics.
 *   viewer  — read-only common surfaces (Home, Dashboard, Analytics,
 *             Reports, Alerts) plus the planning + finance read-only
 *             screens; no system/admin access.
 *
 * Labels match drawerNavConfig.ts. The two cosmetic differences with
 * web (Route Optimization vs Route Optimizer; Planning Parameters vs
 * Planning Params) are bridged by LABEL_ALIASES below so canSeeNav
 * works from either side.
 */

export type CanonicalRole = 'admin' | 'planner' | 'finance' | 'viewer';

const COMMON = ['Home', 'Dashboard', 'Settings'];

const PLANNING = [
  'Item Master',
  'Location Master',
  'Equipment Master',
  'Shipments',
  'Orders',
  'Route Optimizer',
  'Bulk Plan',
  'Multi-Stop Routes',
  'Planning Parameters',
];

const EXECUTION = [
  'Live Tracking',
  'Carriers',
  'Carrier Portal',
  'Dock Scheduling',
  'Fleet Management',
  'Compliance',
];

const FINANCE = [
  'Freight Invoices',
  'Rate Management',
  'Lane Preferences',
  'Carrier Bids',
  'Freight Audit',
];

const DOCS = ['Documents & BOL', 'Customer Portal'];

const INTEGRATION = ['Messaging Hub'];

const INSIGHTS = [
  'Network Modeling',
  'Analytics',
  'Reports',
  'Alerts',
  'DB Explorer',
];

const SYSTEM = ['User Roles', 'User Management'];

export const ROLE_NAV: Record<CanonicalRole, string[]> = {
  admin: [
    ...COMMON,
    ...PLANNING,
    ...EXECUTION,
    ...FINANCE,
    ...DOCS,
    ...INTEGRATION,
    ...INSIGHTS,
    ...SYSTEM,
  ],
  planner: [
    ...COMMON,
    ...PLANNING,
    ...EXECUTION,
    ...DOCS,
    'Rate Management',
    'Lane Preferences',
    'Analytics',
    'Reports',
    'Messaging Hub',
  ],
  finance: [
    ...COMMON,
    ...FINANCE,
    'Documents & BOL',
    'Analytics',
    'Reports',
    'Alerts',
  ],
  viewer: [
    ...COMMON,
    'Shipments',
    'Orders',
    'Live Tracking',
    'Documents & BOL',
    'Customer Portal',
    'Analytics',
    'Reports',
    'Alerts',
  ],
};

/**
 * Label aliases — translate drawerNavConfig label variants to the
 * canonical labels used in ROLE_NAV. Keeps the matrix and the drawer
 * config free to evolve independently as long as one entry lands here.
 */
const LABEL_ALIASES: Record<string, string> = {
  'Route Optimization': 'Route Optimizer',
  'Planning Params': 'Planning Parameters',
};

function canonicalLabel(label: string): string {
  return LABEL_ALIASES[label] || label;
}

export function canonicalRole(roleStr: string | null | undefined): CanonicalRole {
  const r = String(roleStr || '').toLowerCase().trim();
  if (r === 'planner') return 'planner';
  if (r === 'finance' || r === 'finance_user' || r === 'finance-user') return 'finance';
  if (r === 'viewer' || r === 'read_only' || r === 'readonly') return 'viewer';
  // Super-admin / dispatcher / unknown all fall through to admin.
  return 'admin';
}

export function visibleNavLabels(role: string | null | undefined): Set<string> {
  return new Set(ROLE_NAV[canonicalRole(role)]);
}

export function canSeeNav(label: string, role: string | null | undefined): boolean {
  return visibleNavLabels(role).has(canonicalLabel(label));
}
