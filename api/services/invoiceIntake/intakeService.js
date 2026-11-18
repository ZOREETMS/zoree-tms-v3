// ═══════════════════════════════════════════════════════════════════
// Carrier invoice PDF intake — the agent, end to end.
//
//   PDF → Claude reads it (pdfExtractor)
//       → read checks (readChecks)            fail → needs_manual, nothing saved
//       → sender check (senderCheck, email only) never stops the audit; an
//         unverified sender only stops automatic approval
//       → same PDF already in? → duplicate, nothing saved
//       → same carrier + invoice # already in? → revisionClassifier:
//           unchanged copy → duplicate · changed copy of a disputed/held one →
//           corrected revision (original Superseded) · changed copy of an
//           approved/paid one → a person handles credit/adjustment
//       → invoiceAudit.submitInvoice           (single writer of invoices; tolerance decision)
//       → invoiceCostLines.replaceForInvoice   (lines with accessorial_type)
//       → Freight Audit line audit (auditOne)  contract, fuel, approvals, duplicates, delivery
//       → settle: clean + Approved → send to AP; otherwise On Hold with the reasons
//       → invoice_intakes row for every PDF, whatever happened
//
// Claude reads; rules decide. Nothing here pays or posts anything.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const crypto = require('crypto');
const db = require('../supabase');
const invoiceAudit = require('../invoiceAudit');
const costLines = require('../invoiceCostLines');
const freightAudit = require('../agents/freightAudit');
const extractor = require('./pdfExtractor');
const readChecks = require('./readChecks');
const readVerifier = require('./readVerifier');
const repo = require('./intakeRepository');
const intakeFiles = require('./intakeFiles');
const senderCheck = require('./senderCheck');
const revisions = require('./revisionClassifier');
const runContext = require('./runContext');
const { currentDomain } = require('../domains/domainContext');
const { getApPolicy } = require('../agents/freightAudit/apPolicy');

const TAG = '[Zoree AI · Invoice intake]';
const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const tenantOf = (user) => (user && (user.tenantId || user.tenant_id)) || null;
const firstWord = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0] || '';

async function loadCarriers() {
  return db.dbSelect('carriers', { select: 'name,contact_email,email', limit: 2000 });
}


// Invoice numbers compare without case, spaces or punctuation:
// "GF-1001", "gf 1001" and "GF1001" are the same invoice.
const invoiceKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// A carrier often re-sends a disputed or held invoice under the same number
// with corrected charges. revisionClassifier decides duplicate / revision /
// a person; a revision is a new invoice linked to the original
// (supersedes_invoice_id), and the original becomes Superseded — kept with
// its audit history, never payable (migration 058).
// Decisions the agent makes are recorded as the agent, never as the person who
// uploaded the PDF or pressed the button (they stay on the intake as created_by).
// Otherwise an agent approval would look like a person's and change the release path.
const AGENT_USER = Object.freeze({ email: 'invoice-intake-agent', role: 'system' });

/** Every invoice from the same carrier with the same invoice number (normalized), with its charge lines. */
async function sameNumberInvoices(invoiceNumber, carrier) {
  const sel = 'id,invoice_number,carrier,status,invoiced_amount,shipment_id,received_at,created_at';
  const [byNumber, byCarrier] = await Promise.all([
    db.dbSelect('invoices', { select: sel, filters: [['invoice_number', 'eq', invoiceNumber]], limit: 20 }),
    // Prefix match so "ACME FREIGHT LLC" and "ACME FREIGHT" are both seen; the
    // first-word comparison below is the same carrier rule the read check uses.
    firstWord(carrier) ? db.dbSelect('invoices', { select: sel, filters: [['carrier', 'ilike', `${firstWord(carrier)}%`]], limit: 5000 }) : [],
  ]);
  const key = invoiceKey(invoiceNumber);
  const all = [...new Map([...byNumber, ...byCarrier].map((r) => [r.id, r])).values()];
  const rows = all.filter((r) => invoiceKey(r.invoice_number) === key && firstWord(r.carrier) === firstWord(carrier));
  const ids = rows.filter((r) => r.status !== 'Cancelled').map((r) => r.id);
  const lines = ids.length ? await db.dbSelect('invoice_cost_lines', { select: 'invoice_id,cost_type,accessorial_type,invoice_cost', filters: [['invoice_id', 'in', ids]], limit: 1000 }) : [];
  return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.invoice_id === r.id) }));
}

