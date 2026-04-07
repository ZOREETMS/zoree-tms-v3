import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../state/AuthContext";
import { useOutletContext } from "react-router-dom";
import ZoreeAI from "./ZoreeAI";

const navStructure = [
  { section: "Overview", items: [
    { to: "/", label: "Home", icon: "🏠" },
    { to: "/dashboard", label: "Dashboard", icon: "📊" },
  ]},
  { section: "Planning", items: [
    { to: "/item-master", label: "Item Master", icon: "📦" },
    { to: "/location-master", label: "Location Master", icon: "📍" },
    { to: "/equipment-master", label: "Equipment Master", icon: "🚛" },
    { to: "/shipments", label: "Shipments", icon: "📦", badgeKey: "shipments" },
    { to: "/orders", label: "Orders", icon: "🧾", badgeKey: "orders", badgeColor: "yellow" },
    { to: "/route-optimizer", label: "Route Optimizer", icon: "🗺️" },
    { to: "/bulk-plan", label: "Bulk Plan", icon: "⚡" },
    { to: "/multi-stop-routes", label: "Multi-Stop Routes", icon: "🛣️" },
    { to: "/planning-parameters", label: "Planning Params", icon: "🎛️" },
  ]},
  { section: "Execution", items: [
    { to: "/live-tracking", label: "Live Tracking", icon: "📡", badgeVal: "3", badgeColor: "red" },
    { to: "/carriers", label: "Carriers", icon: "🚛" },
    { to: "/carrier-portal", label: "Carrier Portal", icon: "🏢", badgeKey: "tenderedShipments" },
    { to: "/dock-scheduling", label: "Dock Scheduling", icon: "🚪" },
    { to: "/fleet-management", label: "Fleet Management", icon: "🏎️" },
    { to: "/compliance", label: "Compliance", icon: "⚖️" },
  ]},
  { section: "Finance", items: [
    { to: "/freight-invoices", label: "Freight Invoices", icon: "💰", badgeVal: "5", badgeColor: "yellow" },
    { to: "/rate-management", label: "Rate Management", icon: "📋" },
    { to: "/lane-preferences", label: "Lane Preferences", icon: "⭐" },
    { to: "/carrier-bids", label: "Carrier Bids", icon: "🎯" },
    { to: "/freight-audit", label: "Freight Audit", icon: "🔍", badgeVal: "3", badgeColor: "red" },
  ]},
  { section: "Documents", items: [
    { to: "/documents", label: "Documents & BOL", icon: "📄" },
    { to: "/customer-portal", label: "Customer Portal", icon: "👁️" },
  ]},
  { section: "Integration", items: [
    { to: "/messaging", label: "Messaging Hub", icon: "📨", badgeVal: "3", badgeColor: "red" },
  ]},
  { section: "Insights", items: [
    { to: "/network-modeling", label: "Network Modeling", icon: "🌐" },
    { to: "/analytics", label: "Analytics", icon: "📈" },
    { to: "/reports", label: "Reports", icon: "📊" },
    { to: "/alerts", label: "Alerts", icon: "🔔", badgeVal: "2", badgeColor: "red" },
    { to: "/db-explorer", label: "DB Explorer", icon: "🗄️" },
  ]},
  { section: "System", items: [
    { to: "/settings", label: "Settings", icon: "⚙️" },
  ]},
];

export default function Layout({ data }) {
  const { user, logout } = useAuth();
  const initials = (user?.email || "").slice(0, 2).toUpperCase();

  // Dynamic badge counts
  const orderCount = (data?.orders || []).filter(o => o.status === "Unplanned").length;
  const shipCount = (data?.shipments || []).length;
  const tenderedCount = (data?.shipments || []).filter(s => s.status === "Tendered").length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="logo-word">zoree</div>
          <div className="logo-sub">TMS PLATFORM &nbsp;<span style={{ fontSize: 9, opacity: 0.4 }}>v3.11</span></div>
        </div>

        {/* Navigation */}
        <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px" }}>
          {navStructure.map((group) => (
            <div className="nav-section" key={group.section}>
              <div className="nav-label">{group.section}</div>
              {group.items.map((item) => {
                let badgeVal = item.badgeVal || null;
                if (item.badgeKey === "orders") badgeVal = orderCount || null;
                if (item.badgeKey === "shipments") badgeVal = shipCount || null;
                if (item.badgeKey === "tenderedShipments") badgeVal = tenderedCount || null;

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    {item.label}
                    {badgeVal && (
                      <span className={`nav-badge ${item.badgeColor || ""}`}>{badgeVal}</span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>

        {/* User Footer */}
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12.5px", fontWeight: 500, color: "#fff" }}>{user?.email || "Not signed in"}</div>
              <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.45)" }}>Admin · Zoree</div>
            </div>
          </div>
          <button onClick={logout} className="sidebar-logout-btn">
            <span style={{ fontSize: 15 }}>🚪</span> Sign Out
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet context={data} />
      </main>

      {/* ZoreeAI Floating Chat Assistant */}
      <ZoreeAI data={data} />
    </div>
  );
}
