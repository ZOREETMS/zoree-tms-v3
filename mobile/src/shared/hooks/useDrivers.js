import { useState, useMemo, useCallback } from "react";
import { HOS_MAX_HOURS } from "../types/fleet";

export function useDrivers(initialDrivers = []) {
  const [drivers, setDrivers] = useState(initialDrivers);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filtered = useMemo(() => {
    let list = [...drivers];
    if (statusFilter) {
      list = list.filter((d) => d.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((d) => {
        const hay = [d.name, d.cdl, d.phone, d.location, d.vehicle, d.status, d.homeTerm]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return list;
  }, [drivers, search, statusFilter]);

  const kpis = useMemo(() => {
    const now = new Date();
    const in90 = new Date(now);
    in90.setDate(in90.getDate() + 90);
    const in90Str = in90.toISOString().slice(0, 10);

    return {
      total: drivers.length,
      available: drivers.filter((d) => d.status === "Available").length,
      onDuty: drivers.filter((d) => d.status === "On Duty").length,
      hosWarnings: drivers.filter((d) => d.hosToday >= HOS_MAX_HOURS - 2).length,
      cdlExpiring: drivers.filter((d) => d.cdlExp && d.cdlExp <= in90Str).length,
    };
  }, [drivers]);

  const saveDriver = useCallback((driverData, existingId) => {
    setDrivers((prev) => {
      const idx = prev.findIndex((d) => d.id === (existingId || driverData.id));
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...driverData };
        return updated;
      }
      const newId = "DRV-" + String(prev.length + 1).padStart(3, "0");
      return [...prev, { ...driverData, id: driverData.id || newId, milesYTD: driverData.milesYTD || 0 }];
    });
  }, []);

  const removeDriver = useCallback((id) => {
    setDrivers((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const assignVehicle = useCallback((driverId, vehicleUnit) => {
    setDrivers((prev) =>
      prev.map((d) => {
        if (d.id === driverId) return { ...d, vehicle: vehicleUnit, status: vehicleUnit ? "On Duty" : d.status };
        return d;
      })
    );
  }, []);

  return {
    drivers,
    setDrivers,
    filtered,
    kpis,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    saveDriver,
    removeDriver,
    assignVehicle,
  };
}
