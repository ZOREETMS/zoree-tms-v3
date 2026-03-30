import { useState, useEffect } from "react";

export default function DriverAssignModal({ isOpen, drivers, vehicles, preselectedDriverId, onClose, onConfirm }) {
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [shipmentId, setShipmentId] = useState("");

  useEffect(() => {
    setDriverId(preselectedDriverId || "");
    setVehicleId("");
    setShipmentId("");
  }, [preselectedDriverId, isOpen]);

  function handleConfirm() {
    if (!driverId) return;
    onConfirm({ driverId, vehicleId, shipmentId });
  }

  if (!isOpen) return null;

  const selectStyle = {
    width: "100%", padding: "9px 10px",
    border: "1.5px solid var(--border)", borderRadius: 8,
    fontSize: 13, fontFamily: "inherit", background: "#fff",
  };

  const labelStyle = {
    fontSize: 11, fontWeight: 700, color: "var(--text3)",
    textTransform: "uppercase", letterSpacing: ".8px",
    display: "block", marginBottom: 5,
  };

  const activeDrivers = drivers.filter((d) => d.status !== "Inactive");

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ width: 480 }}>
        <div className="modal-header" style={{ background: "linear-gradient(135deg,#1e3a5f,#3b82f6)" }}>
          <div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,.6)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 3 }}>
              Fleet Management
            </div>
            <span className="modal-title" style={{ color: "#fff" }}>Assign Driver</span>
          </div>
          <button className="modal-close" onClick={onClose} style={{ color: "rgba(255,255,255,.7)", fontSize: 22 }}>
            {"\u2715"}
          </button>
        </div>

        <div className="modal-body" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Driver *</label>
            <select style={selectStyle} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">{"\u2014 Select Driver \u2014"}</option>
              {activeDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.status}
                  {d.vehicle ? ` · ${d.vehicle}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Assign to Vehicle</label>
            <select style={selectStyle} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">{"\u2014 Select Vehicle \u2014"}</option>
              {vehicles.map((v) => {
                const assignedTo = drivers.find((d) => d.vehicle === v.unit);
                return (
                  <option key={v.unit} value={v.unit} disabled={v.status === "Maintenance"}>
                    {v.unit} · {v.type} · {v.status}
                    {assignedTo ? ` (${assignedTo.name})` : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Link to Shipment (optional)</label>
            <select style={selectStyle} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)}>
              <option value="">{"\u2014 None (vehicle only) \u2014"}</option>
            </select>
          </div>

          <div
            style={{
              padding: "12px 14px", background: "#f8faff", borderRadius: 10,
              border: "1px solid var(--border)", fontSize: 12, color: "var(--text2)",
            }}
          >
            💡 Assigning to a vehicle updates the driver name on the Fleet Assets table.
            Linking to a shipment logs the assignment as an event on the shipment timeline.
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm}>✅ Confirm Assignment</button>
        </div>
      </div>
    </div>
  );
}
