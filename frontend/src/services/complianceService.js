import { HOS_MAX_HOURS, HOS_STATUS, WEIGHT_STATUS, HAZMAT_STATUS, HAZMAT_CERTIFIED_CARRIERS } from "../types/compliance";

const SEED_HOS = [
  { driver: "James Wilson",  vehicle: "TRK-101", hoursToday: 9.5,  remaining: 1.5, status: HOS_STATUS.WARNING,   violation: "" },
  { driver: "Maria Santos",  vehicle: "TRK-102", hoursToday: 7.2,  remaining: 3.8, status: HOS_STATUS.OK,        violation: "" },
  { driver: "David Chen",    vehicle: "TRK-103", hoursToday: 11.1, remaining: 0,   status: HOS_STATUS.VIOLATION, violation: "Exceeded 11-hr driving limit" },
  { driver: "Linda Park",    vehicle: "TRK-105", hoursToday: 8.4,  remaining: 2.6, status: HOS_STATUS.OK,        violation: "" },
  { driver: "Carlos Rivera", vehicle: "TRK-106", hoursToday: 6.0,  remaining: 5.0, status: HOS_STATUS.OK,        violation: "" },
  { driver: "Amy Johnson",   vehicle: "TRK-107", hoursToday: 10.2, remaining: 0.8, status: HOS_STATUS.WARNING,   violation: "" },
  { driver: "Tom Bradley",   vehicle: "TRK-109", hoursToday: 9.8,  remaining: 1.2, status: HOS_STATUS.WARNING,   violation: "" },
  { driver: "Rachel Kim",    vehicle: "TRK-110", hoursToday: 7.5,  remaining: 3.5, status: HOS_STATUS.OK,        violation: "" },
];

const SEED_WEIGHTS = [
  { ship: "SHP-2024-1840", weight: 28400, limit: 80000, axleOk: true,  permitReq: false, status: WEIGHT_STATUS.PASS },
  { ship: "SHP-2024-1844", weight: 42000, limit: 80000, axleOk: true,  permitReq: false, status: WEIGHT_STATUS.PASS },
  { ship: "SHP-2024-1845", weight: 79500, limit: 80000, axleOk: false, permitReq: true,  status: WEIGHT_STATUS.WARNING },
  { ship: "SHP-2024-1848", weight: 32100, limit: 80000, axleOk: true,  permitReq: false, status: WEIGHT_STATUS.PASS },
  { ship: "SHP-2024-1851", weight: 81200, limit: 80000, axleOk: false, permitReq: true,  status: WEIGHT_STATUS.FAIL },
];

const SEED_HAZMAT = [
  { ship: "SHP-2024-1851", class: "Class 3 — Flammable Liquid", carrier: "JB Hunt",         certified: true, placardOk: true,  status: HAZMAT_STATUS.COMPLIANT },
  { ship: "SHP-2024-1848", class: "Class 8 — Corrosive",        carrier: "XPO Logistics",    certified: true, placardOk: true,  status: HAZMAT_STATUS.COMPLIANT },
  { ship: "SHP-2024-1843", class: "Class 9 — Misc.",            carrier: "FedEx Freight",     certified: true, placardOk: false, status: HAZMAT_STATUS.WARNING },
];

function buildCerts(carriers) {
  return carriers.map((car) => ({
    name: car.name,
    scac: car.scac,
    mc: "MC-" + Math.floor(100000 + Math.random() * 899999),
    dot: "DOT-" + Math.floor(1000000 + Math.random() * 8999999),
    hazmatCert: HAZMAT_CERTIFIED_CARRIERS.includes(car.name),
    expiry: "2026-12-31",
    status: "Active",
  }));
}

export function getComplianceData(carriers) {
  return {
    hos: SEED_HOS,
    weights: SEED_WEIGHTS,
    hazmat: SEED_HAZMAT,
    certs: buildCerts(carriers),
  };
}

export function computeComplianceStats(data) {
  const hosWarnings = data.hos.filter((h) => h.status === HOS_STATUS.WARNING).length;
  const violations = data.hos.filter((h) => h.status === HOS_STATUS.VIOLATION).length;
  const weightFails = data.weights.filter((w) => w.status === WEIGHT_STATUS.FAIL).length;
  const totalChecked = data.hos.length + data.weights.length;
  const totalIssues = hosWarnings + violations + weightFails;
  const compliantPct = totalChecked > 0 ? Math.round(((totalChecked - totalIssues) / totalChecked) * 100) : 100;

  return {
    compliantPct,
    hosWarnings,
    violations: violations + weightFails,
    hazmatShipments: data.hazmat.length,
  };
}

export function getHosPct(hoursToday) {
  return Math.min(100, Math.round((hoursToday / HOS_MAX_HOURS) * 100));
}
