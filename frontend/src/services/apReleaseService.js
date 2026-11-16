// AP release & NetSuite-ready export — UI-side service (migration 054).
// The server decides every rule (api/services/apRelease); this module only
// calls it and holds the words AP sees. NetSuite is read-only in the pilot:
// nothing here posts a bill or a payment.
import { ApReleaseApi } from "../lib/api";

export const MIN_JUSTIFICATION = 15;
export const MIN_OVERRIDE_JUSTIFICATION = 20;

export const RELEASE_PATH = {
  validated: { label: "Agent-validated", tone: "ok", hint: "3-way match clean; re-run clean at release" },
  revalidated: { label: "Exception revalidated", tone: "info", hint: "A person approved the exception and the 3-way match now passes" },
  authorized_override: { label: "Authorized override", tone: "warn", hint: "Released by an authorized approver despite a failed revalidation" },
};

export const EVENT_LABEL = {
  exception_approved: "Exception approved",
  exception_disputed: "Disputed with carrier",
  revalidated: "Revalidated",
  released: "Released for export",
  release_blocked: "Release refused",
  override_released: "Override release",
  exported: "Exported",
  export_downloaded: "CSV downloaded again",
  import_confirmed: "Import confirmed by AP",
};

export const getQueue = () => ApReleaseApi.queue();
export const getExports = () => ApReleaseApi.exports();
export const getInvoiceHistory = async (invoiceId) => (await ApReleaseApi.history(invoiceId)).events || [];
export const getBatchHistory = async (batchId) => (await ApReleaseApi.batchHistory(batchId)).events || [];
export const revalidateInvoice = (invoiceId) => ApReleaseApi.revalidate(invoiceId);
/** AP's acknowledgement that they imported a batch; `reference` is NetSuite's import job / saved-import id (optional). */
export const confirmImport = (batchId, reference = "") => ApReleaseApi.confirmImport(batchId, String(reference || "").trim());

/**
 * A person's decision on a held invoice. Approving needs a written
 * justification; the server re-checks and records it in the audit ledger.
 * @param {"approve"|"dispute"} action
 */
export function resolveException(invoiceId, action, justification) {
  return ApReleaseApi.resolve(invoiceId, action, String(justification || "").trim());
}

/** Release one invoice. Pass `overrideJustification` only for an authorized override. */
export function releaseInvoice(invoiceId, { note = "", overrideJustification = null } = {}) {
  return ApReleaseApi.release(invoiceId, {
    note: String(note || "").trim(),
    ...(overrideJustification != null ? { override: { justification: String(overrideJustification).trim() } } : {}),
  });
}

/** Release several on the normal path. Returns per-invoice results. */
export const releaseInvoices = (invoiceIds, note = "") => ApReleaseApi.releaseMany(invoiceIds, String(note || "").trim());

function saveCsv(text, fileName) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Create the next export batch from released invoices and download its CSV. */
export async function exportReleased(invoiceIds = null) {
  const out = await ApReleaseApi.createExport(invoiceIds);
  saveCsv(out.csv, out.fileName);
  return out;
}

/** Download an existing batch's CSV again (same batch — not a new export). */
export async function downloadBatch(batch) {
  const text = await ApReleaseApi.batchCsv(batch.id);
  saveCsv(text, batch.fileName);
}

/** One-line summary of a batch release result. */
export function releaseSummary(out) {
  if (!out) return "";
  const refused = (out.results || []).filter((r) => !r.ok);
  const head = `${out.released} released for export`;
  return refused.length ? `${head}; ${refused.length} refused — ${refused.map((r) => r.error).join(" ")}` : `${head}.`;
}
