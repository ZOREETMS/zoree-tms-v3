// Email order agent — UI-facing helpers over EmailIntakeApi.
// Drafts are edited in the review card and sent back on approve.
import { EmailIntakeApi } from "../lib/api";

export const INTAKE_TABS = [
  { key: "pending_review", label: "Needs review" },
  { key: "created", label: "Created" },
  { key: "not_order", label: "Not orders" },
  { key: "error", label: "Errors" },
  { key: "rejected", label: "Rejected" },
];

export const SHIP_MODES = ["TL", "LTL", "Parcel", "Intermodal", "Ocean", "Air"];
export const SERVICE_LEVELS = ["Standard", "Guaranteed", "Expedited", "Economy", "White Glove", "Time-Critical"];
export const REQUIRED_FIELDS = ["customer", "origin", "destination", "weight"];

export const getAgentStatus = () => EmailIntakeApi.status();
export const listIntake = (status) => EmailIntakeApi.list(status);
export const getIntake = (id) => EmailIntakeApi.get(id);
export const checkInboxNow = () => EmailIntakeApi.poll();
export const runOnPastedEmail = ({ from, subject, body }) => EmailIntakeApi.paste({ from, subject, body });
export const approveIntake = (id, drafts) => EmailIntakeApi.approve(id, drafts);
export const rejectIntake = (id, reason) => EmailIntakeApi.reject(id, reason);
export const retryIntake = (id) => EmailIntakeApi.retry(id);

/** Same rule as the server (intakeService.missingFor) so the button state matches what the API will accept. */
export function draftGaps(d) {
  const loc = (a) => a && (String(a.city || "").trim() || String(a.zip || "").trim());
  const gaps = [];
  if (!String(d.customer || "").trim()) gaps.push("customer");
  if (!loc(d.ship_from)) gaps.push("origin");
  if (!loc(d.ship_to)) gaps.push("destination");
  if (!(Number(d.weight_lbs) > 0)) gaps.push("weight");
  if (!d.ready_date) gaps.push("ready_date");
  if (!d.due_date) gaps.push("due_date");
  return gaps;
}

export const blocksApproval = (gaps) => gaps.some((g) => REQUIRED_FIELDS.includes(g));

export function confidenceTone(c) {
  const n = Number(c) || 0;
  if (n >= 0.9) return { bg: "#dcfce7", fg: "#166534", label: "High" };
  if (n >= 0.7) return { bg: "#fef3c7", fg: "#92400e", label: "Medium" };
  return { bg: "#fee2e2", fg: "#991b1b", label: "Low" };
}

/** Short label for a draft address: "Dallas, TX" or the ZIP. */
const placeLabel = (a) => (a ? [a.city, a.state].filter(Boolean).join(", ") || a.zip || "" : "");

/** Confirmation payload for the "orders created" banner after an approval. */
export function summarizeCreatedOrders(item, drafts, orderIds = []) {
  return {
    intakeId: item.id,
    subject: item.subject,
    from: item.from_name || item.from_address,
    orders: orderIds.map((id, i) => {
      const d = drafts[i] || {};
      return {
        id,
        customer: d.customer,
        po: d.po_number,
        lane: [placeLabel(d.ship_from), placeLabel(d.ship_to)].filter(Boolean).join(" → "),
        weight: d.weight_lbs,
      };
    }),
  };
}

/** One-line result of a manual inbox check. */
export function describeInboxCheck(r) {
  if (!r) return "";
  if (r.skipped) return r.reason;
  return `Checked ${r.scanned} matching emails · ${r.processed} new · ${r.pending_review || 0} to review · ${r.not_order || 0} not orders`;
}
