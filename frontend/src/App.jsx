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
import { useAuth } from "./state/AuthContext";
import { DbApi } from "./lib/api";

function PrivateRoutes({ data }) {
  return (
    <Routes>
      <Route path="/" element={<Layout data={data} />}>
        <Route index element={<HomePage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="carriers" element={<CarriersPage />} />
        <Route path="bulk-plan" element={<BulkPlanPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="user-roles" element={<UserRolesPage />} />
        {/* Placeholder pages */}
        <Route path="item-master" element={<ItemMasterPage />} />
        <Route path="location-master" element={<LocationMasterPage />} />
        <Route path="route-optimizer" element={<RouteOptimizerPage />} />
        <Route path="live-tracking" element={<LiveTrackingPage />} />
        <Route path="carrier-portal" element={<CarrierPortalPage />} />
        <Route path="dock-scheduling" element={<DockSchedulingPage />} />
        <Route path="fleet-management" element={<FleetManagementPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="freight-invoices" element={<FreightInvoicesPage />} />
        <Route path="rate-management" element={<RateManagementPage />} />
        <Route path="lane-preferences" element={<LanePreferencesPage />} />
        <Route path="carrier-bids" element={<CarrierBidsPage />} />
        <Route path="freight-audit" element={<FreightAuditPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="customer-portal" element={<CustomerPortalPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="messaging" element={<MessagingHubPage />} />
        <Route path="network-modeling" element={<NetworkModelingPage />} />
        <Route path="db-explorer" element={<DbExplorerPage />} />
        <Route path="multi-stop-routes" element={<MultiStopRoutesPage />} />
        <Route path="equipment-master" element={<EquipmentMasterPage />} />
        <Route path="planning-parameters" element={<PlanningParametersPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { isAuthenticated, booting } = useAuth();
  const [data, setData] = useState({ orders: [], shipments: [], carriers: [], lanePreferences: [], items: [], locations: [], packagingUnits: [], rates: [], drivers: [], invoices: [], routeTemplates: [], equipmentTypes: [], planningParameters: [], warehouseDockConfigs: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    ])
      .then(([orders, shipments, carriers, lanePreferences, items, locations, packagingUnits, rates, drivers, invoices, routeTemplates, equipmentTypes, planningParameters, warehouseDockConfigs]) => {
        setData({
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
        });
      })
      .catch((e) => setError(e.message || "Failed loading data"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshData();
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
      }}
    />
  );
}
