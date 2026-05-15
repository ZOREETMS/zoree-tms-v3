/**
 * drawerNavConfig — single source of truth for the mobile drawer's
 * collapsible group structure.
 *
 * The mobile drawer used to be a flat list (one row per Drawer.Screen).
 * The product spec (see screenshots reviewed 2026-05-13) calls for
 * collapsible groups: each top-level section (Overview, Planning…)
 * expands to show its sub-screens, mirroring the web sidebar.
 *
 * Cross-tab children are allowed (e.g. Planning → "Bulk Plan" actually
 * lives in BulkPlanTab, and Planning → "Equipment Master" lives in
 * SystemTab). The drawer renderer uses { tab, screen } to drive a
 * nested navigation.navigate(tab, { screen }) call.
 *
 * No screen wiring is changed by this file — every entry below points
 * at a route that already exists in its respective stack
 * (PlanningTabs / BulkPlanTabs / SystemTabs / etc.).
 */
import type { DrawerParamList } from './types';
import type { CanonicalRole } from '../config/roleMatrix';

export type DrawerTabKey = keyof DrawerParamList;

export interface DrawerNavItem {
  /** Visible label, Title Case. */
  label: string;
  /** Optional emoji/icon shown next to the child label. */
  icon?: string;
  /** Drawer tab that owns the destination screen. */
  tab: DrawerTabKey;
  /** Screen name inside that tab's stack navigator. */
  screen: string;
}

export interface DrawerNavGroup {
  /** Stable key used for expand/collapse state + active highlighting. */
  key: string;
  /** Uppercase group label (matches the screenshots). */
  label: string;
  /** Emoji shown on the group header. */
  icon: string;
  /**
   * Drawer tab the group header binds to. Used for active-state
   * highlighting and to pick a sensible "first" screen when the user
   * taps the header on a group with a single child.
   */
  tab: DrawerTabKey;
  /**
   * Child rows shown when the group is expanded. A group with a single
   * child still renders the dropdown — keeps the visual rhythm uniform
   * across the drawer (every section is a collapsible group).
   */
  children: DrawerNavItem[];
  /**
   * QA #331/#332/#338 — optional whitelist of canonical roles allowed to
   * see this entire group. Used to hide admin-only groups like System
   * even when individual children (e.g. Settings) would otherwise be
   * visible to every role via the common nav whitelist. Omitted on most
   * groups, which means "every role that has at least one child visible
   * can see the group".
   */
  restrictedToRoles?: CanonicalRole[];
}

/**
 * Group layout matches the product screenshots from 2026-05-13.
 * Notable cross-tab placements:
 *   - Planning → Equipment Master  → SystemTab / EquipmentMaster
 *   - Planning → Bulk Plan         → BulkPlanTab / BulkPlan
 * These keep the drawer label organization product-friendly without
 * having to restructure the underlying stack navigators.
 */
