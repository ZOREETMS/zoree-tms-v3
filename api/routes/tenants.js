// ═══════════════════════════════════════════════════════════════════
// Tenants Routes — /api/tenants/*
// Admin only — manage multi-client configurations
// ═══════════════════════════════════════════════════════════════════

const router  = require('express').Router();
const { getTenant, getTierFeatures, TIER_FEATURES } = require('../services/tenants');
const { dbUpsert, dbSelect } = require('../services/supabase');
const { requireRole } = require('../middleware/auth');

// GET /api/tenants/me — current tenant config
router.get('/me', (req, res) => {
  const t = req.tenant;
  res.json({
    id:           t.id,
    brandName:    t.brandName,
    logoUrl:      t.logoUrl,
    primaryColor: t.primaryColor,
    tier:         t.tier,
    features:     t.features,
    customFields: t.customFields,
  });
});

// GET /api/tenants — list all tenants (super-admin only)
router.get('/', requireRole('super-admin'), async (req, res, next) => {
  try {
    const rows = await dbSelect('tenant_config', {
      order: { col: 'created_at', asc: false }, limit: 200,
    });
    res.json({ tenants: rows, total: rows.length });
  } catch (err) { next(err); }
});

// POST /api/tenants — create new tenant / onboard new client
router.post('/', requireRole('super-admin'), async (req, res, next) => {
  try {
    const {
      id, name, brandName, logoUrl, primaryColor = '#3b82f6',
      tier = 'starter', supabaseUrl, supabaseKey,
      features, customFields, carrierList,
    } = req.body;

    if (!id || !name) return res.status(400).json({ error: 'id and name required' });

    const row = {
      id,
      name,
      brand_name:           brandName    || name,
      logo_url:             logoUrl      || null,
      primary_color:        primaryColor,
      tier,
      supabase_url:         supabaseUrl  || process.env.SUPABASE_URL,
      supabase_key:         supabaseKey  || process.env.SUPABASE_ANON_KEY,
      features_json:        JSON.stringify(features || getTierFeatures(tier)),
      custom_fields_json:   customFields ? JSON.stringify(customFields) : null,
      carrier_list_json:    carrierList  ? JSON.stringify(carrierList)  : null,
    };

    await dbUpsert('tenant_config', row, 'id');
    res.status(201).json({ success: true, tenantId: id, tier, features: features || getTierFeatures(tier) });
  } catch (err) { next(err); }
});

// GET /api/tenants/tiers — available tiers and features
router.get('/tiers', (req, res) => {
  res.json({
    tiers: Object.entries(TIER_FEATURES).map(([tier, features]) => ({
      tier,
      features,
      description: {
        starter:    'Core TMS: orders, shipments, carriers, documents',
        pro:        'Full TMS: + rate management, dock scheduling, analytics',
        enterprise: 'Everything: all features, custom integrations, dedicated support',
      }[tier],
      price: {
        starter:    '$499/mo',
        pro:        '$1,499/mo',
        enterprise: 'Custom',
      }[tier],
    })),
  });
});

module.exports = router;
