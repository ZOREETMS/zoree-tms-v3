// ═══════════════════════════════════════════════════════════════════
// Orders Routes — /api/orders/*
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const orderService = require('../services/orders');
const { requireRole } = require('../middleware/auth');

// GET /api/orders
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      status:   req.query.status   || null,
      customer: req.query.customer || null,
      statuses: req.query.statuses ? req.query.statuses.split(',') : null,
      limit:    parseInt(req.query.limit) || 500,
    };
    const result = await orderService.listOrders(filters, req.tenant);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/orders/:id
router.get('/:id', async (req, res, next) => {
  try {
    const order = await orderService.getOrder(req.params.id, req.tenant);
    res.json(order);
  } catch (err) { next(err); }
});

// POST /api/orders
router.post('/', requireRole('admin', 'planner'), async (req, res, next) => {
  try {
    const order = await orderService.createOrder(req.body, req.tenant);
    res.status(201).json(order);
  } catch (err) { next(err); }
});

// PATCH /api/orders/:id
router.patch('/:id', requireRole('admin', 'planner'), async (req, res, next) => {
  try {
    const order = await orderService.updateOrder(req.params.id, req.body, req.tenant);
    res.json(order);
  } catch (err) { next(err); }
});

// DELETE /api/orders/:id
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await orderService.deleteOrder(req.params.id, req.tenant);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/orders/lanes/groups — consolidation groups
router.get('/lanes/groups', async (req, res, next) => {
  try {
    const { orders } = await orderService.listOrders({ statuses: ['Unplanned'] }, req.tenant);
    const groups = orderService.groupByLane(orders);
    res.json({ groups, total: groups.length });
  } catch (err) { next(err); }
});

module.exports = router;
