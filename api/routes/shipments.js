// ═══════════════════════════════════════════════════════════════════
// Shipments Routes — /api/shipments/*
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const shipService = require('../services/shipments');
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
    const shipment = await shipService.updateShipment(req.params.id, req.body, req.tenant);
    res.json(shipment);
  } catch (err) { next(err); }
});

// PATCH /api/shipments/:id/status — quick status update
router.patch('/:id/status', requireRole('admin', 'planner', 'dispatcher'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const VALID = ['Planned','Tendered','Confirmed','In Transit','Delivered','Cancelled','Exception'];
    if (!VALID.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` });
    }
    const shipment = await shipService.updateShipment(req.params.id, { status }, req.tenant);
    res.json(shipment);
  } catch (err) { next(err); }
});

module.exports = router;
