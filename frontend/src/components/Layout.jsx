import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../state/AuthContext";
import { useOutletContext } from "react-router-dom";
import ZoreeAI from "./ZoreeAI";
import { visibleNavLabels, canonicalRole } from "../config/roleMatrix";
import RoleSwitcher from "./RoleSwitcher";
import { useFeatureAccessMap } from "../hooks/useFeatureAccess";

// QA #139: each nav item carries `featureKey` so we can drop the entry
// when the role_feature_permissions matrix says the user has 'none'
// access to that module. Without this, setting Planner → No View on
// Orders left the link in the sidebar — clicking it just bounced the
// user, not what an admin expects. Keys mirror access_features rows
// (matches MODULE_TO_TABLES in api/services/rolePermissions.js).
const navStructure = [
  { section: "Overview", items: [
    { to: "/", label: "Home", icon: "🏠", featureKey: "home" },
    { to: "/dashboard", label: "Dashboard", icon: "📊", featureKey: "dashboard" },
  ]},
  { section: "Planning", items: [
    { to: "/item-master", label: "Item Master", icon: "📦", featureKey: "items" },
    { to: "/location-master", label: "Location Master", icon: "📍", featureKey: "locations" },
    { to: "/equipment-master", label: "Equipment Master", icon: "🚛", featureKey: "equipments" },
    { to: "/shipments", label: "Shipments", icon: "📦", badgeKey: "shipments", featureKey: "shipments" },
    { to: "/orders", label: "Orders", icon: "🧾", badgeKey: "orders", badgeColor: "yellow", featureKey: "orders" },
    { to: "/route-optimizer", label: "Route Optimizer", icon: "🗺️", featureKey: "route_optimizer" },
    { to: "/bulk-plan", label: "Bulk Plan", icon: "⚡", featureKey: "bulk_plan" },
    { to: "/multi-stop-routes", label: "Multi-Stop Routes", icon: "🛣️", featureKey: "multi_stop_routes" },
    { to: "/planning-parameters", label: "Planning Params", icon: "🎛️", featureKey: "planning_params" },
  ]},
  { section: "Execution", items: [
    { to: "/live-tracking", label: "Live Tracking", icon: "📡", badgeVal: "3", badgeColor: "red", featureKey: "live_tracking" },
    { to: "/carriers", label: "Carriers", icon: "🚛", featureKey: "carriers" },
    { to: "/carrier-portal", label: "Carrier Portal", icon: "🏢", badgeKey: "tenderedShipments", featureKey: "carrier_portal" },
    { to: "/dock-scheduling", label: "Dock Scheduling", icon: "🚪", featureKey: "dock_scheduling" },
    { to: "/fleet-management", label: "Fleet Management", icon: "🏎️", featureKey: "fleet_management" },
    { to: "/compliance", label: "Compliance", icon: "⚖️", featureKey: "compliance" },
  ]},
  { section: "Finance", items: [
    { to: "/freight-invoices", label: "Freight Invoices", icon: "💰", badgeVal: "5", badgeColor: "yellow", featureKey: "invoices" },
    { to: "/rate-management", label: "Rate Management", icon: "📋", featureKey: "rate_management" },
    { to: "/lane-preferences", label: "Lane Preferences", icon: "⭐", featureKey: "lane_preferences" },
    { to: "/carrier-bids", label: "Carrier Bids", icon: "🎯", featureKey: "carrier_bids" },
    { to: "/freight-audit", label: "Freight Audit", icon: "🔍", badgeVal: "3", badgeColor: "red", featureKey: "freight_audit" },
  ]},
  { section: "Documents", items: [
    { to: "/documents", label: "Documents & BOL", icon: "📄", featureKey: "documents" },
    { to: "/customer-portal", label: "Customer Portal", icon: "👁️", featureKey: "customer_portal" },
  ]},
  { section: "Integration", items: [
    { to: "/messaging", label: "Messaging Hub", icon: "📨", badgeVal: "3", badgeColor: "red", featureKey: "messaging" },
  ]},
  { section: "Insights", items: [
    { to: "/network-modeling", label: "Network Modeling", icon: "🌐", featureKey: "network_modeling" },
    { to: "/analytics", label: "Analytics", icon: "📈", featureKey: "analytics" },
    { to: "/reports", label: "Reports", icon: "📊", featureKey: "reports" },
    { to: "/alerts", label: "Alerts", icon: "🔔", badgeVal: "2", badgeColor: "red", featureKey: "alerts" },
    { to: "/db-explorer", label: "DB Explorer", icon: "🗄️", featureKey: "db_explorer" },
  ]},
  { section: "System", items: [
    { to: "/user-management", label: "User Management", icon: "👥", featureKey: "user_management" },
    { to: "/user-roles", label: "User Roles", icon: "🔐", featureKey: "user_roles" },
    { to: "/settings", label: "Settings", icon: "⚙️", featureKey: "settings" },
  ]},
];

export default function Layout({ data }) {
  const { user, logout } = useAuth();
  const initials = (user?.email || "").slice(0, 2).toUpperCase();

  // REQ-04/08: filter the navStructure by the user's currently active role.
  // Admin sees everything; planner sees planning/execution + rate-management;
  // finance sees finance menus + documents + analytics. Users with multiple
  // roles switch via the RoleSwitcher below; we read activeRole (fallback to
  // legacy single `role` for older tokens).
  const role = canonicalRole(user?.activeRole || user?.role);
  const allowed = visibleNavLabels(role);

  // QA #139: also drop modules whose role_feature_permissions level is
  // 'none' for the user's active role. The legacy ROLE_NAV whitelist is
  // kept as a baseline (so a brand-new tenant without a permissions row
  // doesn't suddenly lose every link), but the dynamic matrix can
  // further hide modules that an admin has explicitly turned off.
  // Admin always sees everything regardless of matrix.
  const access = useFeatureAccessMap();
  const matrixHides = (featureKey) => {
    if (!featureKey) return false;
    if (access._isLoading) return false;
    if (access._role === "admin") return false;
    const entry = access[featureKey];
    if (!entry) return false; // feature not in catalog → don't hide.
    return entry.level === "none";
  };

  const filteredNav = navStructure
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        allowed.has(item.label) && !matrixHides(item.featureKey)
      ),
    }))
    .filter((group) => group.items.length > 0);

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
          {filteredNav.map((group) => (
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
          {/* REQ-08: role switcher (shown only when user has 2+ roles) */}
          <RoleSwitcher />
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "12.5px", fontWeight: 500, color: "#fff" }}>{user?.email || "Not signed in"}</div>
              <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.45)" }}>{(user?.activeRole || user?.role || "admin").toUpperCase()} · Zoree</div>
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
