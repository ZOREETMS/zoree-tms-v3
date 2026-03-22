// ═══════════════════════════════════════════════════════════════════
// Tenant Service — Multi-Client Configuration (Tier 2)
// This is the core of multi-tenancy. Each client (AT&T, Cisco, etc.)
// gets their own config: branding, features, Supabase project, etc.
// ═══════════════════════════════════════════════════════════════════

const db = require('./supabase');

// ── Default feature set by pricing tier ──────────────────────────
const TIER_FEATURES = {
  starter: [
    'orders', 'shipments', 'carriers', 'documents', 'basic_reports'
  ],
  pro: [
    'orders', 'shipments', 'carriers', 'documents', 'basic_reports',
    'rate_management', 'dock_scheduling', 'carrier_portal',
    'freight_audit', 'analytics', 'alerts'
  ],
  enterprise: [
    '*'   // all features
  ],
};

// ── In-memory tenant cache (replace with Redis in production) ─────
const _tenantCache = {};

// ── Default tenant config for development ─────────────────────────
const DEFAULT_TENANT = {
  id:           'zoree-default',
  name:         'ZoreeTMS',
  brandName:    'ZoreeTMS',
  logoUrl:      null,
  primaryColor: '#3b82f6',
  tier:         'enterprise',
  supabaseUrl:  process.env.SUPABASE_URL,
  supabaseKey:  process.env.SUPABASE_ANON_KEY,
  features:     TIER_FEATURES.enterprise,
  customFields: {},
  carrierList:  null,     // null = all carriers allowed
  createdAt:    new Date().toISOString(),
};

async function getTenant(tenantId) {
  if (!tenantId || tenantId === 'zoree-default') return DEFAULT_TENANT;

  // Check cache
  if (_tenantCache[tenantId]) return _tenantCache[tenantId];

  // Load from DB (tenant_config table)
  try {
    const rows = await db.dbSelect('tenant_config', {
      filters: [['id', 'eq', tenantId]],
      limit: 1,
    });

    if (!rows.length) {
      console.warn(`[Tenant] Unknown tenantId: ${tenantId} — using default`);
      return DEFAULT_TENANT;
    }

    const row = rows[0];
    const tenant = {
      id:           row.id,
      name:         row.name,
      brandName:    row.brand_name    || row.name,
      logoUrl:      row.logo_url      || null,
      primaryColor: row.primary_color || '#3b82f6',
      tier:         row.tier          || 'starter',
      supabaseUrl:  row.supabase_url  || process.env.SUPABASE_URL,
      supabaseKey:  row.supabase_key  || process.env.SUPABASE_ANON_KEY,
      features:     row.features_json
                      ? JSON.parse(row.features_json)
                      : TIER_FEATURES[row.tier || 'starter'],
      customFields: row.custom_fields_json
                      ? JSON.parse(row.custom_fields_json)
                      : {},
      carrierList:  row.carrier_list_json
                      ? JSON.parse(row.carrier_list_json)
                      : null,
    };

    // Cache for 5 minutes
    _tenantCache[tenantId] = tenant;
    setTimeout(() => delete _tenantCache[tenantId], 5 * 60 * 1000);

    return tenant;

  } catch (e) {
    console.warn(`[Tenant] Could not load tenant ${tenantId}: ${e.message}`);
    return DEFAULT_TENANT;
  }
}

function hasFeature(tenant, feature) {
  if (!tenant) return false;
  if (tenant.features?.includes('*')) return true;
  return tenant.features?.includes(feature) || false;
}

function getTierFeatures(tier) {
  return TIER_FEATURES[tier] || TIER_FEATURES.starter;
}

module.exports = { getTenant, hasFeature, getTierFeatures, TIER_FEATURES };
