import { AUDIT_STATUS, PAY_STATUS } from "../types/freightAudit";

export const SEED_AUDIT_DATA = [
  { inv: "INV-84421", carrier: "Swift Transport",    ship: "SHP-2024-1840", agreed: 3240, billed: 3240, issue: "",                          auditStatus: AUDIT_STATUS.MATCHED,     payStatus: PAY_STATUS.APPROVED },
  { inv: "INV-84422", carrier: "Old Dominion",       ship: "SHP-2024-1841", agreed: 980,  billed: 980,  issue: "",                          auditStatus: AUDIT_STATUS.MATCHED,     payStatus: PAY_STATUS.APPROVED },
  { inv: "INV-84423", carrier: "JB Hunt",            ship: "SHP-2024-1851", agreed: 2750, billed: 3070, issue: "Fuel surcharge overage",    auditStatus: AUDIT_STATUS.DISCREPANCY, payStatus: PAY_STATUS.ON_HOLD },
  { inv: "INV-84424", carrier: "Werner Enterprises", ship: "SHP-2024-1844", agreed: 2600, billed: 2600, issue: "",                          auditStatus: AUDIT_STATUS.MATCHED,     payStatus: PAY_STATUS.PENDING },
  { inv: "INV-84425", carrier: "XPO Logistics",      ship: "SHP-2024-1848", agreed: 1850, billed: 2100, issue: "Accessorial not agreed",    auditStatus: AUDIT_STATUS.DISCREPANCY, payStatus: PAY_STATUS.DISPUTED },
  { inv: "INV-84426", carrier: "Schneider National",  ship: "SHP-2024-1845", agreed: 4100, billed: 3980, issue: "Rate applied incorrectly", auditStatus: AUDIT_STATUS.DISCREPANCY, payStatus: PAY_STATUS.ON_HOLD },
  { inv: "INV-84427", carrier: "Swift Transport",    ship: "SHP-2024-1849", agreed: 2200, billed: 2200, issue: "",                          auditStatus: AUDIT_STATUS.MATCHED,     payStatus: PAY_STATUS.PENDING },
  { inv: "INV-84428", carrier: "FedEx Freight",      ship: "SHP-2024-1843", agreed: 1420, billed: 1420, issue: "",                          auditStatus: AUDIT_STATUS.MATCHED,     payStatus: PAY_STATUS.APPROVED },
];

export function computeAuditKpis(records) {
  const total = records.length;
  const matched = records.filter((r) => r.auditStatus === AUDIT_STATUS.MATCHED).length;
  const discrepancies = records.filter((r) => r.auditStatus === AUDIT_STATUS.DISCREPANCY).length;
  const pendingReview = records.filter((r) => r.payStatus === PAY_STATUS.PENDING || r.payStatus === PAY_STATUS.ON_HOLD).length;

  const recovered = records
    .filter((r) => r.auditStatus === AUDIT_STATUS.DISCREPANCY)
    .reduce((sum, r) => sum + Math.abs(r.billed - r.agreed), 0);

  return { total, matched, discrepancies, pendingReview, recovered };
}

export function computeVariance(agreed, billed) {
  return billed - agreed;
}

export function formatVariance(variance) {
  if (variance === 0) return "$0";
  const prefix = variance > 0 ? "+$" : "-$";
  return prefix + Math.abs(variance).toLocaleString();
}
