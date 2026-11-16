// ═══════════════════════════════════════════════════════════════════
// Agent catalog — the five back-office agents and every action type
// they can propose. Single source of truth for:
//   • which agents exist (agent_runs.agent CHECK, migration 050)
//   • which action types exist (agent_actions.action_type CHECK)
//   • which table an approver needs Edit on before an action executes
//     (same role-matrix gate the UI routes use)
// ═══════════════════════════════════════════════════════════════════

'use strict';

const AGENTS = Object.freeze({
  quote: {
    key: 'quote',
    label: 'Quote Agent',
    summary: 'Reads an RFQ email, rates the lane against your contracts with live EIA fuel, applies margin, drafts the quote reply.',
  },
  carrier_sourcing: {
    key: 'carrier_sourcing',
    label: 'Carrier Sourcing Agent',
    summary: 'For a load with no carrier, ranks carriers on lane rates, service, claims and capacity, then drafts load offers.',
  },
  track_trace: {
    key: 'track_trace',
    label: 'Track & Trace Agent',
    summary: 'Scans moving loads for late pickups and ETA risk, drafts check calls, reads carrier replies into shipment events.',
  },
  freight_audit: {
    key: 'freight_audit',
    label: 'Freight Audit Agent',
    summary: 'Re-audits carrier invoices line by line against the rated shipment and EIA fuel table; flags overbilling and duplicates.',
  },
  document_pod: {
    key: 'document_pod',
    label: 'Document / POD Agent',
    summary: 'Reads a POD or BOL (photo, PDF or text), matches the shipment, confirms delivery, triggers invoicing, flags OS&D.',
  },
});

/** action_type → { agent, label, table (role-matrix gate) } */
const ACTION_TYPES = Object.freeze({
  SEND_QUOTE:           { agent: 'quote',            label: 'Send quote to customer',      table: 'orders' },
  SEND_LOAD_OFFER:      { agent: 'carrier_sourcing', label: 'Send load offer to carrier',  table: 'shipments' },
  ASSIGN_CARRIER:       { agent: 'carrier_sourcing', label: 'Assign carrier to shipment',  table: 'shipments' },
  SEND_CHECK_CALL:      { agent: 'track_trace',      label: 'Send check call to carrier',  table: 'shipments' },
  APPLY_SHIPMENT_EVENT: { agent: 'track_trace',      label: 'Record shipment event',       table: 'shipments' },
  NOTIFY_CUSTOMER:      { agent: 'track_trace',      label: 'Notify customer of delay',    table: 'shipments' },
  DISPUTE_INVOICE:      { agent: 'freight_audit',    label: 'Dispute invoice',             table: 'invoices' },
  APPROVE_INVOICE:      { agent: 'freight_audit',    label: 'Approve invoice',             table: 'invoices' },
  MARK_DELIVERED:       { agent: 'document_pod',     label: 'Mark shipment delivered',     table: 'shipments' },
  CREATE_INVOICE:       { agent: 'document_pod',     label: 'Create invoice from shipment', table: 'invoices' },
  FLAG_OSD:             { agent: 'document_pod',     label: 'Flag OS&D exception',         table: 'shipments' },
});

const RUN_STATUS = Object.freeze({
  RUNNING: 'running', AWAITING_APPROVAL: 'awaiting_approval', COMPLETED: 'completed', FAILED: 'failed',
});
const ACTION_STATUS = Object.freeze({
  PROPOSED: 'proposed', EXECUTING: 'executing', EXECUTED: 'executed', REJECTED: 'rejected', FAILED: 'failed',
});
const TRIGGERS = Object.freeze(['manual', 'event', 'schedule', 'email']);

function assertAgent(key) {
  if (!AGENTS[key]) { const e = new Error(`Unknown agent '${key}'`); e.status = 404; throw e; }
  return AGENTS[key];
}

function assertActionType(type) {
  if (!ACTION_TYPES[type]) { const e = new Error(`Unknown action type '${type}'`); e.status = 400; throw e; }
  return ACTION_TYPES[type];
}

module.exports = { AGENTS, ACTION_TYPES, RUN_STATUS, ACTION_STATUS, TRIGGERS, assertAgent, assertActionType };
