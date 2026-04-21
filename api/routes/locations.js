// ═══════════════════════════════════════════════════════════════════
// REQ-29 / REQ-30 — Locations Routes — /api/locations/*
//
//   GET  /api/locations/search?q=<term>&source=oms|tms&limit=20
//        Returns matching location master rows for the combobox on the
//        New Sales Order (OMS) and New Order (TMS) screens. Unified
//        shape — both sources return the same fields.
//
//   POST /api/locations
//        Body: { id, name, type, address, city, state, zip, country,
//                dockDoors, active }
//        Always inserts into OMS-side `oms_locations` (source of truth).
//        DB trigger `trg_sync_oms_location_to_tms` fans the row out to
//        public.locations and enqueues a mw_requests audit row
//        (cmd = 'PUSH_LOCATION_TO_TMS') — REQ-30.
// ═══════════════════════════════════════════════════════════════════

const router = require('express').Router();
const { getClient, dbUpsert } = require('../services/supabase');

function rowToView(r, source) {
  return {
    id:        r.id,
    name:      r.name,
    type:      r.type        || null,
    address:   r.address     || null,
    city:      r.city        || '',
    state:     r.state       || '',
    zip:       r.zip         || '',
    country:   r.country     || null,
    dockDoors: r.dock_doors  ?? null,
    active:
      source === 'oms'
        ? !!r.active
        : String(r.status || '').toLowerCase() === 'active',
    source,
  };
}

// GET /api/locations/search?q=chi&source=oms|tms&limit=20
router.get('/search', async (req, res, next) => {
  try {
    const q      = String(req.query.q || '').trim();
    const limit  = Math.min(Number(req.query.limit ?? 20), 50);
    const source = req.query.source === 'tms' ? 'tms' : 'oms';
    const table  = source === 'tms' ? 'locations' : 'oms_locations';

    // pg_trgm-backed ILIKE on name OR city (indexes added via
    // req29_enable_location_search migration).
    const db = getClient(req.tenant);
    let sel = db
      .from(table)
      .select('id,name,type,address,city,state,zip,country,dock_doors,active,status')
      .limit(limit);

    if (q) {
      const pattern = `%${q}%`;
      sel = sel.or(`name.ilike.${pattern},city.ilike.${pattern}`);
    } else {
      sel = sel.order('updated_at', { ascending: false });
    }

    const { data, error } = await sel;
    if (error) throw new Error(`[DB] ${table} search failed: ${error.message}`);

    res.json({ locations: (data || []).map((r) => rowToView(r, source)) });
  } catch (err) { next(err); }
});

// POST /api/locations
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const required = ['id', 'name', 'city', 'state', 'zip'];
    for (const f of required) {
      if (!body[f] || String(body[f]).trim() === '') {
        return res.status(400).json({ error: `${f} is required` });
      }
    }

    const payload = {
      id:         String(body.id).trim().toUpperCase(),
      name:       String(body.name).trim(),
      type:       body.type       || 'Warehouse',
      address:    body.address    || null,
      city:       String(body.city).trim(),
      state:      String(body.state).trim().toUpperCase(),
      zip:        String(body.zip).trim(),
      country:    (body.country || 'US').toUpperCase(),
      dock_doors: Number.isFinite(Number(body.dockDoors)) ? Number(body.dockDoors) : 4,
      active:     body.active !== false,
    };

    const row = await dbUpsert('oms_locations', payload, 'id', req.tenant);
    res.status(201).json({ location: rowToView(row, 'oms') });
  } catch (err) { next(err); }
});

module.exports = router;
