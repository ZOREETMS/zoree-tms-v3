import { useState, useCallback } from "react";
import { useFleet } from "../hooks/useFleet";
import { useDrivers } from "../hooks/useDrivers";
import { SEED_VEHICLES, SEED_DRIVERS } from "../services/fleetService";
import { DRIVER_STATUSES } from "../types/fleet";
import StatCard from "../components/fleet/StatCard";
import FleetTabSwitcher from "../components/fleet/FleetTabSwitcher";
import VehicleTable from "../components/fleet/VehicleTable";
import DriverTable from "../components/fleet/DriverTable";
import VehicleModal from "../components/fleet/VehicleModal";
import DriverModal from "../components/fleet/DriverModal";
import DriverAssignModal from "../components/fleet/DriverAssignModal";
import { useRowSelection } from "../hooks/useRowSelection";
import SelectionBar from "../components/ui/SelectionBar";

export default function FleetManagementPage() {
  const [activeTab, setActiveTab] = useState("vehicles");
  const [toast, setToast] = useState({ text: "", type: "" });

  // Hooks for fleet and driver state
  const fleet = useFleet(SEED_VEHICLES);
  const driverState = useDrivers(SEED_DRIVERS);

  const vehicleSel = useRowSelection({ getKey: (v) => v.unit });
  const driverSel = useRowSelection({ getKey: (d) => d.id });

  // Modal state
  const [vehicleModal, setVehicleModal] = useState({ open: false, vehicle: null });
  const [driverModal, setDriverModal] = useState({ open: false, driver: null });
  const [assignModal, setAssignModal] = useState({ open: false, driverId: null });

  function showToast(text, type = "info") {
    setToast({ text, type });
    setTimeout(() => setToast({ text: "", type: "" }), 4000);
  }

  // Vehicle handlers
  const openVehicleModal = useCallback((unit) => {
    const v = unit ? fleet.vehicles.find((x) => x.unit === unit) : null;
    setVehicleModal({ open: true, vehicle: v });
  }, [fleet.vehicles]);

  const handleSaveVehicle = useCallback((data) => {
    fleet.saveVehicle(data, vehicleModal.vehicle?.unit);
    setVehicleModal({ open: false, vehicle: null });
    showToast(`Vehicle saved: ${data.unit}`, "success");
  }, [fleet, vehicleModal.vehicle]);

  // Driver handlers
  const openDriverModal = useCallback((id) => {
    const d = id ? driverState.drivers.find((x) => x.id === id) : null;
    setDriverModal({ open: true, driver: d });
  }, [driverState.drivers]);

  const handleSaveDriver = useCallback((data) => {
    const existingId = driverModal.driver?.id;
    driverState.saveDriver(data, existingId);

    // Sync vehicle driver name if vehicle assigned
    if (data.vehicle) {
      fleet.updateVehicleDriver(data.vehicle, data.name);
    }

    setDriverModal({ open: false, driver: null });
    showToast(`${existingId ? "Updated" : "Added"} driver: ${data.name}`, "success");
  }, [driverState, driverModal.driver, fleet]);

  const handleDeleteDriver = useCallback(() => {
    const d = driverModal.driver;
    if (!d) return;
    if (d.vehicle) fleet.updateVehicleDriver(d.vehicle, "Unassigned");
    driverState.removeDriver(d.id);
    setDriverModal({ open: false, driver: null });
    showToast("Driver removed", "info");
  }, [driverModal.driver, driverState, fleet]);

  // Assignment handler
  const openAssignModal = useCallback((driverId) => {
    setAssignModal({ open: true, driverId });
  }, []);

  const handleConfirmAssign = useCallback(({ driverId, vehicleId }) => {
    const driver = driverState.drivers.find((d) => d.id === driverId);
    if (!driver) return;

    // Unassign from previous vehicle
    if (driver.vehicle && driver.vehicle !== vehicleId) {
      fleet.updateVehicleDriver(driver.vehicle, "Unassigned");
    }

    // Assign to new vehicle
    if (vehicleId) {
      driverState.assignVehicle(driverId, vehicleId);
      fleet.updateVehicleDriver(vehicleId, driver.name);
    }

    setAssignModal({ open: false, driverId: null });
    showToast(
      `${driver.name} assigned${vehicleId ? ` to ${vehicleId}` : ""}`,
      "success"
    );
  }, [driverState, fleet]);

  return (
    <>
      {/* Page Header */}
      <div className="page-header" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, padding: "14px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="page-title">Fleet Management</div>
            <div className="page-sub">Owned & dedicated equipment tracking and utilization</div>
          </div>

          {/* Vehicle tab actions */}
          {activeTab === "vehicles" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => openAssignModal(null)}>
                👤 Assign Driver
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => openVehicleModal(null)}>
                + Add Vehicle
              </button>
            </div>
          )}

          {/* Driver tab actions */}
          {activeTab === "drivers" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                placeholder="🔍 Search drivers\u2026"
                value={driverState.search}
                onChange={(e) => driverState.setSearch(e.target.value)}
                style={{
                  padding: "7px 12px", border: "1.5px solid var(--border)",
                  borderRadius: 8, fontSize: 13, fontFamily: "inherit", width: 220,
                }}
              />
              <select
                value={driverState.statusFilter}
                onChange={(e) => driverState.setStatusFilter(e.target.value)}
                style={{
                  padding: "7px 10px", border: "1.5px solid var(--border)",
                  borderRadius: 8, fontSize: 13, fontFamily: "inherit", background: "#fff",
                }}
              >
                <option value="">All Statuses</option>
                {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => openDriverModal(null)}>
                + Add Driver
              </button>
            </div>
          )}
        </div>

        <FleetTabSwitcher activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Page Content */}
      <div className="page-content">
        {/* Vehicles Tab */}
        {activeTab === "vehicles" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              <StatCard label="Total Vehicles" value={fleet.kpis.total} color="blue" />
              <StatCard label="Available" value={fleet.kpis.available} color="green" />
              <StatCard label="In Transit" value={fleet.kpis.inTransit} color="yellow" />
              <StatCard label="Maintenance" value={fleet.kpis.maintenance} color="red" />
            </div>
            <SelectionBar count={vehicleSel.size} entityLabel="Vehicle" onClear={vehicleSel.clear} />
            <VehicleTable
              vehicles={fleet.vehicles}
              onEdit={openVehicleModal}
              onAssignDriver={openAssignModal}
              onTrack={(unit) => showToast(`Tracking ${unit}`, "info")}
              sel={vehicleSel}
            />
          </>
        )}

        {/* Drivers Tab */}
        {activeTab === "drivers" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 20 }}>
              <StatCard label="Total Drivers" value={driverState.kpis.total} color="blue" />
              <StatCard label="Available" value={driverState.kpis.available} color="green" />
              <StatCard label="On Duty" value={driverState.kpis.onDuty} color="yellow" />
              <StatCard label="HOS Warnings" value={driverState.kpis.hosWarnings} color="red" />
              <StatCard label="CDL Expiring" value={driverState.kpis.cdlExpiring} color="blue" />
            </div>
            <SelectionBar count={driverSel.size} entityLabel="Driver" onClear={driverSel.clear} />
            <DriverTable
              drivers={driverState.filtered}
              onEdit={openDriverModal}
              onAssign={openAssignModal}
              onSwitchToVehicles={() => setActiveTab("vehicles")}
              sel={driverSel}
            />
          </>
        )}
      </div>

      {/* Modals */}
      <VehicleModal
        isOpen={vehicleModal.open}
        vehicle={vehicleModal.vehicle}
        onClose={() => setVehicleModal({ open: false, vehicle: null })}
        onSave={handleSaveVehicle}
      />

      <DriverModal
        isOpen={driverModal.open}
        driver={driverModal.driver}
        vehicles={fleet.vehicles}
        onClose={() => setDriverModal({ open: false, driver: null })}
        onSave={handleSaveDriver}
        onDelete={handleDeleteDriver}
      />

      <DriverAssignModal
        isOpen={assignModal.open}
        drivers={driverState.drivers}
        vehicles={fleet.vehicles}
        preselectedDriverId={assignModal.driverId}
        onClose={() => setAssignModal({ open: false, driverId: null })}
        onConfirm={handleConfirmAssign}
      />

      {/* Toast */}
      {toast.text && (
        <div className="toast-wrap">
          <div className="toast">
            <span>{toast.text}</span>
          </div>
        </div>
      )}
    </>
  );
}
