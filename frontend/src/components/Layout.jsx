import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../state/AuthContext";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/orders", label: "Orders" },
  { to: "/shipments", label: "Shipments" },
  { to: "/carriers", label: "Carriers" },
  { to: "/bulk-plan", label: "Bulk Plan" },
  { to: "/settings", label: "Settings" },
];

export default function Layout({ data }) {
  const { user, logout } = useAuth();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Zoree TMS</h1>
        <nav>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/"}
              className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="user-box">
          <div>{user?.email || "Not signed in"}</div>
          <button onClick={logout}>Sign Out</button>
        </div>
      </aside>
      <main className="content">
        <Outlet context={data} />
      </main>
    </div>
  );
}
