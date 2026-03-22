// ═══════════════════════════════════════════════════════════════════
// Carriers Routes — /api/carriers/*
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const { dbSelect, dbUpsert, dbDelete } = require('../services/supabase');

function dbToCarrier(r) {
  return {
    id:         r.id,
    name:       r.name,
    scac:       r.scac       || '',
    mode:       r.mode       || 'TL',
    status:     r.status     || 'Active',
    otd:        r.on_time_pct || 0,
    claimRatio: r.claim_ratio || 0,
    rating:     r.rating      || 4.0,
    preferred:  r.preferred   || false,
    contact:    r.contact     || null,
    phone:      r.phone       || null,
    email:      r.email       || null,
  };
}

function carrierToDb(c) {
  return {
    id:           c.id || ('C-' + c.name.replace(/\s+/g, '-').toLowerCase()),
    name:         c.name,
    scac:         c.scac         || '',
    mode:         c.mode         || 'TL',
    status:       c.status       || 'Active',
    on_time_pct:  parseFloat(c.otd)        || 0,
    claim_ratio:  parseFloat(c.claimRatio) || 0,
    rating:       parseFloat(c.rating)     || 4.0,
    preferred:    !!c.preferred,
    contact:      c.contact  || null,
    phone:        c.phone    || null,
    email:        c.email    || null,
  };
}

// GET /api/carriers
router.get('/', async (req, res, next) => {
  try {
    // Apply tenant carrier whitelist if configured
    const tenantCarrierList = req.tenant?.carrierList;
    const rows = await dbSelect('carriers', {
      order: { col: 'name', asc: true }, limit: 200,
    }, req.tenant);

    let carriers = rows.map(dbToCarrier);

    // Tenant-specific carrier restriction
    if (tenantCarrierList && tenantCarrierList.length) {
      carriers = carriers.filter(c => tenantCarrierList.includes(c.name) || tenantCarrierList.includes(c.scac));
    }

    res.json({ carriers, total: carriers.length });
  } catch (err) { next(err); }
});

// POST /api/carriers
router.post('/', async (req, res, next) => {
  try {
    const row = await dbUpsert('carriers', carrierToDb(req.body), 'id', req.tenant);
    res.status(201).json(dbToCarrier(row));
  } catch (err) { next(err); }
});

// DELETE /api/carriers/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await dbDelete('carriers', req.params.id, req.tenant);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

module.exports = router;
