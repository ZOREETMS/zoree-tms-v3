export const HOS_MAX_HOURS = 11;

export const HOS_STATUS = {
  OK: "OK",
  WARNING: "Warning",
  VIOLATION: "Violation",
};

export const WEIGHT_STATUS = {
  PASS: "Pass",
  WARNING: "Warning",
  FAIL: "Fail",
};

export const HAZMAT_STATUS = {
  COMPLIANT: "Compliant",
  WARNING: "Warning",
};

export const CERT_STATUS = {
  ACTIVE: "Active",
  EXPIRING: "Expiring",
  EXPIRED: "Expired",
};

export const HAZMAT_CERTIFIED_CARRIERS = ["JB Hunt", "XPO Logistics", "FedEx Freight"];

export const STATUS_COLORS = {
  OK:        { color: "var(--green)",  bg: "var(--green-dim)" },
  Pass:      { color: "var(--green)",  bg: "var(--green-dim)" },
  Compliant: { color: "var(--green)",  bg: "var(--green-dim)" },
  Active:    { color: "var(--green)",  bg: "var(--green-dim)" },
  Warning:   { color: "var(--yellow)", bg: "var(--yellow-dim)" },
  Expiring:  { color: "var(--yellow)", bg: "var(--yellow-dim)" },
  Violation: { color: "var(--red)",    bg: "rgba(239,68,68,.1)" },
  Fail:      { color: "var(--red)",    bg: "rgba(239,68,68,.1)" },
  Expired:   { color: "var(--red)",    bg: "rgba(239,68,68,.1)" },
};

export function emptyHosRecord() {
  return { driver: "", vehicle: "", hoursToday: 0, remaining: HOS_MAX_HOURS, status: HOS_STATUS.OK, violation: "" };
}

export function emptyWeightRecord() {
  return { ship: "", weight: 0, limit: 80000, axleOk: true, permitReq: false, status: WEIGHT_STATUS.PASS };
}

export function emptyHazmatRecord() {
  return { ship: "", class: "", carrier: "", certified: false, placardOk: false, status: HAZMAT_STATUS.WARNING };
}
