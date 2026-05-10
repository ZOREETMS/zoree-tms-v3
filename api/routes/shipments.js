// ═══════════════════════════════════════════════════════════════════
// Shipments Routes — /api/shipments/*
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const shipService = require('../services/shipments');
const invoiceFromShipment = require('../services/invoiceFromShipment');
const { requireRole, requireFeature } = require('../middleware/auth');

// GET /api/shipments
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      status:  req.query.status  || null,
      carrier: req.query.carrier || null,
      limit:   parseInt(req.query.limit) || 500,
    };
    const result = await shipService.listShipments(filters, req.tenant);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/shipments/:id
router.get('/:id', async (req, res, next) => {
  try {
    const shipment = await shipService.getShipment(req.params.id, req.tenant);
    res.json(shipment);
  } catch (err) { next(err); }
});

// POST /api/shipments
router.post('/', requireRole('admin', 'planner'), async (req, res, next) => {
  try {
    const shipment = await shipService.createShipment(req.body, req.tenant);
    res.status(201).json(shipment);
  } catch (err) { next(err); }
});

// PATCH /api/shipments/:id
router.patch('/:id', requireRole('admin', 'planner', 'dispatcher'), async (req, res, next) => {
  try {
    const shipment = await shipService.updateShipment(
      req.params.id,
      req.body,
      req.tenant,
      { user: req.user || null, via: 'shipment-patch' },
    );
    res.json(shipment);
  } catch (err) { next(err); }
});

// PATCH /api/shipments/:id/status — quick status update
router.patch('/:id/status', requireRole('admin', 'planner', 'dispatcher'), async (req, res, next) => {
  try {
    const { status } = req.body;
    // Keep this list in lock-step with the DB constraint
    // chk_shipments_status_controlled (see
    // api/migrations/036_shipments_status_add_tender_accepted.sql).
    // 'Tender Accepted' (QA #61) added 2026-05-05.
    const VALID = [
      'Planned',
      'Tendered',
      'Tender Accepted',
      'Tender Rejected',
      'Confirmed',
      'In Transit',
      'Delivered',
      'Cancelled',
      'Exception',
    ];
    if (!VALID.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` });
    }
    const shipment = await shipService.updateShipment(
      req.params.id,
      { status },
      req.tenant,
      { user: req.user || null, via: 'shipment-status-patch' },
    );
    res.json(shipment);
  } catch (err) { next(err); }
});

// POST /api/shipments/:id/invoice — REQ-184/185/187.
//
// Auto-creates an invoice from this shipment (status='On Hold') in a
// single round-trip so the planner doesn't fill in another form. Costs
// (rate, fuel surcharge, accessorials) are copied off the shipment into
// invoice_cost_lines with approved_cost defaulted to invoice_cost.
//
// Idempotent: if the shipment already has an open invoice, that one is
// returned with `reused: true`.
//
// Finance | admin | planner — planners trigger this from the shipments
// table action button; finance owns the resulting approval workflow.
router.post('/:id/invoice', requireRole('admin', 'planner', 'finance'), async (req, res, next) => {
  try {
    const result = await invoiceFromShipment.createInvoiceFromShipment({
      shipmentId: req.params.id,
      user:       req.user || null,
    });
    res.status(result.reused ? 200 : 201).json(result);
  } catch (err) { next(err); }
});

module.exports = router;
