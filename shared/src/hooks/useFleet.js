import { useState, useMemo, useCallback } from "react";

export function useFleet(initialVehicles = []) {
  const [vehicles, setVehicles] = useState(initialVehicles);

  const kpis = useMemo(() => {
    const total = vehicles.length;
    const available = vehicles.filter((v) => v.status === "Available").length;
    const inTransit = vehicles.filter((v) => v.status === "In Transit").length;
    const maintenance = vehicles.filter((v) => v.status === "Maintenance").length;
    return { total, available, inTransit, maintenance };
  }, [vehicles]);

  const saveVehicle = useCallback((vehicleData, existingUnit) => {
    setVehicles((prev) => {
      const idx = prev.findIndex((v) => v.unit === (existingUnit || vehicleData.unit));
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...vehicleData };
        return updated;
      }
      return [...prev, vehicleData];
    });
  }, []);

  const removeVehicle = useCallback((unit) => {
    setVehicles((prev) => prev.filter((v) => v.unit !== unit));
  }, []);

  const updateVehicleDriver = useCallback((unit, driverName) => {
    setVehicles((prev) =>
      prev.map((v) => (v.unit === unit ? { ...v, driver: driverName } : v))
    );
  }, []);

  return { vehicles, setVehicles, kpis, saveVehicle, removeVehicle, updateVehicleDriver };
}
