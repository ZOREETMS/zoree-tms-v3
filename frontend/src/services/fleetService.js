import { DbApi } from "../lib/api";

export const FleetService = {
  /** Vehicles on file (public.vehicles), in the shape the Fleet page uses. */
  async getVehicles() {
    const rows = await DbApi.vehicles();
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      unit: r.id,
      type: r.type || "",
      driver: "Unassigned",
      location: r.current_location || "",
      dest: "\u2014",
      nextPM: "",
      milesYTD: 0,
      status: r.status || "Available",
    }));
  },

  async getDrivers() {
    return DbApi.orders()
      .then(() => [])
      .catch(() => []);
    // TODO: Replace with real endpoint when backend table exists
    // return api("/db/drivers?q=select=*&order=name.asc&limit=500");
  },

  async saveVehicle(vehicle) {
    if (vehicle.unit) {
      return DbApi.patch("vehicles", vehicle.unit, vehicle).catch(() => vehicle);
    }
    return DbApi.upsert("vehicles", vehicle).catch(() => vehicle);
  },

  async deleteVehicle(unit) {
    return DbApi.remove("vehicles", unit).catch(() => {});
  },

  async saveDriver(driver) {
    if (driver.id) {
      return DbApi.patch("drivers", driver.id, driver).catch(() => driver);
    }
    return DbApi.upsert("drivers", driver).catch(() => driver);
  },

  async deleteDriver(id) {
    return DbApi.remove("drivers", id).catch(() => {});
  },
};
