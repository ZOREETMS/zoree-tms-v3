const tabStyle = (isActive) => ({
  padding: "5px 16px",
  borderRadius: 8,
  border: "none",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
  background: isActive ? "var(--accent)" : "transparent",
  color: isActive ? "#fff" : "var(--text3)",
});

export default function FleetTabSwitcher({ activeTab, onTabChange }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button style={tabStyle(activeTab === "vehicles")} onClick={() => onTabChange("vehicles")}>
        🚛 Vehicles
      </button>
      <button style={tabStyle(activeTab === "drivers")} onClick={() => onTabChange("drivers")}>
        👤 Drivers
      </button>
    </div>
  );
}
