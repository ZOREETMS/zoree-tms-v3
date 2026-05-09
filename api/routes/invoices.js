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
        invoicedAmount, invoiceDate, paymentTerms, notes, metadata,
      } = req.body || {};
      // REQ-07: forward shipmentIds[] so consolidated invoices reach the
      // service layer. Was previously dropped at this destructure (DEFECT-001).
      const out = await invoiceAudit.submitInvoice({
        invoiceNumber, carrier, carrierId, shipmentId, shipmentIds,
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

  return router;
};
