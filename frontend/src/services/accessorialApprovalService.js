// Approved extras on a shipment (migration 051). UI-side service only.
import { AccessorialApprovalsApi } from "../lib/api";

export const ACCESSORIAL_TYPES = [
  "liftgate", "detention", "lumper", "layover", "redelivery",
  "inside_delivery", "residential", "limited_access", "other",
];

export function approvalBasis(a) {
  if (a.max_hours != null && a.rate_per_hour != null) {
    return `${Number(a.max_hours)} hrs × $${Number(a.rate_per_hour).toFixed(2)} = $${(Number(a.max_hours) * Number(a.rate_per_hour)).toFixed(2)}`;
  }
  return `up to $${Number(a.max_amount).toFixed(2)}`;
}

export function typeLabel(t) {
  const s = String(t || "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function listApprovals(shipmentId) {
  const res = await AccessorialApprovalsApi.list(shipmentId);
  return res.approvals || [];
}

export function addApproval(shipmentId, { accessorialType, basis, maxHours, ratePerHour, maxAmount, notes }) {
  const payload = basis === "hourly"
    ? { accessorialType, maxHours: Number(maxHours), ratePerHour: Number(ratePerHour), notes }
    : { accessorialType, maxAmount: Number(maxAmount), notes };
  return AccessorialApprovalsApi.create(shipmentId, payload);
}

export function removeApproval(shipmentId, approvalId) {
  return AccessorialApprovalsApi.remove(shipmentId, approvalId);
}
