// Carrier invoice PDF intake — UI-side service. Reads files, uploads them
// one at a time (keeps each request under the API's 10 MB body limit) and
// shapes results for the upload modal. No business rules here: the server
// reads, checks and audits.
import { InvoiceIntakeApi, InvoicesApi } from "../lib/api";

export const MAX_PDF_MB = 7;

export const INTAKE_STATUS = {
  created: { label: "Created", tone: "ok" },
  duplicate: { label: "Duplicate — not created", tone: "warn" },
  needs_manual: { label: "Needs manual entry", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
};

// What AP sees for each document. The server decides the outcome
// (invoiceIntake/intakeLog.js); these are only the words and colours.
export const INTAKE_OUTCOME = {
  ready_to_post: { label: "Ready to post", tone: "ok" },
  needs_review: { label: "Needs review", tone: "warn" },
  disputed: { label: "Disputed", tone: "bad" },
  deleted: { label: "Invoice deleted", tone: "none" },
  duplicate: { label: "Duplicate", tone: "warn" },
  needs_manual: { label: "Needs manual entry", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
};
export const INTAKE_OUTCOME_ORDER = ["needs_review", "ready_to_post", "disputed", "duplicate", "needs_manual", "failed", "deleted"];

/** Outcome code of a log entry or a live run result. */
export function outcomeCode(result) {
  if (result.outcome) return result.outcome;
  if (result.status === "created") return result.sentToAp ? "ready_to_post" : "needs_review";
  return result.status;
}

export function outcomeLabel(result) {
  return INTAKE_OUTCOME[outcomeCode(result)]?.label || result.status;
}

export function outcomeTone(result) {
  return INTAKE_OUTCOME[outcomeCode(result)]?.tone || "bad";
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Upload PDFs sequentially; onResult fires after each file.
 * @param {File[]} files
 * @param {(result:object, index:number) => void} onResult
 */
export async function uploadInvoicePdfs(files, onResult) {
  const results = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    let result;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      result = { fileName: file.name, status: "failed", summary: "Not a PDF." };
    } else if (file.size > MAX_PDF_MB * 1024 * 1024) {
      result = { fileName: file.name, status: "failed", summary: `Larger than ${MAX_PDF_MB} MB.` };
    } else {
      try {
        result = await InvoiceIntakeApi.uploadPdf(file.name, await fileToBase64(file));
      } catch (e) {
        result = { fileName: file.name, status: "failed", summary: e.message || "Upload failed" };
      }
    }
    results.push(result);
    if (onResult) onResult(result, i);
  }
  return results;
}

// ── AP inbox folder ─────────────────────────────────────────────────
/** PDFs waiting in the active domain's inbox folder, plus the latest run. */
export const getInbox = () => InvoiceIntakeApi.inbox();
/** Start reading every new PDF in the inbox. Poll getInbox() for progress. */
export const startInboxRun = () => InvoiceIntakeApi.runInbox();

// ── AP mailbox ──────────────────────────────────────────────────────
/** Mailbox state plus the invoices read from email since `since` (ISO), for the active domain. */
export const getMailbox = (since) => InvoiceIntakeApi.mailbox(since);
/** Check the mailbox now. Poll getMailbox() for progress. */
export const startMailboxRun = () => InvoiceIntakeApi.runMailbox();

// ── Agent run log (migration 056) ───────────────────────────────────
/** Scheduled mailbox checks and button presses for the active domain, plus the timer state. */
export const getIntakeRuns = (limit) => InvoiceIntakeApi.runs(limit);
/** One run and the invoice documents it read. */
export const getIntakeRun = (id) => InvoiceIntakeApi.run(id);

export const RUN_STATUS = {
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  interrupted: { label: "Interrupted", tone: "warn" },
};

/** "42 s", "3 min 5 s" or "—". */
export function runDuration(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return "—";
  const s = Math.max(0, Math.round(Number(ms) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}`;
}

/** "5 minutes" for 300, "90 seconds" for 90. */
export function runEvery(sec) {
  const n = Number(sec) || 0;
  if (n && n % 60 === 0) return n === 60 ? "minute" : `${n / 60} minutes`;
  return `${n} seconds`;
}

/** One-line outcome of a set of intake results. */
export function intakeSummary(results) {
  return inboxRunSummary({ results });
}

export function inboxRunSummary(job) {
  if (!job) return "";
  const r = job.results || [];
  const n = (code) => r.filter((x) => outcomeCode(x) === code).length;
  const part = (code, words) => (n(code) ? `${n(code)} ${words}` : null);
  return [`${r.length} read`, `${n("ready_to_post")} ready to post`, `${n("needs_review")} need review`,
    part("duplicate", "duplicate"), part("needs_manual", "to key by hand"), part("failed", "failed"), part("deleted", "deleted since")]
    .filter(Boolean).join(" · ");
}

// ── Intake log ──────────────────────────────────────────────────────
/** Every invoice document received for the active domain: { entries, summary }. */
export const getIntakeLog = (limit) => InvoiceIntakeApi.log(limit);

/** Object URL of the original document (caller revokes it with URL.revokeObjectURL). */
export async function getIntakeFileUrl(intakeId) {
  const blob = await InvoiceIntakeApi.file(intakeId);
  return URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
}

/**
 * Open the original PDF of an invoice in a new tab. The tab is opened
 * first (inside the click) so the browser does not block it as a pop-up.
 */
export async function openInvoiceDocument(invoiceId) {
  const tab = window.open("", "_blank");
  try {
    const blob = await InvoicesApi.document(invoiceId);
    const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
    if (tab) tab.location.href = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (tab) tab.close();
    throw e;
  }
}

/** One document in detail for the review drawer. */
export const getIntakeDetail = (intakeId) => InvoiceIntakeApi.detail(intakeId);

// How each invoice line compares with the contract and the TMS (server decides the status).
export const LINE_STATUS = {
  match: { label: "Match", tone: "ok" },
  over: { label: "Over contract", tone: "bad" },
  not_approved: { label: "Missing accessorial approval", tone: "warn" },
  no_reference: { label: "No shipment to check", tone: "warn" },
  not_checked: { label: "Not audited", tone: "warn" },
};

// Sender verification (email only). Server decides; these are the words.
export const SENDER_STATUS = {
  verified: { label: "Verified", tone: "ok" },
  unverified: { label: "Unverified", tone: "bad" },
  unregistered: { label: "No billing email on file", tone: "warn" },
  not_checked: { label: "Not checked (not received by email)", tone: "none" },
};

/** Whether an invoice may be paid, as AP sees it. */
export function paymentEligibility(outcome) {
  if (outcome === "ready_to_post") return { label: "Ready to post", tone: "ok" };
  if (outcome === "disputed") return { label: "Disputed with carrier", tone: "bad" };
  return { label: "On hold", tone: "warn" };
}

// AP decisions on held invoices go through apReleaseService.resolveException
// (a written justification is required and recorded in the AP audit ledger).

/** Ready-to-post entries (counted on the AP review screen; exported via Release & export). */
export function readyToPostRows(entries) {
  return (entries || []).filter((e) => e.outcome === "ready_to_post").map((e) => ({
    number: e.invoiceNumber, carrier: e.carrier, shipments: [e.shipmentRef].filter(Boolean),
    billed: e.total, payAmount: e.total, basis: "Matches contract rate and approved extras",
  }));
}
