// AI agents — UI-facing helpers over AgentsApi.
import { AgentsApi } from "../lib/api";

/** Display order + icon for each agent (keys match api/services/agents/agentCatalog.js). */
export const AGENT_ORDER = ["quote", "email_orders", "carrier_sourcing", "track_trace", "document_pod", "freight_audit"];
export const AGENT_ICONS = {
  quote: "💲", email_orders: "📥", carrier_sourcing: "🚚", track_trace: "📡", freight_audit: "🧾", document_pod: "📄",
};

/** The email order agent has its own service and review queue (Email Orders);
 *  the console shows it as a tab alongside the five action agents. */
export const EMAIL_ORDER_AGENT = {
  key: "email_orders",
  label: "Email Order Agent",
  summary: "Reads order emails, extracts every order and its lines into a draft, and creates the order when a planner approves.",
};

/** Fields an approver can edit, per action type (mirrors each agent's editableFields). */
export const EDITABLE_FIELDS = {
  SEND_QUOTE: ["to", "subject", "body"],
  SEND_LOAD_OFFER: ["to", "subject", "body"],
  ASSIGN_CARRIER: ["total_cost"],
  SEND_CHECK_CALL: ["to", "subject", "body"],
  APPLY_SHIPMENT_EVENT: ["note"],
  NOTIFY_CUSTOMER: ["to", "subject", "body"],
  DISPUTE_INVOICE: ["to", "subject", "body"],
  APPROVE_INVOICE: ["reason"],
  MARK_DELIVERED: ["date", "note"],
  FLAG_OSD: ["note"],
};

export const RUN_STATUS_TONE = {
  running: { bg: "#e0f2fe", fg: "#075985", label: "Running" },
  awaiting_approval: { bg: "#fef3c7", fg: "#92400e", label: "Needs approval" },
  completed: { bg: "#dcfce7", fg: "#166534", label: "Done" },
  failed: { bg: "#fee2e2", fg: "#991b1b", label: "Failed" },
};

export const ACTION_STATUS_TONE = {
  proposed: { bg: "#fef3c7", fg: "#92400e", label: "Waiting for you" },
  executing: { bg: "#e0f2fe", fg: "#075985", label: "Running" },
  executed: { bg: "#dcfce7", fg: "#166534", label: "Done" },
  rejected: { bg: "#f1f5f9", fg: "#475569", label: "Rejected" },
  failed: { bg: "#fee2e2", fg: "#991b1b", label: "Failed" },
};

export const getCatalog = () => AgentsApi.catalog();
export const listRuns = (agent) => AgentsApi.runs(agent).then((r) => (Array.isArray(r) ? r : []));
export const runAgent = (agent, input) => AgentsApi.run(agent, input);
export const approveAction = (id, edits) => AgentsApi.approve(id, edits);
export const rejectAction = (id, reason) => AgentsApi.reject(id, reason);

export const money = (n) => (n === null || n === undefined || n === "" ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

/** Edits = the editable fields the approver actually changed. */
export function diffEdits(actionType, original, draft) {
  const out = {};
  for (const f of EDITABLE_FIELDS[actionType] || []) {
    if (draft[f] !== undefined && draft[f] !== original[f]) out[f] = draft[f];
  }
  return Object.keys(out).length ? out : null;
}

/** Read a File into { fileBase64, mediaType, fileName } for the POD agent. */
export function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ fileBase64: String(reader.result).split(",")[1], mediaType: file.type, fileName: file.name });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** One-line description of what an executed action did, from its result. */
export function describeResult(action) {
  const r = action.result || {};
  const mail = r.mail || r;
  const mailText = mail && "emailed" in mail
    ? (mail.emailed ? `Emailed ${mail.to}` : `Recorded${mail.messageLogId ? " in Messaging Hub" : ""} — not emailed (${mail.reason})`)
    : null;
  if (r.mail && r.status) return `Status now ${r.status} · ${mailText}`;
  if (mailText) return mailText;
  if (r.invoiceNumber || r.invoiceId) return `Invoice ${r.invoiceNumber || r.invoiceId}${r.reused ? " (already open)" : ""}${r.status ? ` · ${r.status}` : ""}`;
  if (r.status) return `Status now ${r.status}`;
  if (r.carrier) return `${r.shipmentId} now on ${r.carrier}`;
  if (r.shipmentStatus || r.eventType) return `${r.eventType || "Event"} recorded on ${r.shipmentId}${r.shipmentStatus ? ` · status ${r.shipmentStatus}` : ""}`;
  if (r.documentId) return `POD filed as ${r.documentId}`;
  return "Done";
}
