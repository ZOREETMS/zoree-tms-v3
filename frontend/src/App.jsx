import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import OrdersPage from "./pages/OrdersPage";
import ShipmentsPage from "./pages/ShipmentsPage";
import CarriersPage from "./pages/CarriersPage";
import BulkPlanPage from "./pages/BulkPlanPage";
import SettingsPage from "./pages/SettingsPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import LanePreferencesPage from "./pages/LanePreferencesPage";
import ItemMasterPage from "./pages/ItemMasterPage";
import LocationMasterPage from "./pages/LocationMasterPage";
import RateManagementPage from "./pages/RateManagementPage";
import FuelSurchargePage from "./pages/FuelSurchargePage";
import RouteOptimizerPage from "./pages/RouteOptimizerPage";
import LiveTrackingPage from "./pages/LiveTrackingPage";
import DockSchedulingPage from "./pages/DockSchedulingPage";
import CarrierPortalPage from "./pages/CarrierPortalPage";
import CompliancePage from "./pages/CompliancePage";
import FleetManagementPage from "./pages/FleetManagementPage";
import FreightAuditPage from "./pages/FreightAuditPage";
import CarrierBidsPage from "./pages/CarrierBidsPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import CustomerPortalPage from "./pages/CustomerPortalPage";
import FreightInvoicesPage from "./pages/FreightInvoicesPage";
import ReportsPage from "./pages/ReportsPage";
import DocumentsPage from "./pages/DocumentsPage";
import AlertsPage from "./pages/AlertsPage";
import MessagingHubPage from "./pages/MessagingHubPage";
import NetworkModelingPage from "./pages/NetworkModelingPage";
import DbExplorerPage from "./pages/DbExplorerPage";
import MultiStopRoutesPage from "./pages/MultiStopRoutesPage";
import EquipmentMasterPage from "./pages/EquipmentMasterPage";
import PlanningParametersPage from "./pages/PlanningParametersPage";
import HomePage from "./pages/HomePage";
import UserRolesPage from "./pages/UserRolesPage";
import UserManagementPage from "./pages/UserManagementPage";
import PoliciesPage from "./pages/PoliciesPage";
import ApiAccessPage from "./pages/ApiAccessPage";
import { useAuth } from "./state/AuthContext";
import { DbApi } from "./lib/api";
import { fetchDurations as fetchDockLoadingDurations } from "./services/dockLoadingDurationsService";
import RoleGuard from "./components/RoleGuard";

