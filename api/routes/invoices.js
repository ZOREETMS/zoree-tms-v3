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
// QA P215 backend wiring (2026-05-11): public REST entry for the
// existing api/services/invoiceFromShipment service. The service was
// already used internally (e.g. by the shipment-confirm flow) but had
// no addressable route, so the web's "🧾 Invoice" button and the AI
// CREATE_INVOICE action both had to no-op. Exposing it here keeps the
// service as the single writer (the route is just a thin transport).
const invoiceFromShipment = require('../services/invoiceFromShipment');

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
