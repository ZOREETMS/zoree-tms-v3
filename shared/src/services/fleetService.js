import { DbApi } from "../api";

export const FleetService = {
  async getVehicles() {
    return DbApi.orders()
      .then(() => [])
      .catch(() => []);
    // TODO: Replace with real endpoint when backend table exists
    // return api("/db/vehicles?q=select=*&order=unit.asc&limit=500");
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

// Seed data matching the original HTML for local/demo usage
export const SEED_VEHICLES = [
  { unit: "TRK-101", type: "Dry Van 53'", driver: "James Wilson", location: "Chicago, IL", dest: "Dallas, TX", nextPM: "2026-03-15", milesYTD: 42180, status: "In Transit" },
  { unit: "TRK-102", type: "Dry Van 53'", driver: "Maria Santos", location: "Atlanta, GA", dest: "Columbus, OH", nextPM: "2026-04-02", milesYTD: 38440, status: "In Transit" },
  { unit: "TRK-103", type: "Reefer 48'", driver: "David Chen", location: "Dallas, TX", dest: "\u2014", nextPM: "2026-03-20", milesYTD: 51200, status: "Available" },
  { unit: "TRK-104", type: "Flatbed 48'", driver: "Unassigned", location: "Columbus, OH", dest: "\u2014", nextPM: "2026-03-08", milesYTD: 29880, status: "Maintenance" },
  { unit: "TRK-105", type: "Dry Van 53'", driver: "Linda Park", location: "Los Angeles, CA", dest: "Seattle, WA", nextPM: "2026-05-01", milesYTD: 61050, status: "In Transit" },
  { unit: "TRK-106", type: "Dry Van 53'", driver: "Carlos Rivera", location: "New York, NY", dest: "\u2014", nextPM: "2026-04-14", milesYTD: 33720, status: "Available" },
  { unit: "TRK-107", type: "Reefer 48'", driver: "Amy Johnson", location: "Seattle, WA", dest: "Los Angeles, CA", nextPM: "2026-03-25", milesYTD: 44310, status: "In Transit" },
  { unit: "TRK-108", type: "Dry Van 53'", driver: "Unassigned", location: "Chicago, IL", dest: "\u2014", nextPM: "2026-03-10", milesYTD: 18900, status: "Maintenance" },
  { unit: "TRK-109", type: "Flatbed 48'", driver: "Tom Bradley", location: "Houston, TX", dest: "\u2014", nextPM: "2026-06-01", milesYTD: 27540, status: "Available" },
  { unit: "TRK-110", type: "Dry Van 53'", driver: "Rachel Kim", location: "Miami, FL", dest: "Atlanta, GA", nextPM: "2026-04-18", milesYTD: 39760, status: "In Transit" },
];

export const SEED_DRIVERS = [
  { id: "DRV-001", name: "James Wilson", phone: "(312) 555-0101", email: "jwilson@zoree.com", cdl: "CDL-IL-1234567", cdlClass: "Class A", cdlExp: "2027-06-15", vehicle: "TRK-101", location: "Chicago, IL", homeTerm: "Chicago, IL", status: "On Duty", hosToday: 9.5, hireDate: "2021-03-10", endorsements: ["Hazmat", "Tanker"], notes: "Senior driver, 5+ years", milesYTD: 42180 },
  { id: "DRV-002", name: "Maria Santos", phone: "(404) 555-0102", email: "msantos@zoree.com", cdl: "CDL-GA-2345678", cdlClass: "Class A", cdlExp: "2026-09-30", vehicle: "TRK-102", location: "Atlanta, GA", homeTerm: "Atlanta, GA", status: "On Duty", hosToday: 7.2, hireDate: "2022-01-15", endorsements: ["Doubles", "Reefer"], notes: "", milesYTD: 38440 },
  { id: "DRV-003", name: "David Chen", phone: "(214) 555-0103", email: "dchen@zoree.com", cdl: "CDL-TX-3456789", cdlClass: "Class A", cdlExp: "2026-05-20", vehicle: "TRK-103", location: "Dallas, TX", homeTerm: "Dallas, TX", status: "Available", hosToday: 0, hireDate: "2020-07-22", endorsements: ["Reefer", "Hazmat"], notes: "Reefer specialist", milesYTD: 51200 },
  { id: "DRV-004", name: "Linda Park", phone: "(213) 555-0104", email: "lpark@zoree.com", cdl: "CDL-CA-4567890", cdlClass: "Class A", cdlExp: "2027-11-10", vehicle: "TRK-105", location: "Los Angeles, CA", homeTerm: "Los Angeles, CA", status: "On Duty", hosToday: 8.4, hireDate: "2023-02-01", endorsements: ["Flatbed"], notes: "", milesYTD: 61050 },
  { id: "DRV-005", name: "Carlos Rivera", phone: "(212) 555-0105", email: "crivera@zoree.com", cdl: "CDL-NY-5678901", cdlClass: "Class A", cdlExp: "2028-01-25", vehicle: "TRK-106", location: "New York, NY", homeTerm: "New York, NY", status: "Available", hosToday: 0, hireDate: "2021-09-18", endorsements: ["Tanker", "Hazmat"], notes: "", milesYTD: 33720 },
  { id: "DRV-006", name: "Amy Johnson", phone: "(206) 555-0106", email: "ajohnson@zoree.com", cdl: "CDL-WA-6789012", cdlClass: "Class A", cdlExp: "2026-04-05", vehicle: "TRK-107", location: "Seattle, WA", homeTerm: "Seattle, WA", status: "On Duty", hosToday: 10.2, hireDate: "2022-06-14", endorsements: ["Reefer"], notes: "CDL expiring soon", milesYTD: 44310 },
  { id: "DRV-007", name: "Tom Bradley", phone: "(713) 555-0107", email: "tbradley@zoree.com", cdl: "CDL-TX-7890123", cdlClass: "Class A", cdlExp: "2027-08-30", vehicle: "TRK-109", location: "Houston, TX", homeTerm: "Houston, TX", status: "Available", hosToday: 0, hireDate: "2020-11-05", endorsements: ["Flatbed", "Oversize"], notes: "Flatbed/oversize specialist", milesYTD: 27540 },
  { id: "DRV-008", name: "Rachel Kim", phone: "(305) 555-0108", email: "rkim@zoree.com", cdl: "CDL-FL-8901234", cdlClass: "Class A", cdlExp: "2027-03-15", vehicle: "TRK-110", location: "Miami, FL", homeTerm: "Miami, FL", status: "On Duty", hosToday: 7.5, hireDate: "2023-05-20", endorsements: [], notes: "", milesYTD: 39760 },
];
