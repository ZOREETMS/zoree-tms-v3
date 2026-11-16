import { HOS_MAX_HOURS, HOS_STATUS, WEIGHT_STATUS, HAZMAT_STATUS } from "../types/compliance";

// Carrier certification rows come from the carriers on file. HOS, weight
// and hazmat checks have no data source in the API yet, so they are empty.
function buildCerts(carriers) {
  return (carriers || []).map((car) => ({
    name: car.name,
    scac: car.scac,
    hazmatCert: car.hazmat_certified === true,
    status: car.status || "",
  }));
}

export function getComplianceData(carriers) {
  return { hos: [], weights: [], hazmat: [], certs: buildCerts(carriers) };
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