/** Match the printed shipment reference to a shipment id ("qa-sh-013", "Ref: QA-SH-014"). */
async function resolveShipmentRef(printed) {
  const ref = String(printed || '').trim();
  if (!ref) return ref;
  const up = ref.toUpperCase();
  const cands = [...new Set([ref, up, ...(up.match(/[A-Z0-9]+(?:-[A-Z0-9]+)+/g) || [])])];
  const rows = await db.dbSelect('shipments', { select: 'id', filters: [['id', 'in', cands]], limit: cands.length });
  const ids = new Set(rows.map((r) => r.id));
  return cands.find((c) => ids.has(c)) || ref;
}

async function invoiceExists(id) {
  if (!id) return false;
  const rows = await db.dbSelect('invoices', { select: 'id', filters: [['id', 'eq', id]], limit: 1 });
  return rows.length > 0;
}

/**
 * Shipment-row drafts (rated cost, made from the shipment's Invoice button)
 * that nobody has acted on give way to the carrier's own invoice. Drafts
 * someone decided on or edited stay — a person owns those.
 */
async function shipmentDrafts(shipmentId, exceptId) {
  if (!shipmentId) return { untouched: [], kept: [] };
  const rows = await db.dbSelect('invoices', { select: 'id,invoice_number,status,metadata,decided_at,invoiced_amount', filters: [['shipment_id', 'eq', shipmentId]], limit: 50 });
  const open = rows.filter((r) => r.id !== exceptId && r.metadata && r.metadata.created_from === 'shipment' && !['Approved', 'Paid', 'Cancelled'].includes(r.status));
  // Untouched = still exactly as generated: no decision, rated total, and no
  // edit of any kind in its history (only the 'create' row).
  const ids = open.map((r) => r.id);
  const hist = ids.length ? await db.dbSelect('change_history', { select: 'entity_id,action', filters: [['entity_type', 'eq', 'invoice'], ['entity_id', 'in', ids]], limit: 500 }) : [];
  const edited = new Set(hist.filter((h) => h.action !== 'create').map((h) => h.entity_id));
  const isUntouched = (r) => (r.status === 'On Hold' || r.status === 'Pending') && !r.decided_at && !edited.has(r.id)
    && Number(r.invoiced_amount) === Number(r.metadata.shipment_total_cost);
  return { untouched: open.filter(isUntouched), kept: open.filter((r) => !isUntouched(r)) };
}

async function closeDrafts({ invoice, drafts, user }) {
  for (const d of drafts.untouched) {
    await invoiceAudit.manualDecide({ invoiceId: d.id, decision: 'Cancelled', user,
      reason: `${TAG} Draft from the shipment row replaced by carrier invoice ${invoice.invoice_number} (${invoice.id}).` });
  }
  const notes = [];
  if (drafts.untouched.length) notes.push(`Replaces draft ${drafts.untouched.map((d) => d.invoice_number).join(', ')}.`);
  // Someone worked on these drafts, so they stay — but AP must not pay both.
  if (drafts.kept.length) notes.push(`The shipment also has draft ${drafts.kept.map((d) => `${d.invoice_number} (${d.status})`).join(', ')} that someone edited — close it if this invoice replaces it; do not pay both.`);
  return notes.length ? ` ${notes.join(' ')}` : '';
}

