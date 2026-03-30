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
import { useAuth } from "./state/AuthContext";
import { DbApi } from "./lib/api";

function PrivateRoutes({ data }) {
  return (
    <Routes>
      <Route path="/" element={<Layout data={data} />}>
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="carriers" element={<CarriersPage />} />
        <Route path="bulk-plan" element={<BulkPlanPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* Placeholder pages */}
        <Route path="item-master" element={<ItemMasterPage />} />
        <Route path="location-master" element={<LocationMasterPage />} />
        <Route path="route-optimizer" element={<RouteOptimizerPage />} />
        <Route path="live-tracking" element={<LiveTrackingPage />} />
        <Route path="carrier-portal" element={<PlaceholderPage title="Carrier Portal" icon="🏢" description="Carrier self-service portal for tenders and updates" />} />
        <Route path="dock-scheduling" element={<DockSchedulingPage />} />
        <Route path="fleet-management" element={<PlaceholderPage title="Fleet Management" icon="🔧" description="Manage drivers, vehicles, and fleet operations" />} />
        <Route path="compliance" element={<PlaceholderPage title="Compliance" icon="📜" description="Regulatory compliance, HOS, and safety management" />} />
        <Route path="freight-invoices" element={<PlaceholderPage title="Freight Invoices" icon="💰" description="Manage carrier invoices and payment processing" />} />
        <Route path="rate-management" element={<RateManagementPage />} />
        <Route path="lane-preferences" element={<LanePreferencesPage />} />
        <Route path="carrier-bids" element={<PlaceholderPage title="Carrier Bids" icon="🎯" description="Request and manage carrier bid responses" />} />
        <Route path="freight-audit" element={<PlaceholderPage title="Freight Audit" icon="🔍" description="Audit carrier invoices against contracted rates" />} />
        <Route path="documents" element={<PlaceholderPage title="Documents & BOL" icon="📄" description="Manage bills of lading, PODs, and shipping documents" />} />
        <Route path="customer-portal" element={<PlaceholderPage title="Customer Portal" icon="👁️" description="Customer self-service portal for shipment visibility" />} />
        <Route path="analytics" element={<PlaceholderPage title="Analytics" icon="📈" description="Transportation analytics and insights" />} />
        <Route path="reports" element={<PlaceholderPage title="Reports" icon="📊" description="Generate and schedule reports" />} />
        <Route path="alerts" element={<PlaceholderPage title="Alerts" icon="🔔" description="Manage alert rules and notifications" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { isAuthenticated, booting } = useAuth();
  const [data, setData] = useState({ orders: [], shipments: [], carriers: [], lanePreferences: [], items: [], locations: [], packagingUnits: [], rates: [] });
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
    ])
      .then(([orders, shipments, carriers, lanePreferences, items, locations, packagingUnits, rates]) => {
        setData({
          orders: Array.isArray(orders) ? orders : [],
          shipments: Array.isArray(shipments) ? shipments : [],
          carriers: Array.isArray(carriers) ? carriers : [],
          lanePreferences: Array.isArray(lanePreferences) ? lanePreferences : [],
          items: Array.isArray(items) ? items : [],
          locations: Array.isArray(locations) ? locations : [],
          packagingUnits: Array.isArray(packagingUnits) ? packagingUnits : [],
          rates: Array.isArray(rates) ? rates : [],
        });
      })
      .catch((e) => setError(e.message || "Failed loading data"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshData();
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
