// ═══════════════════════════════════════════════════════════════════
// AP release & NetSuite export — the workflow after Freight Audit.
//
//   agent 3-way match ─► ready to post ─► AP releases ─► export batch (CSV)
//                    └─► needs review ─► AP approves with justification
//                                        (or disputes) ─► revalidate ─► release
//
// NetSuite is read-only in the pilot: an export is a CSV AP imports
// themselves. Nothing here creates bills or initiates payments.
//
// Every step writes an immutable ap_audit_events row (who, when, why)
// and mirrors status changes into change_history so the invoice's
// existing activity view shows them too.
//
// createApReleaseService(deps) takes its collaborators so the workflow
// is unit-tested without a database; the module exports a default
// instance wired to the real repository.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('node:crypto');
const policy = require('./releasePolicy');
const netsuiteCsv = require('./netsuiteCsv');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const usd = (n) => `$${r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const who = (user) => (user && (user.email || user.username)) || 'unknown';
const httpError = (status, message) => Object.assign(new Error(message), { status });
const PASS = new Set(['approve', 'review']);

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function createApReleaseService({
  repo, auditOne, history = null, env = process.env,
  now = () => new Date(), rand = () => Math.random().toString(36).slice(2, 6).toUpperCase(),
}) {
  const domain = () => (repo.currentDomain ? repo.currentDomain() : 'ZOREE');

  async function record(events) {
    const rows = events.map((e) => ({ domain_code: domain(), payload: {}, ...e }));
    return repo.insertAuditEvents(rows);
  }

  async function mirror(user, invoiceId, field, after, reason) {
    if (!history) return;
    try {
      await history.recordChange({ entityType: 'invoice', entityId: invoiceId, action: 'status', field, before: null, after, user, metadata: { reason } });
    } catch (_) { /* change_history is the secondary view; ap_audit_events is the ledger */ }
  }

  /** Bill keys of every invoice already released or exported, except `exceptId`. */
  async function takenBillKeys(exceptId) {
    const [releases, items] = await Promise.all([repo.listReleases(), repo.listExportItems()]);
    const keys = new Set(items.filter((x) => x.invoice_id !== exceptId).map((x) => `${x.carrier_key}|${String(x.invoice_number).toUpperCase()}`));
    for (const r of releases) if (r.invoice_id !== exceptId) keys.add(`${r.carrier_key}|${r.invoice_number_key}`);
    return keys;
  }

  async function revalidationOf(invoice) {
    try {
      const r = await auditOne(invoice);
      return { verdict: r.audit.verdict, issues: r.audit.issues || [], passed: r.audit.passed || [], payAmount: r.audit.payAmount };
    } catch (e) {
      return { verdict: 'error', issues: [{ detail: `Revalidation could not run: ${e.message}` }], passed: [] };
    }
  }

  async function standingOf(invoice, { withAudit = true } = {}) {
    const [release, items, taken] = await Promise.all([
      repo.getRelease(invoice.id), repo.listExportItems({ invoiceIds: [invoice.id] }), takenBillKeys(invoice.id),
    ]);
    const audit = withAudit && !release && !items.length ? await revalidationOf(invoice) : null;
    const standing = policy.classify({ invoice, release, exportItem: items[0] || null, takenBillKeys: taken, audit });
    return { standing, release, exportItem: items[0] || null, audit };
  }

  // ── Exceptions: a person approves (with justification) or disputes ──
  async function resolveException({ invoiceId, action, justification, user, actorRole = null }) {
    const invoice = await repo.getInvoice(invoiceId);
    const v = policy.validateResolution({ invoice, action, justification });
    if (!v.ok) throw httpError(v.status, v.error);
    const label = invoice.invoice_number || invoice.id;
    // Same change_history rows manualDecide writes (invoice + each linked shipment), so the
    // invoice and shipment activity views show the decision.
    const shipmentIds = Array.isArray(invoice.shipment_ids) && invoice.shipment_ids.length ? invoice.shipment_ids : (invoice.shipment_id ? [invoice.shipment_id] : []);
    const historyRows = history ? [
      history.buildRow({ entityType: 'invoice', entityId: invoiceId, action: 'status', field: 'status', before: invoice.status, after: v.decision, user, metadata: { reason: v.reason, manual: true, apResolution: true } }),
      ...shipmentIds.map((sid) => history.buildRow({ entityType: 'shipment', entityId: sid, action: 'invoice', field: 'status', before: invoice.status, after: v.decision, user,
        metadata: { invoiceId, invoiceNumber: invoice.invoice_number, carrier: invoice.carrier, invoicedAmount: invoice.invoiced_amount, agreedCost: invoice.agreed_cost, decisionReason: v.reason, manual: true } })),
    ].map(({ created_at: _c, ...row }) => row) : []; // eslint-disable-line camelcase
    // One transaction: lock, re-check it is still held, decide, history, ledger.
    const updated = await repo.resolveException({
      invoiceId, decision: v.decision, reason: v.reason, by: who(user), byId: (user && (user.id || user.sub)) || null, role: actorRole,
      history: historyRows, eventType: action === 'approve' ? 'exception_approved' : 'exception_disputed',
      detail: action === 'approve'
        ? `${label}: exception approved by ${who(user)} — "${v.reason}". Not export-eligible until revalidated and released.`
        : `${label}: disputed with ${invoice.carrier} by ${who(user)} — "${v.reason}". Blocked from export.`,
      payload: { invoiced: r2(invoice.invoiced_amount), agreed: invoice.agreed_cost == null ? null : r2(invoice.agreed_cost), variance: invoice.variance == null ? null : r2(invoice.variance), agentFinding: invoice.decision_reason || null },
    });
    return { invoice: updated, next: action === 'approve' ? 'Revalidate and release it under Release & export.' : null };
  }

  // ── Revalidate on demand (re-run the 3-way match against live TMS data) ──
  async function revalidate({ invoiceId, user, actorRole = null }) {
    const invoice = await repo.getInvoice(invoiceId);
    if (!invoice) throw httpError(404, 'Invoice not found in this domain');
    const { standing, audit } = await standingOf(invoice);
    if (audit) {
      await record([{ invoice_id: invoiceId, event_type: 'revalidated', actor: who(user), actor_role: actorRole,
        detail: `${invoice.invoice_number}: 3-way match re-run — ${PASS.has(audit.verdict) ? 'passes' : `still fails (${(audit.issues[0] || {}).detail || audit.verdict})`}.`,
        payload: { verdict: audit.verdict, issues: audit.issues.map((i) => i.detail) } }]);
    }
    return { invoiceId, standing, audit };
  }

  // ── Release one invoice for export ──────────────────────────────
  async function release({ invoiceId, note = '', override = null, user, isAdmin = false, actorRole = null }) {
    const invoice = await repo.getInvoice(invoiceId);
    if (!invoice) throw httpError(404, 'Invoice not found in this domain');
    const { standing, audit } = await standingOf(invoice);
    const decision = policy.decideRelease({ standing, actor: { email: who(user), isAdmin }, override, env });
    const label = invoice.invoice_number || invoice.id;
    if (!decision.ok) {
      if (standing.state !== 'released' && standing.state !== 'exported') {
        await record([{ invoice_id: invoiceId, event_type: 'release_blocked', actor: who(user), actor_role: actorRole,
          detail: `${label}: release refused — ${decision.error}`, payload: { verdict: audit && audit.verdict, override: Boolean(override) } }]);
      }
      throw httpError(decision.status, decision.error);
    }
    const words = {
      validated: 'agent-validated, revalidated clean at release',
      revalidated: `exception approved by ${standing.exceptionApprovedBy}, revalidated clean at release`,
      authorized_override: `AUTHORIZED OVERRIDE by ${who(user)} — "${decision.path === 'authorized_override' ? String(override.justification).trim() : ''}"`,
    }[decision.path];
    // One transaction: lock the invoice, refuse if it changed since this revalidation, write release + ledger.
    const [carrierKey, invoiceNumberKey] = policy.billKey(invoice).split('|');
    const row = await repo.releaseInvoice({
      invoiceId, path: decision.path, by: who(user), byId: (user && (user.id || user.sub)) || null, role: actorRole,
      note: String(note || '').trim() || null, exceptionBy: standing.exceptionApprovedBy,
      justification: decision.path === 'authorized_override' ? String(override.justification).trim() : null,
      verdict: audit ? audit.verdict : 'not_run', expectedAmount: r2(invoice.invoiced_amount),
      expectedDecidedBy: invoice.decided_by == null ? null : invoice.decided_by,
      expectedDecidedAt: invoice.decided_at == null ? null : invoice.decided_at,
      carrierKey, invoiceNumberKey,
      eventType: decision.path === 'authorized_override' ? 'override_released' : 'released',
      detail: `${label} (${invoice.carrier}, ${usd(invoice.invoiced_amount)}) released for NetSuite export — ${words}.`,
      payload: { path: decision.path, verdict: audit ? audit.verdict : null, note: String(note || '').trim() || null },
    });
    await mirror(user, invoiceId, 'ap_release', decision.path, row.note || `Released for NetSuite export (${decision.path})`);
    return { release: row, path: decision.path };
  }

  /** Release several on the normal path. Overrides are one at a time, never in a batch. */
  async function releaseMany({ invoiceIds, note = '', user, isAdmin = false, actorRole = null }) {
    const ids = [...new Set((invoiceIds || []).map(String))];
    if (!ids.length) throw httpError(400, 'Select at least one invoice to release');
    const results = [];
    for (const id of ids) {
      try {
        const r = await release({ invoiceId: id, note, user, isAdmin, actorRole });
        results.push({ invoiceId: id, ok: true, path: r.path });
      } catch (e) {
        results.push({ invoiceId: id, ok: false, error: e.message, status: e.status || 500 });
      }
    }
    return { results, released: results.filter((r) => r.ok).length, refused: results.filter((r) => !r.ok).length };
  }

  // ── Export: released, not yet exported → one NetSuite-ready batch ──
  async function createExport({ invoiceIds = null, user, actorRole = null }) {
    const [releases, exported] = await Promise.all([repo.listReleases(), repo.listExportItems()]);
    const invoices = await repo.listInvoicesByIds(releases.map((r) => r.invoice_id));
    const byId = new Map(invoices.map((i) => [i.id, i]));
    const released = []; const notApproved = [];
    for (const rel of releases) {
      const inv = byId.get(rel.invoice_id);
      if (!inv) continue;
      if (inv.status !== 'Approved') { if (!invoiceIds || invoiceIds.includes(inv.id)) notApproved.push({ invoiceId: inv.id, reason: `now ${inv.status} — no longer export-eligible` }); continue; }
      released.push({ invoice: inv, release: rel });
    }
    const { picked, skipped } = policy.selectForExport({ released, exported, onlyIds: invoiceIds });
    if (!picked.length) throw httpError(409, 'Nothing to export: no released invoice is waiting (exported invoices are never exported again).');

    const d = now();
    const batchId = `NSX-${domain()}-${stamp(d)}-${rand()}`;
    const fileName = `netsuite-vendor-bills-${batchId}.csv`;
    const items = picked.map(({ invoice: inv, release: rel }) => {
      const key = rel.carrier_key || policy.carrierKey(inv.carrier);
      return {
        invoice_id: inv.id, external_id: netsuiteCsv.externalIdFor({ domainCode: domain(), carrierKey: key, invoiceNumber: inv.invoice_number }),
        invoice_number: inv.invoice_number, carrier: inv.carrier, carrier_key: key,
        shipment_ref: inv.shipment_id || (Array.isArray(inv.shipment_ids) ? inv.shipment_ids.join(' ') : '') || '',
        invoice_date: inv.invoice_date || '', due_date: inv.due_date || '', amount: r2(inv.invoiced_amount),
        // release facts for the file; the RPC re-reads them from the release rows for the stored items
        release_path: rel.release_path, released_by: rel.released_by, released_at: rel.released_at,
      };
    });
    // The exact file is built once, hashed and stored with the batch: a re-download is byte-for-byte what AP imported.
    const { csv } = netsuiteCsv.buildCsv({ batch: { id: batchId }, items, env });
    const sha256 = crypto.createHash('sha256').update(csv, 'utf8').digest('hex');
    await repo.createExportBatch({
      batchId, fileName, createdBy: who(user), actorRole, csv, sha256,
      items: items.map(({ release_path, released_by, released_at, ...it }) => it), // eslint-disable-line camelcase, no-unused-vars
    });
    for (const it of items) await mirror(user, it.invoice_id, 'ap_export', batchId, `Exported in ${batchId} for AP to import into NetSuite`);
    const out = await batchCsv({ batchId, user, actorRole, log: false });
    return { ...out, skipped: [...skipped, ...notApproved] };
  }

  /** The batch's CSV, rebuilt from its stored items (identical every time). */
  async function batchCsv({ batchId, user, actorRole = null, log = true }) {
    const batch = await repo.getBatch(batchId);
    if (!batch) throw httpError(404, 'Export batch not found in this domain');
    const items = await repo.listExportItems({ batchIds: [batchId] });
    const rebuilt = netsuiteCsv.buildCsv({ batch, items, env });
    const total = rebuilt.total; const count = rebuilt.count;
    let csv = rebuilt.csv;
    if (batch.csv_content) {
      // Serve the stored file, after proving it is the one recorded at export.
      const sha = crypto.createHash('sha256').update(batch.csv_content, 'utf8').digest('hex');
      if (sha !== batch.csv_sha256) throw httpError(500, `Batch ${batchId}: the stored file does not match its recorded SHA-256`);
      csv = batch.csv_content;
    }
    if (r2(total) !== r2(batch.total_amount) || count !== batch.invoice_count) {
      throw httpError(500, `Batch ${batchId} does not reconcile: ${count} rows / ${usd(total)} vs recorded ${batch.invoice_count} / ${usd(batch.total_amount)}`);
    }
    if (log) {
      await record([{ batch_id: batchId, event_type: 'export_downloaded', actor: who(user), actor_role: actorRole,
        detail: `${batch.file_name} downloaded again (same batch, not a new export).` }]);
    }
    const { csv_content: _omit, ...batchOut } = batch; // eslint-disable-line no-unused-vars
    return { batch: batchOut, items, csv, sha256: batch.csv_sha256 || null, fileName: batch.file_name, total, count,
      missingConfig: netsuiteCsv.missingConfig(env, items.map((i) => i.carrier_key)) };
  }

  /** AP says they imported the batch into NetSuite (a human acknowledgement, not a write). */
  async function confirmImport({ batchId, reference = '', user, actorRole = null }) {
    const batch = await repo.getBatch(batchId);
    if (!batch) throw httpError(404, 'Export batch not found in this domain');
    if (batch.status !== 'exported') throw httpError(409, `${batchId} is already ${batch.status}`);
    // Status change + ledger entry in one transaction; refuses if someone confirmed it first.
    const updated = await repo.confirmImport({ batchId, by: who(user), role: actorRole, reference: String(reference || '').trim().slice(0, 120) });
    return { batch: updated };
  }

  /**
   * Legacy decision endpoints (/api/invoices/:id/approve|dispute) route held
   * invoices here so the justification + audit rules can't be bypassed.
   * Returns the updated invoice, or null when the invoice is not held.
   */
  async function resolveIfHeld({ invoiceId, action, justification, user, actorRole = null }) {
    const invoice = await repo.getInvoice(invoiceId);
    if (!invoice || !['On Hold', 'Pending'].includes(invoice.status)) return null;
    return (await resolveException({ invoiceId, action, justification, user, actorRole })).invoice;
  }

  // ── Read models ─────────────────────────────────────────────────
  async function queue() {
    const [approved, held, releases, items, batches] = await Promise.all([
      repo.listApprovedInvoices(), repo.listInvoicesByStatuses(['On Hold', 'Pending', 'Disputed', 'Rejected']),
      repo.listReleases(), repo.listExportItems(), repo.listBatches(20),
    ]);
    const relById = new Map(releases.map((r) => [r.invoice_id, r]));
    const itemById = new Map(items.map((i) => [i.invoice_id, i]));
    const takenAll = new Set(items.map((x) => `${x.carrier_key}|${String(x.invoice_number).toUpperCase()}`));
    for (const inv of approved) if (relById.has(inv.id)) takenAll.add(policy.billKey(inv));

    const rows = await Promise.all(approved.map(async (inv) => {
      const release = relById.get(inv.id) || null;
      const exportItem = itemById.get(inv.id) || null;
      const taken = new Set(takenAll);
      if (release || exportItem) taken.delete(policy.billKey(inv));
      // Preview revalidation for what is still waiting; the release itself re-runs it and records it.
      const audit = release || exportItem ? null : await revalidationOf(inv);
      const standing = policy.classify({ invoice: inv, release, exportItem, takenBillKeys: taken, audit });
      return {
        invoiceId: inv.id, invoiceNumber: inv.invoice_number, carrier: inv.carrier,
        shipment: inv.shipment_id || (inv.shipment_ids || []).join(' '), amount: r2(inv.invoiced_amount),
        invoiceDate: inv.invoice_date, approvedBy: inv.decided_by, approvedAt: inv.decided_at, approvalReason: inv.decision_reason,
        state: standing.state, path: standing.path, needsOverride: standing.needsOverride, blockers: standing.blockers,
        exceptionApprovedBy: standing.exceptionApprovedBy,
        revalidation: audit ? { verdict: audit.verdict, passes: PASS.has(audit.verdict), issues: audit.issues.map((i) => i.detail) } : null,
        release: release && { path: release.release_path, by: release.released_by, at: release.released_at, note: release.note, justification: release.override_justification },
        exportBatchId: exportItem ? exportItem.batch_id : null,
      };
    }));
    const heldRows = held.map((inv) => ({
      invoiceId: inv.id, invoiceNumber: inv.invoice_number, carrier: inv.carrier, shipment: inv.shipment_id,
      amount: r2(inv.invoiced_amount), status: inv.status, reason: inv.decision_reason,
      blockers: [`${inv.status} — blocked from export until a person resolves it.`],
    }));
    const sum = (list) => r2(list.reduce((s, x) => s + x.amount, 0));
    const by = (st) => rows.filter((r) => r.state === st);
    return {
      policy: { erpReadOnly: true, netsuiteWrites: false, overrideApprovers: Boolean(env.FREIGHT_AUDIT_OVERRIDE_APPROVERS) },
      awaitingRelease: by('awaiting_release'), released: by('released'), exported: by('exported'),
      blocked: [...by('blocked'), ...heldRows],
      totals: { awaitingRelease: sum(by('awaiting_release')), released: sum(by('released')), exported: sum(by('exported')) },
      batches: batches.map((b) => ({ id: b.id, status: b.status, fileName: b.file_name, invoiceCount: b.invoice_count, total: r2(b.total_amount), createdBy: b.created_by, createdAt: b.created_at, confirmedBy: b.confirmed_by, confirmedAt: b.confirmed_at })),
    };
  }

  async function exportsWithItems(limit = 20) {
    const batches = await repo.listBatches(limit);
    const items = batches.length ? await repo.listExportItems({ batchIds: batches.map((b) => b.id) }) : [];
    return {
      batches: batches.map((b) => ({
        id: b.id, status: b.status, fileName: b.file_name, invoiceCount: b.invoice_count, total: r2(b.total_amount),
        createdBy: b.created_by, createdAt: b.created_at, confirmedBy: b.confirmed_by, confirmedAt: b.confirmed_at,
        importReference: b.import_reference || null, sha256: b.csv_sha256 || null,
        items: items.filter((i) => i.batch_id === b.id).map((i) => ({
          lineNo: i.line_no, invoiceId: i.invoice_id, invoiceNumber: i.invoice_number, carrier: i.carrier,
          shipment: i.shipment_ref, amount: r2(i.amount), externalId: i.external_id, releasePath: i.release_path, releasedBy: i.released_by,
        })),
      })),
      missingConfig: netsuiteCsv.missingConfig(env, items.map((i) => i.carrier_key)),
    };
  }

  async function auditHistory({ invoiceId = null, batchId = null }) {
    const rows = await repo.listAudit({ invoiceId, batchId });
    return rows.map((r) => ({ id: r.id, at: r.created_at, type: r.event_type, actor: r.actor, role: r.actor_role, detail: r.detail, batchId: r.batch_id }));
  }

  return { resolveException, resolveIfHeld, revalidate, release, releaseMany, createExport, batchCsv, confirmImport, queue, exportsWithItems, auditHistory };
}

let _default = null;
/** The service wired to the real database, agent and history (lazy: keeps tests free of I/O). */
function defaultService() {
  if (!_default) {
    _default = createApReleaseService({
      repo: require('./repository'),
      auditOne: (inv) => require('../agents/freightAudit').auditOne(inv),
      history: require('../changeHistory'),
    });
  }
  return _default;
}

module.exports = { createApReleaseService, defaultService };