function readColumns(read, chk, verify = null) {
  const f = read.fields;
  return {
    invoice_number: f.invoiceNumber, carrier: chk.carrier || f.carrier, shipment_ref: f.shipmentRef,
    total: f.total, read_confidence: f.confidence, model: read.model,
    read_warnings: f.warnings,
    // The independent Jev check rides with the read (raw_extraction is jsonb).
    raw_extraction: verify ? { ...f, verify } : f,
  };
}

/**
 * Decide what happens to a just-created invoice once the line audit is in.
 * `sender` (senderCheck.verify) can only hold an invoice, never clear one.
 */
async function settle({ invoice, decision, audit, user, sender = null, policy = getApPolicy(), revisionOf = null }) {
  const a = audit.audit;
  // A corrected revision is audited like any new invoice: if it now matches
  // the contract, shipment and approved extras it is Ready to post; if not it
  // stays in Needs review with the new discrepancy. The note says what it replaced.
  const pre = revisionOf ? `Corrected revision of ${revisionOf.invoice_number} (was ${revisionOf.status}, now Superseded${revisionOf.changes ? `; ${revisionOf.changes}` : ''}). ` : '';
  const hold = async (why) => {
    await invoiceAudit.manualDecide({ invoiceId: invoice.id, decision: 'On Hold', reason: `${TAG} ${pre}${why}`.slice(0, 1000), user });
    return { invoiceStatus: 'On Hold', sentToAp: false, summary: `${pre}Needs AP review: ${why}` };
  };
  const senderHold = sender && (sender.status === 'unverified' || sender.status === 'unregistered');
  const reasons = [...a.issues.map((i) => i.detail), ...(senderHold ? [`Sender not verified: ${sender.detail}`] : [])];
  if (decision.status === 'Approved' && a.verdict === 'approve' && senderHold) {
    return hold(`Invoice audit passed, but the sender is not verified. ${sender.detail} Confirm with the carrier through a known contact before release.`);
  }
  if (decision.status === 'Approved' && a.verdict === 'approve' && policy.shadowMode) {
    // Live-system change freeze: the agent recommends, a person releases.
    return hold(`Shadow mode (change freeze ${policy.freeze || ''}): every check passed and the agent recommends approval, but nothing is released automatically during the freeze.`);
  }
  if (decision.status === 'Approved' && a.verdict === 'approve') {
    try {
      await invoiceAudit.sendToAp({ invoiceId: invoice.id, user });
    } catch (e) {
      if (e && e.code === 'ONE_PAYABLE') return hold(e.message);
      throw e;
    }
    return { invoiceStatus: 'Approved', sentToAp: true, summary: `${pre}Ready to post — matches the contract rate and approved extras (${money(invoice.invoiced_amount)}).` };
  }
  if (decision.status === 'Approved') {
    return hold(`Within carrier tolerance, but the line audit found: ${reasons.join(' ')}`);
  }
  // The agent never rejects a carrier's invoice. Anything that is not
  // clean is held with the reason, and a person in AP decides.
  // Missing data (no shipment, no contract rate): lead with what is missing, not a variance against nothing.
  const why = (a.verdict === 'needs_data' ? reasons : [decision.reason, ...reasons]).filter(Boolean).join(' ');
  if (decision.status !== 'On Hold' || pre) return hold(why);
  return { invoiceStatus: 'On Hold', sentToAp: false, summary: `Needs AP review: ${why}` };
}

function publicResult(intake, extra = {}) {
  return {
    intakeId: intake.id, fileName: intake.file_name, status: intake.status,
    invoiceId: intake.invoice_id, duplicateOfInvoiceId: intake.duplicate_of_invoice_id,
    invoiceNumber: intake.invoice_number, carrier: intake.carrier, shipmentRef: intake.shipment_ref,
    total: intake.total, confidence: intake.read_confidence,
    problems: intake.problems || [], summary: intake.outcome_reason, ...extra,
  };
}

/**
 * @param {{ fileName:string, buffer:Buffer, user:object, source?:'pdf_upload'|'email', preRead?:Promise<object> }} args
 */
