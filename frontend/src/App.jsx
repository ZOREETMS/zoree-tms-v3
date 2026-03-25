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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const { isAuthenticated, booting } = useAuth();
  const [data, setData] = useState({ orders: [], shipments: [], carriers: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshData() {
    setLoading(true);
    setError("");
    return Promise.all([DbApi.orders(), DbApi.shipments(), DbApi.carriers()])
      .then(([orders, shipments, carriers]) => {
        setData({
          orders: Array.isArray(orders) ? orders : [],
          shipments: Array.isArray(shipments) ? shipments : [],
          carriers: Array.isArray(carriers) ? carriers : [],
        });
      })
      .catch((e) => setError(e.message || "Failed loading data"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshData();
  }, [isAuthenticated]);

  if (booting) return <div className="screen-center">Booting...</div>;
  if (!isAuthenticated) return <LoginPage />;
  if (loading) return <div className="screen-center">Loading data...</div>;
  if (error) return <div className="screen-center error">{error}</div>;

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
