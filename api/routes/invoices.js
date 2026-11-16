// ═══════════════════════════════════════════════════════════════════
// Invoice Routes — REQ-06.
//
//   GET    /api/invoices               — list (admin | finance)
//   POST   /api/invoices                — submit new invoice; runs the
//                                         tolerance decision and returns
//                                         { invoice, decision }.
//   PATCH  /api/invoices/:id            — edit an existing invoice (Bug
//                                         #157 — replaces the brittle
//                                         /api/db/invoices/:id passthrough
//                                         that exposed raw column names).
//   DELETE /api/invoices/:id            — delete an invoice (REQ-192).
//                                         Writes a 'delete' audit row on
//                                         the invoice and a mirroring
//                                         row on each linked shipment
//                                         BEFORE removing the row.
//   POST   /api/invoices/:id/approve    — manual override (admin | finance)
//   POST   /api/invoices/:id/reject     — manual override (admin | finance)
//   POST   /api/invoices/:id/send-to-ap — mark approved invoice as sent
//                                         to AP (idempotent)
//
// Finance users own the approval workflow; admin has full access.
// Planners do NOT have write access to invoices.
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const invoiceAudit = require('../services/invoiceAudit');
const invoiceCostLines = require('../services/invoiceCostLines');
const invoiceIntake = require('../services/invoiceIntake/intakeService');
const inboxRun = require('../services/invoiceIntake/inboxRun');
const mailboxRun = require('../services/invoiceIntake/mailboxRun');
const intakeLog = require('../services/invoiceIntake/intakeLog');
const intakeDetail = require('../services/invoiceIntake/intakeDetail');
const intakeRepo = require('../services/invoiceIntake/intakeRepository');
const intakeFiles = require('../services/invoiceIntake/intakeFiles');
// QA P215 backend wiring (2026-05-11): public REST entry for the
// existing api/services/invoiceFromShipment service. The service was
// already used internally (e.g. by the shipment-confirm flow) but had
// no addressable route, so the web's "🧾 Invoice" button and the AI
// CREATE_INVOICE action both had to no-op. Exposing it here keeps the
// service as the single writer (the route is just a thin transport).
const invoiceFromShipment = require('../services/invoiceFromShipment');
// Migration 054/055: a held invoice decided through the legacy endpoints goes
// through the AP release rules (written justification + audit ledger).
const apRelease = require('../services/apRelease');