// Interim guard until the DB-level unique claim (proposed migration): run the
// check-then-create part of intake one PDF at a time in this API process, so
// a mailbox run and a manual upload of the same invoice can't both pass the
// duplicate checks. Reads (preRead) still run in parallel.
let intakeChain = Promise.resolve();
function serialized(fn) {
  const run = intakeChain.then(fn, fn);
  intakeChain = run.catch(() => {});
  return run;
}

async function intakePdf(args) {
  if (args && args.preRead) args.preRead.catch(() => {}); // a rejected read is handled inside, in turn
  return serialized(() => intakePdfOnce(args));
}

async function intakePdfOnce({ fileName, buffer, user, source = 'pdf_upload', sender = null, senderAuth = null, preRead = null }) {
  const sha = sha256(buffer);
  const base = { source, file_name: fileName, file_sha256: sha, created_by: (user && user.email) || 'system', tenant_id: tenantOf(user),
    // The agent run reading this document (scheduled check / button), if any — migration 056.
    run_id: await runContext.currentRunId(currentDomain()) };
  // Every outcome is recorded with the original document, so AP can open
  // the PDF next to what was read. Keeping the file is best-effort.
  const keep = async (row) => {
    const rec = await repo.record(row);
    await intakeFiles.save({ intakeId: rec.id, fileName, buffer, tenantId: base.tenant_id }).catch(() => {});
    return rec;
  };

  // 1. The exact same file was already turned into an invoice.
  const prior = await repo.findCreatedByHash(sha);
  // (If that invoice was since deleted, read the file again.)
  if (prior && await invoiceExists(prior.invoice_id)) {
    return publicResult(await keep({ ...base, status: 'duplicate', duplicate_of_invoice_id: prior.invoice_id,
      outcome_reason: `This exact PDF was already received as ${prior.file_name}. Nothing created.` }));
  }

  // 2. Claude reads the PDF.
  let read;
  //    (preRead: a read already in flight for this buffer — the inbox run reads several PDFs at once.)
  try { read = await (preRead || extractor.extract(buffer)); } catch (e) {
    return publicResult(await keep({ ...base, status: 'failed', problems: [e.message], outcome_reason: `Could not read the PDF: ${e.message}` }));
  }

  // 3. Check the read before trusting it: Jev independently compares the
  //    read with the PDF's printed text, then the rule checks run.
  const carriers = await loadCarriers();
  const verify = await readVerifier.verify({ buffer, fields: read.fields });
  const chk = readChecks.check(read.fields, { knownCarriers: carriers.map((c) => c.name).filter(Boolean), verify });
  const cols = readColumns(read, chk, verify);
  if (!chk.ok) {
    return publicResult(await keep({ ...base, ...cols, status: 'needs_manual', problems: chk.problems,
      outcome_reason: chk.problems.every((p) => /not a carrier on file/.test(p))
        ? 'Not saved — carrier onboarding is needed first. The invoice was read, but there is no carrier, contract or remit-to on file to check it against.'
        : 'Not saved — a person should key this invoice. The agent does not audit numbers it could not read reliably.' }), { passed: chk.passed });
  }
  // Payment authorization, separate from invoice correctness: audited either way.
  const senderResult = senderCheck.verify({ sender, auth: senderAuth || {}, carrierRow: carriers.find((c) => c.name === chk.carrier) || null, source });

  // 4. Same carrier + invoice number already on file: duplicate, corrected
  //    revision, or a person (credit/adjustment, different shipment).
  const f = read.fields;
  const shipmentRef = await resolveShipmentRef(f.shipmentRef);
  cols.shipment_ref = shipmentRef;
  const sameNumber = await sameNumberInvoices(f.invoiceNumber, chk.carrier);
  const cls = revisions.classify(sameNumber, { total: f.total, shipmentId: shipmentRef, lines: chk.lines });
  if (cls.kind === 'duplicate') {
    return publicResult(await keep({ ...base, ...cols, status: 'duplicate', duplicate_of_invoice_id: cls.target.id,
      outcome_reason: cls.reason }), { passed: chk.passed });
  }
  if (cls.kind === 'adjustment' || cls.kind === 'needs_person') {
    // Nothing payable is created: a posted/paid invoice is never replaced automatically.
    return publicResult(await keep({ ...base, ...cols, status: 'needs_manual', problems: [cls.reason],
      outcome_reason: `${cls.reason} Nothing created.` }), { passed: chk.passed, revisionKind: cls.kind, relatedInvoiceId: cls.target && cls.target.id });
  }
  const revisionOf = cls.kind === 'revision' ? { ...cls.target, changes: cls.changes } : null;

  // 5. Create the invoice through the single writer; AP send waits for the line audit.
  const sub = await invoiceAudit.submitInvoice({
    invoiceNumber: f.invoiceNumber, carrier: chk.carrier, shipmentId: shipmentRef,
    invoicedAmount: f.total, invoiceDate: f.invoiceDate,
    notes: `Read from ${fileName} by Zoree AI`,
    metadata: { intake: { file: fileName, sha256: sha, model: read.model, confidence: f.confidence, pro_number: f.proNumber,
      sender: senderResult.sender, sender_verification: senderResult.status, sender_detail: senderResult.detail, sender_auth: senderResult.auth,
      ...(shipmentRef !== f.shipmentRef ? { printed_shipment_ref: f.shipmentRef } : {}),
      ...(revisionOf ? { revision_of: { id: revisionOf.id, number: revisionOf.invoice_number, status: revisionOf.status, changes: revisionOf.changes } } : {}) } },
    user: AGENT_USER, deferApSend: true,
  });
  const invoice = sub.invoice;

  // 6–7. Lines, line audit, settle. If anything fails after the invoice
  //      exists, park it On Hold with the reason — never leave it Approved
  //      without lines.
  try {
    await costLines.replaceForInvoice({ invoiceId: invoice.id, lines: chk.lines, tenantId: invoice.tenant_id || base.tenant_id });
    if (revisionOf) {
      // Link first, then retire the original — before the audit, so the
      // original is not counted as a second bill for the same load.
      await db.dbUpdate('invoices', invoice.id, { supersedes_invoice_id: revisionOf.id });
      await invoiceAudit.supersedeInvoice({ originalId: revisionOf.id, revision: invoice, changes: revisionOf.changes, user: AGENT_USER });
    }
    const drafts = await shipmentDrafts(shipmentRef, invoice.id);
    const audit = await freightAudit.auditOne(invoice);
    const outcome = await settle({ invoice, decision: sub.decision, audit, user: AGENT_USER, sender: senderResult, revisionOf });
    // Only now — the carrier's invoice exists and is audited — retire the drafts it supersedes.
    const draftNote = await closeDrafts({ invoice, drafts, user });
    const intake = await keep({ ...base, ...cols, status: 'created', invoice_id: invoice.id, outcome_reason: `${outcome.summary}${draftNote}` });
    return publicResult(intake, { invoiceStatus: outcome.invoiceStatus, sentToAp: outcome.sentToAp, passed: [...chk.passed, ...(audit.audit.passed || [])], issues: audit.audit.issues, recoverable: audit.audit.recoverable, ...(revisionOf ? { revisionOf: revisionOf.id } : {}) });
  } catch (e) {
    await invoiceAudit.manualDecide({ invoiceId: invoice.id, decision: 'On Hold', reason: `${TAG} Could not finish processing ${fileName}: ${e.message}`.slice(0, 1000), user }).catch(() => {});
    return publicResult(await keep({ ...base, ...cols, status: 'failed', invoice_id: invoice.id, problems: [e.message],
      outcome_reason: `Invoice ${invoice.id} created but processing stopped: ${e.message}. Put On Hold for review.` }));
  }
}

module.exports = { intakePdf, listRecent: repo.listRecent, _internals: { settle, invoiceKey, sameNumberInvoices } };
