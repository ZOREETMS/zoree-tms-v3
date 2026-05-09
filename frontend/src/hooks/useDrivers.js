import { useState, useMemo, useCallback, useEffect } from "react";
import { HOS_MAX_HOURS } from "../types/fleet";
import { DbApi } from "../lib/api";

// Bug #170: dbToDriver normalizes a `drivers` table row from the DB
// (snake_case columns) into the camelCase shape Fleet Management has
// always used in-memory. Without this remap the same row would render
// blank fields whenever the DB row was loaded straight (e.g. after a
// Fleet Management → DB Explorer cross-check), which is exactly the
// inconsistency the bug reporter saw.
function dbToDriver(r) {
  if (!r || typeof r !== "object") return r;
  return {
    id:        r.id        || r.driver_id || "",
    name:      r.name      || r.full_name || "",
    cdl:       r.cdl       || r.cdl_number || "",
    cdlExp:    r.cdl_exp   || r.cdl_expiry || r.cdlExp || "",
    phone:     r.phone     || r.contact_phone || "",
    email:     r.email     || r.contact_email || "",
    homeTerm:  r.home_term || r.homeTerm || "",
    location:  r.location  || "",
    vehicle:   r.vehicle   || r.vehicle_unit || "",
    status:    r.status    || "Available",
    hosToday:  r.hos_today != null ? Number(r.hos_today) : (r.hosToday || 0),
    milesYTD:  r.miles_ytd != null ? Number(r.miles_ytd) : (r.milesYTD || 0),
  };
}

export function useDrivers(initialDrivers = []) {
  const [drivers, setDrivers] = useState(initialDrivers);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Bug #170: hydrate from the real `drivers` DB table on mount so
  // Fleet Management and DB Explorer agree. SEED_DRIVERS stays as the
  // initial frame to keep the page interactive while the request is
  // in flight; once the API returns, it wins. Failures fall back to
  // the seed so the page is never empty in offline / dev sessions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await DbApi.drivers();
        const rows = Array.isArray(resp) ? resp
                   : Array.isArray(resp?.drivers) ? resp.drivers
                   : Array.isArray(resp?.rows) ? resp.rows
                   : [];
        if (!cancelled && rows.length) setDrivers(rows.map(dbToDriver));
      } catch (_e) {
        // Swallow — initialDrivers is already populated.
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
