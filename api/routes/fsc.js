// ═══════════════════════════════════════════════════════════════════
// Fuel Surcharge Routes — /api/fsc/*
// ─────────────────────────────────────────────────────────────────────
// EIA-indexed fuel surcharge (migration 045):
//   GET    /api/fsc/eia/current            — latest cached EIA diesel price
//                                            (?refresh=1 forces a re-fetch)
//   POST   /api/fsc/eia/manual             — { price, priceDate? } manual entry
//   GET    /api/fsc/schedule/:carrierId    — carrier's FSC brackets
//   PUT    /api/fsc/schedule/:carrierId    — replace brackets (upload)
//   DELETE /api/fsc/schedule/:carrierId    — remove schedule
//   GET    /api/fsc/preview/:carrierId     — ?linehaul=500 → computed FSC
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const eiaFuel = require('../services/eiaFuelService');
const fscSchedule = require('../services/fscSchedule');

function priceView(row) {
  if (!row) return null;
  return {
    price: parseFloat(row.price_usd_per_gallon),
    priceDate: row.price_date,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

// GET /api/fsc/eia/current?refresh=1
router.get('/eia/current', async (req, res, next) => {
  try {
    const row = await eiaFuel.getCurrentDieselPrice({ forceRefresh: req.query.refresh === '1' });
    res.json({ eia: priceView(row) });
  } catch (err) { next(err); }
});

// POST /api/fsc/eia/manual { price, priceDate? }
router.post('/eia/manual', async (req, res, next) => {
  try {
    const row = await eiaFuel.setManualPrice(req.body || {});
    res.status(201).json({ eia: priceView(row) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/fsc/schedule/:carrierId
router.get('/schedule/:carrierId', async (req, res, next) => {
  try {
    const brackets = await fscSchedule.getSchedule(req.params.carrierId);
    res.json({ carrierId: req.params.carrierId, count: brackets.length, brackets });
  } catch (err) { next(err); }
});

// PUT /api/fsc/schedule/:carrierId { brackets: [{ min_price, fsc_pct }] }
router.put('/schedule/:carrierId', async (req, res, next) => {
  try {
    const brackets = await fscSchedule.replaceSchedule(req.params.carrierId, req.body?.brackets);
    res.json({ carrierId: req.params.carrierId, count: brackets.length, brackets });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// DELETE /api/fsc/schedule/:carrierId
router.delete('/schedule/:carrierId', async (req, res, next) => {
  try {
    res.json(await fscSchedule.deleteSchedule(req.params.carrierId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/fsc/preview/:carrierId?linehaul=500
// Convenience for the Fuel Surcharge page calculator: current price +
// bracket lookup + dollar amount in one call.
router.get('/preview/:carrierId', async (req, res, next) => {
  try {
    const linehaul = parseFloat(req.query.linehaul) || 0;
    const [priceRow, brackets] = await Promise.all([
      eiaFuel.getCurrentDieselPrice(),
      fscSchedule.getSchedule(req.params.carrierId),
    ]);
    const price = priceRow ? parseFloat(priceRow.price_usd_per_gallon) : null;
    const fscPct = price != null ? fscSchedule.lookupFscPct(brackets, price) : null;
    res.json({
      carrierId: req.params.carrierId,
      eia: priceView(priceRow),
      bracketCount: brackets.length,
      fscPct,
      linehaul,
      fscAmount: fscPct != null ? Math.round(linehaul * fscPct) / 100 : null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