export const DRAWER_GROUPS: DrawerNavGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    icon: '📊',
    tab: 'OverviewTab',
    children: [
      { label: 'Home', icon: '🏠', tab: 'OverviewTab', screen: 'Home' },
      { label: 'Dashboard', icon: '🗂️', tab: 'OverviewTab', screen: 'Dashboard' },
    ],
  },
  {
    key: 'planning',
    label: 'Planning',
    icon: '🧾',
    tab: 'PlanningTab',
    children: [
      { label: 'Item Master', icon: '📋', tab: 'PlanningTab', screen: 'ItemMaster' },
      // QA #271 — module label corrected from "Location Material" to "Location Master".
      { label: 'Location Master', icon: '📍', tab: 'PlanningTab', screen: 'LocationMaster' },
      // Equipment Master is registered under SystemTab's stack; surface
      // it under Planning to match the product taxonomy.
      { label: 'Equipment Master', icon: '🚚', tab: 'SystemTab', screen: 'EquipmentMaster' },
      { label: 'Shipments', icon: '📦', tab: 'PlanningTab', screen: 'Shipments' },
      { label: 'Orders', icon: '🛒', tab: 'PlanningTab', screen: 'Orders' },
      { label: 'Route Optimization', icon: '🧭', tab: 'PlanningTab', screen: 'RouteOptimizer' },
      // Bulk Plan is its own drawer-level stack; surfaced under Planning.
      { label: 'Bulk Plan', icon: '⚡', tab: 'BulkPlanTab', screen: 'BulkPlan' },
      // QA #277 — Planning Parameters lives in SystemTab's stack but the
      // product taxonomy wants it visible under Planning. Cross-tab
      // placement (same pattern as Equipment Master above).
      { label: 'Planning Parameters', icon: '🛠️', tab: 'SystemTab', screen: 'PlanningParameters' },
    ],
  },
  {
    key: 'multistop',
    label: 'Multi-Stop Routes',
    icon: '🛣️',
    tab: 'MultiStopTab',
    children: [
      { label: 'Multi-Stop Routes', icon: '🛣️', tab: 'MultiStopTab', screen: 'MultiStopRoutes' },
    ],
  },
  {
    key: 'execution',
    label: 'Execution',
    icon: '📡',
    tab: 'ExecutionTab',
    children: [
      { label: 'Live Tracking', icon: '📡', tab: 'ExecutionTab', screen: 'LiveTracking' },
      { label: 'Carriers', icon: '🚛', tab: 'ExecutionTab', screen: 'Carriers' },
      { label: 'Carrier Portal', icon: '🪪', tab: 'ExecutionTab', screen: 'CarrierPortal' },
      { label: 'Dock Scheduling', icon: '🏗️', tab: 'ExecutionTab', screen: 'DockScheduling' },
      { label: 'Fleet Management', icon: '🚐', tab: 'ExecutionTab', screen: 'FleetManagement' },
      { label: 'Compliance', icon: '✅', tab: 'ExecutionTab', screen: 'Compliance' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    icon: '💰',
    tab: 'FinanceTab',
    children: [
      { label: 'Freight Invoices', icon: '🧾', tab: 'FinanceTab', screen: 'FreightInvoices' },
      { label: 'Rate Management', icon: '💵', tab: 'FinanceTab', screen: 'RateManagement' },
      { label: 'Lane Preferences', icon: '⭐', tab: 'FinanceTab', screen: 'LanePreferences' },
      { label: 'Carrier Bids', icon: '📨', tab: 'FinanceTab', screen: 'CarrierBids' },
      { label: 'Freight Audit', icon: '🔎', tab: 'FinanceTab', screen: 'FreightAudit' },
    ],
  },
  {
    key: 'documents',
    label: 'Documents',
    icon: '📄',
    tab: 'DocumentsTab',
    children: [
      // QA #289 — module label corrected from "Documents" to "Documents & BOL".
      { label: 'Documents & BOL', icon: '📄', tab: 'DocumentsTab', screen: 'Documents' },
      { label: 'Customer Portal', icon: '🌐', tab: 'DocumentsTab', screen: 'CustomerPortal' },
    ],
  },
  {
    key: 'integration',
    label: 'Integration',
    icon: '📨',
    tab: 'IntegrationTab',
    children: [
      { label: 'Messaging Hub', icon: '💬', tab: 'IntegrationTab', screen: 'MessagingHub' },
    ],
  },
  {
    key: 'insights',
    label: 'Insights',
    icon: '📈',
    tab: 'InsightsTab',
    children: [
      // QA #293 — Network Modeling first, then Analytics, to mirror web order.
      { label: 'Network Modeling', icon: '🕸️', tab: 'InsightsTab', screen: 'NetworkModeling' },
      { label: 'Analytics', icon: '📊', tab: 'InsightsTab', screen: 'Analytics' },
      { label: 'Reports', icon: '📑', tab: 'InsightsTab', screen: 'Reports' },
      { label: 'Alerts', icon: '🔔', tab: 'InsightsTab', screen: 'Alerts' },
      { label: 'DB Explorer', icon: '🗄️', tab: 'InsightsTab', screen: 'DbExplorer' },
    ],
  },
  {
    // QA #298 — group renamed from "Settings" to "System" and originally
    // trimmed to three children (User Management, User Roles, Settings)
    // to match the web information architecture. Profile remains a
    // registered screen in SystemTab — reachable from header/account
    // chip — but is no longer surfaced as a drawer row. Planning
    // Parameters moved under the Planning group (QA #277).
    //
    // QA #331/#332/#338 — System is now admin-only. Settings was lifted
    // out into its own group below so non-admin roles (planner, finance,
    // viewer) keep drawer access to Settings while losing the System
    // header. Web hides the analogous System section for non-admins via
    // the DB-driven role_feature_permissions matrix; mobile does it
    // structurally via restrictedToRoles, since the drawer doesn't pull
    // that matrix today.
    key: 'system',
    label: 'System',
    icon: '⚙️',
    tab: 'SystemTab',
    restrictedToRoles: ['admin'],
    children: [
      { label: 'User Management', icon: '👥', tab: 'SystemTab', screen: 'UserManagement' },
      { label: 'User Roles', icon: '🛡️', tab: 'SystemTab', screen: 'UserRoles' },
    ],
  },
  {
    // QA #331/#332/#338 — Settings split out of the System group so
    // every role (admin/planner/finance/viewer) can still reach it from
    // the drawer once System becomes admin-only. Same single-child
    // pattern as the Multi-Stop Routes group above. The Settings screen
    // itself still lives in SystemTab's stack — only its surface in the
    // drawer moved.
    key: 'settings',
    label: 'Settings',
    icon: '⚙️',
    tab: 'SystemTab',
    children: [
      { label: 'Settings', icon: '⚙️', tab: 'SystemTab', screen: 'Settings' },
    ],
  },
];
