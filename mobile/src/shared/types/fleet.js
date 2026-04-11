// Fleet entity constants and defaults

export const VEHICLE_TYPES = [
  "Dry Van 53'",
  "Dry Van 48'",
  "Reefer 53'",
  "Reefer 48'",
  "Flatbed 48'",
  "Step Deck",
  "Lowboy",
  "Tanker",
  "Box Truck",
];

export const VEHICLE_STATUSES = ["Available", "In Transit", "Maintenance"];

export const DRIVER_STATUSES = [
  "Available",
  "On Duty",
  "Off Duty",
  "Sleeper Berth",
  "Inactive",
];

export const CDL_CLASSES = ["Class A", "Class B", "Class C"];

export const ENDORSEMENTS = [
  "Hazmat",
  "Tanker",
  "Doubles",
  "Reefer",
  "Flatbed",
  "Oversize",
  "Passenger",
  "School Bus",
];

export const HOS_MAX_HOURS = 11;

export function emptyVehicle() {
  return {
    unit: "",
    type: "Dry Van 53'",
    driver: "Unassigned",
    location: "",
    dest: "\u2014",
    nextPM: "",
    milesYTD: 0,
    status: "Available",
  };
}

export function emptyDriver() {
  return {
    id: "",
    name: "",
    phone: "",
    email: "",
    cdl: "",
    cdlClass: "Class A",
    cdlExp: "",
    vehicle: "",
    location: "",
    homeTerm: "",
    status: "Available",
    hosToday: 0,
    hireDate: "",
    endorsements: [],
    notes: "",
    milesYTD: 0,
  };
}
