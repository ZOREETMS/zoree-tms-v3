/**
 * mobile/src/screens/home/homeModules.ts
 *
 * Module directory shown on the mobile Home screen. Mirrors the web
 * HomePage's `moduleSections` (frontend/src/pages/HomePage.jsx) so a
 * planner moving between web and mobile sees the same taxonomy.
 *
 * Each entry uses { tab, screen } so we can drive a nested
 * navigation.navigate(tab, { screen }) call — same convention the
 * drawer uses (see navigation/drawerNavConfig.ts).
 */

import type { DrawerTabKey } from '../../navigation/drawerNavConfig';

export interface HomeModuleItem {
  tab: DrawerTabKey;
  screen: string;
  icon: string;
  label: string;
  description: string;
}

export interface HomeModuleSection {
  section: string;
  items: HomeModuleItem[];
}

export const HOME_MODULE_SECTIONS: HomeModuleSection[] = [
  {
    section: 'Planning',
    items: [
      { tab: 'PlanningTab', screen: 'Orders',     icon: '🧾', label: 'Order Management',     description: 'Create, track, and manage transportation orders' },
      { tab: 'PlanningTab', screen: 'Shipments',  icon: '📦', label: 'Shipment Management',  description: 'Plan, consolidate, and track shipments' },
      { tab: 'BulkPlanTab', screen: 'BulkPlan',   icon: '⚡', label: 'Bulk Planning',         description: 'Rate and execute shipments in bulk' },
      { tab: 'MultiStopTab', screen: 'MultiStopRoutes', icon: '🛣️', label: 'Multi-Stop Routes', description: 'Define reusable multi-stop route templates' },
    ],
  },
  {
    section: 'Rate & Contract',
    items: [
      { tab: 'FinanceTab', screen: 'RateManagement', icon: '📋', label: 'Rate Management',  description: 'Manage carrier rates and lane pricing' },
      { tab: 'FinanceTab', screen: 'LanePreferences', icon: '⭐', label: 'Lane Preferences', description: 'Set preferred carriers by lane' },
      { tab: 'FinanceTab', screen: 'CarrierBids',     icon: '🎯', label: 'Carrier Bids',     description: 'Create RFQs and manage carrier bids' },
      { tab: 'FinanceTab', screen: 'FreightAudit',    icon: '🔍', label: 'Freight Audit',    description: 'Audit freight invoices for discrepancies' },
    ],
  },
  {
    section: 'Execution',
    items: [
      { tab: 'ExecutionTab', screen: 'Carriers',       icon: '🚛', label: 'Carrier Management', description: 'Manage carrier profiles and contacts' },
      { tab: 'ExecutionTab', screen: 'CarrierPortal',  icon: '🏢', label: 'Carrier Portal',     description: 'Carrier-facing tender acceptance portal' },
      { tab: 'ExecutionTab', screen: 'LiveTracking',   icon: '📡', label: 'Live Tracking',      description: 'Real-time shipment tracking on map' },
      { tab: 'ExecutionTab', screen: 'DockScheduling', icon: '🚪', label: 'Dock Scheduling',    description: 'Manage dock appointments and windows' },
    ],
  },
  {
    section: 'Master Data',
    items: [
      { tab: 'PlanningTab',  screen: 'ItemMaster',      icon: '📦', label: 'Item Master',       description: 'Manage freight items and classifications' },
      { tab: 'PlanningTab',  screen: 'LocationMaster',  icon: '📍', label: 'Location Master',   description: 'Manage pickup and delivery locations' },
      { tab: 'ExecutionTab', screen: 'FleetManagement', icon: '🏎️', label: 'Fleet Management',  description: 'Track vehicles, drivers, and assignments' },
      { tab: 'PlanningTab',  screen: 'RouteOptimizer',  icon: '🗺️', label: 'Route Optimizer',   description: 'Optimize routes and reduce mileage' },
    ],
  },
  {
    section: 'Finance & Compliance',
    items: [
      { tab: 'FinanceTab',   screen: 'FreightInvoices', icon: '💰', label: 'Freight Invoices',  description: 'Process and approve freight invoices' },
      { tab: 'ExecutionTab', screen: 'Compliance',      icon: '⚖️', label: 'Compliance',         description: 'HOS, weight checks, and certifications' },
      { tab: 'DocumentsTab', screen: 'Documents',       icon: '📄', label: 'Documents & BOL',   description: 'Generate and manage shipping documents' },
      { tab: 'DocumentsTab', screen: 'CustomerPortal',  icon: '👁️', label: 'Customer Portal',   description: 'Customer shipment visibility and access' },
    ],
  },
  {
    section: 'Intelligence / Admin',
    items: [
      { tab: 'InsightsTab', screen: 'NetworkModeling', icon: '🌐', label: 'Network Modeling',  description: 'Model and optimize your freight network' },
      { tab: 'InsightsTab', screen: 'Analytics',       icon: '📈', label: 'Analytics',         description: 'Spend analysis and carrier scorecards' },
      { tab: 'InsightsTab', screen: 'Reports',         icon: '📊', label: 'Reports',           description: 'Generate operational and financial reports' },
      { tab: 'InsightsTab', screen: 'Alerts',          icon: '🔔', label: 'Alerts',            description: 'Configure and review system alerts' },
    ],
  },
];
