// Freight Audit — type constants, statuses, and factory functions

export const AUDIT_STATUS = {
  MATCHED: "Matched",
  DISCREPANCY: "Discrepancy",
  PENDING: "Pending",
};

export const PAY_STATUS = {
  APPROVED: "Approved",
  PENDING: "Pending",
  DISPUTED: "Disputed",
  ON_HOLD: "On Hold",
};

export const ISSUE_TYPES = [
  "Fuel surcharge overage",
  "Accessorial not agreed",
  "Rate applied incorrectly",
  "Duplicate invoice",
  "Weight discrepancy",
  "Detention charge mismatch",
];

export const AUDIT_STATUS_COLORS = {
  [AUDIT_STATUS.MATCHED]:     { color: "var(--green)",  bg: "var(--green-dim)" },
  [AUDIT_STATUS.DISCREPANCY]: { color: "var(--red)",    bg: "rgba(239,68,68,.1)" },
  [AUDIT_STATUS.PENDING]:     { color: "var(--yellow)", bg: "rgba(245,158,11,.1)" },
};

export const PAY_STATUS_COLORS = {
  [PAY_STATUS.APPROVED]:  { color: "var(--green)",  bg: "var(--green-dim)" },
  [PAY_STATUS.PENDING]:   { color: "var(--accent)", bg: "rgba(99,102,241,.1)" },
  [PAY_STATUS.DISPUTED]:  { color: "var(--red)",    bg: "rgba(239,68,68,.1)" },
  [PAY_STATUS.ON_HOLD]:   { color: "var(--yellow)", bg: "rgba(245,158,11,.1)" },
};

export function emptyAuditRecord() {
  return {
    inv: "",
    carrier: "",
    ship: "",
    agreed: 0,
    billed: 0,
    issue: "",
    auditStatus: AUDIT_STATUS.PENDING,
    payStatus: PAY_STATUS.PENDING,
  };
}