module.exports = function createInvoicesRouter({ verifyToken, hasAnyRole }) {
  function requireFinance(res, user) {
    if (!hasAnyRole(user, 'admin', 'finance')) {
      res.status(403).json({ error: `Role '${user.activeRole || 'unknown'}' cannot manage invoices. Required: admin or finance.` });
      return false;
    }
    return true;
  }

  router.get('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const db = require('../services/supabase');
      const filters = [];
      if (req.query.status)    filters.push(['status', 'eq', req.query.status]);
      if (req.query.carrier)   filters.push(['carrier', 'ilike', `%${req.query.carrier}%`]);
      if (req.query.shipment)  filters.push(['shipment_id', 'eq', req.query.shipment]);
      const rows = await db.dbSelect('invoices', {
        filters, order: { col: 'received_at', asc: false },
        limit: parseInt(req.query.limit, 10) || 500,
      });
      res.json({ invoices: rows, total: rows.length });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // ── Carrier invoice PDF intake (migration 051) ─────────────────
  // POST /api/invoices/intake/pdf  { fileName, contentBase64 }
  // One PDF per request (keeps the JSON body under the 10 MB limit).
  // Claude reads it, read checks gate it, Freight Audit line-audits it.
  router.post('/intake/pdf', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const { fileName, contentBase64 } = req.body || {};
      if (!fileName || !contentBase64) return res.status(400).json({ error: 'fileName and contentBase64 are required' });
      const buffer = Buffer.from(String(contentBase64), 'base64');
      const result = await invoiceIntake.intakePdf({ fileName: String(fileName).slice(0, 200), buffer, user });
      res.status(result.status === 'created' ? 201 : 200).json(result);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // ── AP mailbox ─────────────────────────────────────────────────
  // GET  /api/invoices/intake/mailbox?since=ISO — mailbox state + invoices read from email for this domain
  // POST /api/invoices/intake/mailbox/run       — check the mailbox now (background; poll the GET)
  router.get('/intake/mailbox', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try { res.json(await mailboxRun.status({ since: req.query.since })); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.post('/intake/mailbox/run', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try { res.status(202).json(mailboxRun.start({ user })); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── Agent run log (migration 056) ──────────────────────────────
  // GET /api/invoices/intake/runs?limit=50 — scheduled checks + button presses, newest first, with outcome counts
  // GET /api/invoices/intake/runs/:id      — one run and every document it read
  router.get('/intake/runs', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try { res.json(await mailboxRun.runLog({ limit: req.query.limit })); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.get('/intake/runs/:id', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try { res.json(await mailboxRun.runDetail(req.params.id)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // ── AP inbox folder ────────────────────────────────────────────
  // GET  /api/invoices/intake/inbox      — PDFs waiting in this domain's inbox + latest run
  // POST /api/invoices/intake/inbox/run  — read every new PDF (background; poll the GET)
  router.get('/intake/inbox', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try { res.json(await inboxRun.status()); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  router.post('/intake/inbox/run', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try { res.status(202).json(inboxRun.start({ user })); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // GET /api/invoices/intake/log — every invoice document received for this
  // domain with its AP outcome (ready to post / needs review / duplicate …)
  router.get('/intake/log', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try { res.json(await intakeLog.list({ limit: req.query.limit })); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // GET /api/invoices/intake/:id/detail — one document: what was read, each
  // line billed vs expected, the checks, and who did what
  router.get('/intake/:id/detail', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try { res.json(await intakeDetail.get(req.params.id)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // GET /api/invoices/intake/:id/file — the original document (PDF). The
  // intake row is loaded first so only users in its domain can read it.
  router.get('/intake/:id/file', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const intake = await intakeRepo.getById(req.params.id);
      const file = intake ? await intakeFiles.get(intake.id) : null;
      if (!file) return res.status(404).json({ error: 'The original document was not kept for this intake.' });
      res.setHeader('Content-Type', file.contentType || 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${String(file.fileName || 'invoice.pdf').replace(/[^\w.\- ]/g, '_')}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(file.buffer);
    } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  });

  // GET /api/invoices/:id/document — the original PDF an invoice was read
  // from. Looked up through the intake row, so only its domain can see it.
  router.get('/:id/document', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const intake = await intakeRepo.findByInvoiceId(req.params.id);
      const file = intake ? await intakeFiles.get(intake.id) : null;
      if (!file) return res.status(404).json({ error: 'No original document is kept for this invoice.' });
      res.setHeader('Content-Type', file.contentType || 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${String(file.fileName || 'invoice.pdf').replace(/[^\w.\- ]/g, '_')}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.send(file.buffer);
    } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  });

  // POST /api/invoices/:id/dispute { reason } — AP disputes the invoice with the carrier
  router.post('/:id/dispute', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const held = await apRelease.defaultService().resolveIfHeld({ invoiceId: req.params.id, action: 'dispute', justification: req.body?.reason, user, actorRole: user.activeRole || null });
      if (held) return res.json({ invoice: held });
      const updated = await invoiceAudit.manualDecide({ invoiceId: req.params.id, decision: 'Disputed', reason: req.body?.reason, user });
      res.json({ invoice: updated });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });

  // GET /api/invoices/intake — recent PDF intakes (what was read, what happened)
  router.get('/intake', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const rows = await invoiceIntake.listRecent(req.query.limit);
      res.json({ intakes: rows, total: rows.length });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.post('/', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const {
        invoiceNumber, carrier, carrierId, shipmentId, shipmentIds,
        bolId, bolIds,                                  // REQ-187
        invoicedAmount, invoiceDate, paymentTerms, notes, metadata,
      } = req.body || {};
      // REQ-07: forward shipmentIds[] so consolidated invoices reach the
      // service layer. Was previously dropped at this destructure (DEFECT-001).
      // REQ-187: forward bol* so the audit can validate the carrier-sent
      // BOL against the shipment of record before deciding.
      const out = await invoiceAudit.submitInvoice({
        invoiceNumber, carrier, carrierId, shipmentId, shipmentIds,
        bolId, bolIds,
        invoicedAmount, invoiceDate, paymentTerms, notes, metadata, user,
      });
      res.status(201).json(out);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // Bug #157: edit an existing invoice via the domain endpoint (the
  // service layer maps client field names → DB columns and records the
  // REQ-02 history diff). UI must NOT hit /api/db/invoices/:id directly.
  router.patch('/:id', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const updated = await invoiceAudit.editInvoice({
        invoiceId: req.params.id,
        patch:     req.body || {},
        user,
      });
      res.json(updated);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // POST /api/invoices/:id/decide — Approve Invoice button.
  //
  // Runs the carrier-tolerance check on this invoice (sum of approved
  // cost lines vs invoices.agreed_cost). On a pass: status='Approved'
  // and auto-sent to AP. On a fail: status='Rejected' with the variance
  // breakdown in decision_reason. Differs from /approve and /reject
  // (which are manual force-overrides) — this endpoint is the
  // automated decision path bound to the modal's primary action.
  router.post('/:id/decide', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const out = await invoiceAudit.decideInvoice({
        invoiceId: req.params.id,
        user,
      });
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.post('/:id/approve', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const held = await apRelease.defaultService().resolveIfHeld({ invoiceId: req.params.id, action: 'approve', justification: req.body?.reason, user, actorRole: user.activeRole || null });
      if (held) return res.json(held);
      const updated = await invoiceAudit.manualDecide({
        invoiceId: req.params.id, decision: 'Approved',
        reason: req.body?.reason, user,
      });
      res.json(updated);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.post('/:id/reject', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const updated = await invoiceAudit.manualDecide({
        invoiceId: req.params.id, decision: 'Rejected',
        reason: req.body?.reason, user,
      });
      res.json(updated);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // ── Cost lines (REQ-186) ─────────────────────────────────────────
  // GET  /api/invoices/:id/cost-lines           — list lines for an invoice
  // PATCH /api/invoices/:id/cost-lines/:lineId  — edit one line
  //
  // Each line carries (invoice_cost, approved_cost). Edits are recorded
  // in change_history under the parent invoice via recordFieldDiffs.
  router.get('/:id/cost-lines', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const lines = await invoiceCostLines.listForInvoice(req.params.id);
      res.json({ costLines: lines, total: lines.length });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.patch('/:id/cost-lines/:lineId', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const updated = await invoiceCostLines.updateLine({
        invoiceId: req.params.id,
        lineId:    req.params.lineId,
        patch:     req.body || {},
        user,
      });
      res.json(updated);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // QA 226 (2026-05-12): POST a new cost line to an existing invoice.
  // Used by the Freight Invoice modal "Add Cost" button so finance can
  // tack on an accessorial / discount after the invoice is created
  // without rebuilding the whole line set (which would wipe audit
  // history). Body: { cost_type, invoice_cost, approved_cost?, description? }.
  router.post('/:id/cost-lines', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const created = await invoiceCostLines.addLine({
        invoiceId: req.params.id,
        line:      req.body || {},
        user,
      });
      res.status(201).json(created);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // REQ-192: DELETE /api/invoices/:id — remove an invoice. Replaces the
  // legacy generic /api/db/invoices/:id DELETE the UI used to hit; that
  // path bypassed the REQ-02 audit pipeline and left no record of who
  // deleted what. The domain endpoint writes a 'delete' change_history
  // row on the invoice plus a mirroring row on each linked shipment
  // BEFORE removing the row, so the shipment history drawer still
  // shows what happened.
  //
  // Body (optional): { reason: string } — captured into change_history.
  router.delete('/:id', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const out = await invoiceAudit.deleteInvoice({
        invoiceId: req.params.id,
        reason:    req.body?.reason,
        user,
      });
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.post('/:id/send-to-ap', async (req, res) => {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const updated = await invoiceAudit.sendToAp({ invoiceId: req.params.id, user });
      res.json(updated);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  // QA P215 backend (2026-05-11): create-an-invoice-from-a-shipment.
  // Accepts either of two shapes for forward-compat with the manual
  // "🧾 Invoice" button and the AI CREATE_INVOICE action:
  //   POST /api/invoices/from-shipment        body: { shipmentId }
  //   POST /api/invoices/from-shipment/:id    (path-form for REST clients)
  //
  // The service is idempotent: a second call against a shipment that
  // already has an open invoice returns the existing row with
  // `reused: true`, so this route is safe to double-click and safe to
  // retry on transient errors.
  //
  // Returns { invoice, costLines, reused? }. Finance / admin only.
  async function handleCreateFromShipment(req, res) {
    const user = await verifyToken(req, res);
    if (!user) return;
    if (!requireFinance(res, user)) return;
    try {
      const shipmentId =
        String(req.params?.shipmentId || req.body?.shipmentId || '').trim();
      if (!shipmentId) {
        return res.status(400).json({ error: 'shipmentId is required' });
      }
      const result = await invoiceFromShipment.createInvoiceFromShipment({
        shipmentId,
        user,
      });
      res.json(result);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  }
  router.post('/from-shipment', handleCreateFromShipment);
  router.post('/from-shipment/:shipmentId', handleCreateFromShipment);

  return router;
};