function PrivateRoutes({ data }) {
  return (
    <Routes>
      <Route path="/" element={<Layout data={data} />}>
        <Route index element={<RoleGuard><HomePage /></RoleGuard>} />
        <Route path="dashboard" element={<RoleGuard><DashboardPage /></RoleGuard>} />
        <Route path="orders" element={<RoleGuard><OrdersPage /></RoleGuard>} />
        <Route path="shipments" element={<RoleGuard><ShipmentsPage /></RoleGuard>} />
        <Route path="carriers" element={<RoleGuard><CarriersPage /></RoleGuard>} />
        <Route path="bulk-plan" element={<RoleGuard><BulkPlanPage /></RoleGuard>} />
        <Route path="settings" element={<RoleGuard><SettingsPage /></RoleGuard>} />
        <Route path="user-roles" element={<RoleGuard><UserRolesPage /></RoleGuard>} />
        <Route path="user-management" element={<RoleGuard><UserManagementPage /></RoleGuard>} />
        {/* QA bug #261: Policies tab routes to a read-only
            consolidated view of the role × module permissions matrix.
            API Access is the admin surface for programmatic-access
            keys (Authorization: ApiKey <token>). See
            api/services/apiKeys.js and the 20260513_create_api_keys
            migration. Both pages are gated by RoleGuard — non-admins
            see the role-block fallback. */}
        <Route path="policies"   element={<RoleGuard><PoliciesPage   /></RoleGuard>} />
        <Route path="api-access" element={<RoleGuard><ApiAccessPage /></RoleGuard>} />
        {/* Placeholder pages */}
        <Route path="item-master" element={<RoleGuard><ItemMasterPage /></RoleGuard>} />
        <Route path="location-master" element={<RoleGuard><LocationMasterPage /></RoleGuard>} />
        <Route path="route-optimizer" element={<RoleGuard><RouteOptimizerPage /></RoleGuard>} />
        <Route path="live-tracking" element={<RoleGuard><LiveTrackingPage /></RoleGuard>} />
        <Route path="carrier-portal" element={<RoleGuard><CarrierPortalPage /></RoleGuard>} />
        <Route path="dock-scheduling" element={<RoleGuard><DockSchedulingPage /></RoleGuard>} />
        <Route path="fleet-management" element={<RoleGuard><FleetManagementPage /></RoleGuard>} />
        <Route path="compliance" element={<RoleGuard><CompliancePage /></RoleGuard>} />
        <Route path="freight-invoices" element={<RoleGuard><FreightInvoicesPage /></RoleGuard>} />
        <Route path="rate-management" element={<RoleGuard><RateManagementPage /></RoleGuard>} />
        {/* Migration 045: per-carrier EIA-indexed fuel surcharge schedules */}
        <Route path="fuel-surcharge" element={<RoleGuard><FuelSurchargePage /></RoleGuard>} />
        <Route path="lane-preferences" element={<RoleGuard><LanePreferencesPage /></RoleGuard>} />
        <Route path="carrier-bids" element={<RoleGuard><CarrierBidsPage /></RoleGuard>} />
        <Route path="freight-audit" element={<RoleGuard><FreightAuditPage /></RoleGuard>} />
        <Route path="documents" element={<RoleGuard><DocumentsPage /></RoleGuard>} />
        <Route path="customer-portal" element={<RoleGuard><CustomerPortalPage /></RoleGuard>} />
        <Route path="analytics" element={<RoleGuard><AnalyticsPage /></RoleGuard>} />
        <Route path="reports" element={<RoleGuard><ReportsPage /></RoleGuard>} />
        <Route path="alerts" element={<RoleGuard><AlertsPage /></RoleGuard>} />
        <Route path="messaging" element={<RoleGuard><MessagingHubPage /></RoleGuard>} />
        <Route path="network-modeling" element={<RoleGuard><NetworkModelingPage /></RoleGuard>} />
        <Route path="db-explorer" element={<RoleGuard><DbExplorerPage /></RoleGuard>} />
        <Route path="multi-stop-routes" element={<RoleGuard><MultiStopRoutesPage /></RoleGuard>} />
        <Route path="equipment-master" element={<RoleGuard><EquipmentMasterPage /></RoleGuard>} />
        <Route path="planning-parameters" element={<RoleGuard><PlanningParametersPage /></RoleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { isAuthenticated, booting } = useAuth();
  // `ordersTotal` is the true row count from /api/orders/count — used by
  // the OrdersPage header, the "All" status chip, and Dashboard KPIs
  // that previously read `orders.length`. The `orders` array itself
  // still tops out at the 500-row page (see DbApi.orders), so the
  // table/list views stay paginated; only the displayed total is
  // promoted to the real number.
  // QA #312 — documents is now plumbed through App state so the DB
  // Explorer can `SELECT * FROM documents`. DbApi.documents() already
  // exists; this is just the missing fan-out into refreshData() below.
  const [data, setData] = useState({ orders: [], ordersTotal: 0, shipments: [], carriers: [], lanePreferences: [], items: [], locations: [], packagingUnits: [], rates: [], drivers: [], invoices: [], routeTemplates: [], equipmentTypes: [], planningParameters: [], warehouseDockConfigs: [], documents: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshCoreData() {
    setError("");
    // ordersCount is fetched in parallel and tolerated independently —
    // a count failure should not blank out the orders array we did
    // get back. On miss we keep the previous total (passed via prev).
    return Promise.all([
      DbApi.orders(),
      DbApi.shipments(),
      DbApi.ordersCount().catch(() => undefined),
    ])
      .then(([orders, shipments, ordersTotal]) => {
        setData((prev) => ({
          ...prev,
          orders: Array.isArray(orders) ? orders : [],
          shipments: Array.isArray(shipments) ? shipments : [],
          ordersTotal: ordersTotal ?? prev.ordersTotal ?? 0,
        }));
      })
      .catch((e) => setError(e.message || "Failed loading data"));
  }

  // Targeted refresh for tender / accept / withdraw flows — only the two
  // tables those actions mutate. Avoids the 14-table full refresh that made
  // the tender button feel slow.
  async function refreshShipmentsAndOrders() {
    return refreshCoreData();
  }

  async function refreshData() {
    setError("");
    return Promise.all([
      DbApi.orders(),
      DbApi.shipments(),
      DbApi.carriers(),
      DbApi.lanePreferences().catch(() => []),
      DbApi.items().catch(() => []),
      DbApi.locations().catch(() => []),
      DbApi.packagingUnits().catch(() => []),
      DbApi.rates().catch(() => []),
      DbApi.drivers().catch(() => []),
      DbApi.invoices().catch(() => []),
      DbApi.routeTemplates().catch(() => []),
      DbApi.equipmentTypes().catch(() => []),
      DbApi.planningParameters().catch(() => []),
      DbApi.warehouseDockConfigs().catch(() => []),
      // QA #312 — documents added to refreshData() so the DB Explorer
      // (and any future Documents-aware screen) can see them. Failure
      // is tolerated: returning [] keeps the rest of the page loading
      // when /db/documents is unavailable.
      DbApi.documents().catch(() => []),
      // True orders count — independent failure mode: a count outage
      // should never blank out the rest of the dashboard, so it
      // collapses to undefined and we fall back to the prior total
      // below (or 0 on the very first load).
      DbApi.ordersCount().catch(() => undefined),
    ])
      .then(([orders, shipments, carriers, lanePreferences, items, locations, packagingUnits, rates, drivers, invoices, routeTemplates, equipmentTypes, planningParameters, warehouseDockConfigs, documents, ordersTotal]) => {
        setData((prev) => ({
          orders: Array.isArray(orders) ? orders : [],
          shipments: Array.isArray(shipments) ? shipments : [],
          carriers: Array.isArray(carriers) ? carriers : [],
          lanePreferences: Array.isArray(lanePreferences) ? lanePreferences : [],
          items: Array.isArray(items) ? items : [],
          locations: Array.isArray(locations) ? locations : [],
          packagingUnits: Array.isArray(packagingUnits) ? packagingUnits : [],
          rates: Array.isArray(rates) ? rates : [],
          drivers: Array.isArray(drivers) ? drivers : [],
          invoices: Array.isArray(invoices) ? invoices : [],
          routeTemplates: Array.isArray(routeTemplates) ? routeTemplates : [],
          equipmentTypes: Array.isArray(equipmentTypes) ? equipmentTypes : [],
          planningParameters: Array.isArray(planningParameters) ? planningParameters : [],
          warehouseDockConfigs: Array.isArray(warehouseDockConfigs) ? warehouseDockConfigs : [],
          documents: Array.isArray(documents) ? documents : [],
          ordersTotal: ordersTotal ?? prev.ordersTotal ?? 0,
        }));
      })
      .catch((e) => setError(e.message || "Failed loading data"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshData();
    // Warm the dock loading durations cache so bulk planning picks up
    // admin edits before anyone visits the Planning Parameters page.
    fetchDockLoadingDurations().catch(() => { /* falls back to constants */ });
    // Real-time updates via WebSocket — instant notification from OMS/Middleware
    import("./lib/wsClient.js").then(({ connect, onMessage, disconnect }) => {
      connect();
      const unsub = onMessage(() => refreshData());
      window.__wsCleanup = () => { unsub(); disconnect(); };
    });
    return () => { if (window.__wsCleanup) window.__wsCleanup(); };
  }, [isAuthenticated]);

  if (booting) {
    return (
      <div className="screen-center">
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 12px" }} />
          <div>Loading Zoree TMS...</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <LoginPage />;

  if (loading) {
    return (
      <div className="screen-center">
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 12px" }} />
          <div>Connecting to Supabase...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="screen-center">
        <div className="card" style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div className="fw-700 mb-2">Connection Error</div>
          <div className="text-muted mb-3">{error}</div>
          <button className="btn btn-primary" onClick={refreshData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <PrivateRoutes
      data={{
        ...data,
        setData,
        refreshData,
        refreshCoreData,
        refreshShipmentsAndOrders,
      }}
    />
  );
}
