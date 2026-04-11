import { useMemo, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import KpiCard from "../components/home/KpiCard";
import InsightsCard from "../components/home/InsightsCard";
import ActivityCard from "../components/home/ActivityCard";
import SectionHeader from "../components/home/SectionHeader";

import ModuleCard from "../components/home/ModuleCard";


/* ── All Modules Directory ────────────────────────────────────── */
const moduleSections = [
  {
    section: "Planning",
    items: [
      { to: "/orders", icon: "🧾", label: "Order Management", description: "Create, track, and manage transportation orders" },
      { to: "/shipments", icon: "📦", label: "Shipment Management", description: "Plan, consolidate, and track shipments" },
      { to: "/bulk-plan", icon: "⚡", label: "Bulk Planning", description: "Rate and execute shipments in bulk" },
      { to: "/multi-stop-routes", icon: "🛣️", label: "Multi-Stop Routes", description: "Define reusable multi-stop route templates" },
    ],
  },
  {
    section: "Rate & Contract",
    items: [
      { to: "/rate-management", icon: "📋", label: "Rate Management", description: "Manage carrier rates and lane pricing" },
      { to: "/lane-preferences", icon: "⭐", label: "Lane Preferences", description: "Set preferred carriers by lane" },
      { to: "/carrier-bids", icon: "🎯", label: "Carrier Bids", description: "Create RFQs and manage carrier bids" },
      { to: "/freight-audit", icon: "🔍", label: "Freight Audit", description: "Audit freight invoices for discrepancies" },
    ],
  },
  {
    section: "Execution",
    items: [
      { to: "/carriers", icon: "🚛", label: "Carrier Management", description: "Manage carrier profiles and contacts" },
      { to: "/carrier-portal", icon: "🏢", label: "Carrier Portal", description: "Carrier-facing tender acceptance portal" },
      { to: "/live-tracking", icon: "📡", label: "Live Tracking", description: "Real-time shipment tracking on map" },
      { to: "/dock-scheduling", icon: "🚪", label: "Dock Scheduling", description: "Manage dock appointments and windows" },
    ],
  },
  {
    section: "Master Data",
    items: [
      { to: "/item-master", icon: "📦", label: "Item Master", description: "Manage freight items and classifications" },
      { to: "/location-master", icon: "📍", label: "Location Master", description: "Manage pickup and delivery locations" },
      { to: "/fleet-management", icon: "🏎️", label: "Fleet Management", description: "Track vehicles, drivers, and assignments" },
      { to: "/route-optimizer", icon: "🗺️", label: "Route Optimizer", description: "Optimize routes and reduce mileage" },
    ],
  },
  {
    section: "Finance & Compliance",
    items: [
      { to: "/freight-invoices", icon: "💰", label: "Freight Invoices", description: "Process and approve freight invoices" },
      { to: "/compliance", icon: "⚖️", label: "Compliance", description: "HOS, weight checks, and certifications" },
      { to: "/documents", icon: "📄", label: "Documents & BOL", description: "Generate and manage shipping documents" },
      { to: "/customer-portal", icon: "👁️", label: "Customer Portal", description: "Customer shipment visibility and access" },
    ],
  },
  {
    section: "Intelligence / Admin",
    items: [
      { to: "/network-modeling", icon: "🌐", label: "Network Modeling", description: "Model and optimize your freight network" },
      { to: "/analytics", icon: "📈", label: "Analytics", description: "Spend analysis and carrier scorecards" },
      { to: "/reports", icon: "📊", label: "Reports", description: "Generate operational and financial reports" },
      { to: "/alerts", icon: "🔔", label: "Alerts", description: "Configure and review system alerts" },
    ],
  },
];

export default function HomePage() {
  const { shipments, orders } = useOutletContext();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  /* ── KPI calculations ─────────────────────────────────── */
  const kpis = useMemo(() => {
    const activeShipments = shipments.filter(
      (s) => s.status !== "Delivered" && s.status !== "Cancelled"
    ).length;
    const openOrders = orders.filter((o) => o.status === "Unplanned").length;
    const delayed = shipments.filter((s) => s.status === "Exception").length;
    const totalCost = shipments.reduce((sum, s) => sum + (parseFloat(s.total_cost) || 0), 0);
    const savingsEst = Math.round(totalCost * 0.04);
    return { activeShipments, openOrders, delayed, savingsEst };
  }, [shipments, orders]);

  /* ── Filter modules by search ─────────────────────────── */
  const filteredSections = useMemo(() => {
    if (!search.trim()) return moduleSections;
    const t = search.toLowerCase();
    return moduleSections
      .map((sec) => ({
        ...sec,
        items: sec.items.filter(
          (item) =>
            item.label.toLowerCase().includes(t) ||
            item.description.toLowerCase().includes(t) ||
            sec.section.toLowerCase().includes(t)
        ),
      }))
      .filter((sec) => sec.items.length > 0);
  }, [search]);

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">Home</div>
          <div className="page-sub">Zoree Transportation Management System</div>
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search modules..."
            style={{
              width: 360,
              height: 40,
              background: "#F8FAFC",
              border: "1px solid #CBD5E1",
              borderRadius: 12,
              padding: "0 16px",
              fontSize: 14,
              fontFamily: "inherit",
              outline: "none",
              color: "var(--text)",
            }}
          />
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" style={{ height: 40, borderRadius: 10 }} onClick={() => navigate("/shipments")}>
            + Create Shipment
          </button>
        </div>
      </div>

      <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* ── Section 1: KPI Row ──────────────────────────────── */}
        <div className="stat-grid">
          <KpiCard label="Active Shipments" value={kpis.activeShipments} delta={`${shipments.filter((s) => s.status === "In Transit").length} in transit`} type="shipments" />
          <KpiCard label="Open Orders" value={kpis.openOrders} delta="Awaiting planning" type="orders" />
          <KpiCard label="Delayed Loads" value={kpis.delayed} delta="Needs attention" type="delayed" />
          <KpiCard label="Savings Identified" value={`$${kpis.savingsEst.toLocaleString()}`} delta="Estimated this month" type="savings" />
        </div>

        {/* ── Section 2: Insights + Activity ──────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
          <InsightsCard orders={orders} shipments={shipments} />
          <ActivityCard />
        </div>

        {/* ── Section 3: All Modules Directory ────────────────── */}
        <div>
          <SectionHeader title="All Modules" subtitle="Browse all product capabilities by function" />
          {filteredSections.map((section) => (
            <div key={section.section}>
              <div className="module-section-title">{section.section}</div>
              <div className="module-grid">
                {section.items.map((item) => (
                  <ModuleCard key={item.to + section.section} {...item} />
                ))}
              </div>
            </div>
          ))}
          {filteredSections.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-title">No modules match your search</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
