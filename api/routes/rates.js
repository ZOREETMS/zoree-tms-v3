// ═══════════════════════════════════════════════════════════════════
// Rates Routes — /api/rates/*
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const { dbSelect, dbUpsert, dbDelete } = require('../services/supabase');
const { requireFeature } = require('../middleware/auth');

function dbToRate(r) {
  return {
    id:          r.id,
    lane:        r.lane,
    origin:      r.origin,
    destination: r.dest,
    carrier:     r.carrier,
    mode:        r.mode        || 'TL',
    ratePerMile: parseFloat(r.rate_per_mile) || 0,
    fscPct:      parseFloat(r.fsc_pct)       || 0,
    transitDays: r.transit_days || null,
    effectiveDate: r.effective_date || null,
    expiryDate:    r.expiry_date    || null,
    czarMinWt:   r.czar_min_wt  || null,
    czarMaxWt:   r.czar_max_wt  || null,
  };
}

function rateToDb(r) {
  return {
    id:             r.id || `${r.lane}-${r.carrier}`.replace(/\s+/g, '-').toLowerCase(),
    lane:           r.lane,
    origin:         r.origin,
    dest:           r.destination,
    carrier:        r.carrier,
    mode:           r.mode           || 'TL',
    rate_per_mile:  parseFloat(r.ratePerMile) || 0,
    fsc_pct:        parseFloat(r.fscPct)      || 0,
    transit_days:   r.transitDays    || null,
    effective_date: r.effectiveDate  || null,
    expiry_date:    r.expiryDate     || null,
    czar_min_wt:    r.czarMinWt      || null,
    czar_max_wt:    r.czarMaxWt      || null,
  };
}

// GET /api/rates — rate_management feature required
router.get('/', requireFeature('rate_management'), async (req, res, next) => {
  try {
    const filters = [];
    if (req.query.origin) filters.push(['origin', 'ilike', `%${req.query.origin}%`]);
    if (req.query.dest)   filters.push(['dest',   'ilike', `%${req.query.dest}%`]);

    const rows = await dbSelect('rates', {
      filters, order: { col: 'lane', asc: true }, limit: 500,
    }, req.tenant);

    res.json({ rates: rows.map(dbToRate), total: rows.length });
  } catch (err) { next(err); }
});

// POST /api/rates
router.post('/', requireFeature('rate_management'), async (req, res, next) => {
  try {
    const row = await dbUpsert('rates', rateToDb(req.body), 'id', req.tenant);
    res.status(201).json(dbToRate(row));
  } catch (err) { next(err); }
});

// DELETE /api/rates/:id
router.delete('/:id', requireFeature('rate_management'), async (req, res, next) => {
  try {
    await dbDelete('rates', req.params.id, req.tenant);
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// GET /api/rates/quote — estimate cost for a lane+weight
router.get('/quote', async (req, res, next) => {
  try {
    const { origin, dest, weight, carrier } = req.query;
    if (!origin || !dest || !weight) {
      return res.status(400).json({ error: 'origin, dest, weight required' });
    }

    const filters = [
      ['origin', 'ilike', `%${origin}%`],
      ['dest',   'ilike', `%${dest}%`],
    ];
    if (carrier) filters.push(['carrier', 'ilike', `%${carrier}%`]);

    const rows = await dbSelect('rates', { filters, limit: 10 }, req.tenant);
    const quotes = rows.map(r => {
      const rate    = dbToRate(r);
      const miles   = 750; // TODO: integrate distance API
      const baseCost= parseFloat(weight) * rate.ratePerMile / 100;
      const fsc     = baseCost * (rate.fscPct / 100);
      return {
        carrier:     rate.carrier,
        mode:        rate.mode,
        ratePerMile: rate.ratePerMile,
        fscPct:      rate.fscPct,
        estimatedCost: Math.round((baseCost + fsc) * 100) / 100,
        transitDays: rate.transitDays,
      };
    }).sort((a, b) => a.estimatedCost - b.estimatedCost);

    res.json({ quotes, count: quotes.length });
  } catch (err) { next(err); }
});

module.exports = router;
