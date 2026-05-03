// ═══════════════════════════════════════════════════════════════════
// Fusion Master Data Ingest Service — F4 (items, locations, carriers).
//
// One service, three entry points — each driven by the same shape:
//   {
//     instance_id, tenant_id?, mode: 'full'|'delta',
//     items: [...] | locations: [...] | carriers: [...]
//   }
//
// Each entry point validates, upserts the matching TMS table, and writes
// a single integration_event_log row for audit.
//
// Tenancy: per-Supabase-project (see api/services/supabase.js). Items,
// locations, and carriers do NOT have a tenant_id column; the unique
// constraint on fusion_item_id / fusion_location_id / fusion_carrier_id
// is global within a single Supabase project (which equals one tenant).
// ═══════════════════════════════════════════════════════════════════

const db        = require('../supabase');
const eventLog  = require('./eventLog');

const VALID_MODES = new Set(['full', 'delta']);

function ensureBatch(body, listKey) {
  if (!body || typeof body !== 'object') { const e = new Error('payload must be an object'); e.status = 400; throw e; }
  if (body.mode && !VALID_MODES.has(body.mode)) {
    const e = new Error(`mode must be one of ${[...VALID_MODES].join(', ')}`); e.status = 400; throw e;
  }
  if (!Array.isArray(body[listKey])) {
    const e = new Error(`${listKey} must be an array`); e.status = 400; throw e;
  }
  return body[listKey];
}

function validateItem(it, idx) {
  const errs = [];
  if (!it.fusion_item_id) errs.push(`items[${idx}].fusion_item_id is required`);
  if (!it.id)             errs.push(`items[${idx}].id is required`);
  return errs;
}

function validateLocation(loc, idx) {
  const errs = [];
  if (!loc.fusion_location_id) errs.push(`locations[${idx}].fusion_location_id is required`);
  if (!loc.id)                 errs.push(`locations[${idx}].id is required`);
  return errs;
}

function validateCarrier(c, idx) {
  const errs = [];
  if (!c.fusion_carrier_id) errs.push(`carriers[${idx}].fusion_carrier_id is required`);
  if (!c.name)              errs.push(`carriers[${idx}].name is required`);
  return errs;
}

async function ingestItems(body, tenantConfig = null) {
  const items = ensureBatch(body, 'items');
  // Multi-tenancy is per-Supabase-project (see api/services/supabase.js).
  // We do not require or persist a row-level tenant_id.
  const errs = [];
  items.forEach((it, i) => errs.push(...validateItem(it, i)));
  if (errs.length) { const e = new Error(`Validation failed: ${errs.join('; ')}`); e.status = 400; e.details = errs; throw e; }

  const log = await eventLog.start({
    instanceId: body.instance_id,
    objectType: 'item',
    tenantId:   body.tenant_id || null,
    payload:    body,
  });
  if (log.alreadyProcessed) return { upserted: 0, skipped: items.length, reason: 'already_processed' };

  let upserted = 0;
  for (const it of items) {
    const row = {
      id:                     it.id,
      description:            it.description || null,
      uom:                    it.uom || null,
      unit_weight:            Number.isFinite(Number(it.unit_weight)) ? Number(it.unit_weight) : null,
      hazmat:                 !!it.hazmat,
      fusion_item_id:         it.fusion_item_id,
      fusion_organization_id: it.fusion_organization_id || null,
    };
    try {
      await db.dbUpsert('items', row, 'id', tenantConfig);
      upserted += 1;
    } catch (err) {
      console.error('[fusionIngest.masterData.items] upsert failed for', row.id, err.message);
    }
  }

  await eventLog.markProcessed(log.id, null);
  return { upserted, count: items.length };
}

async function ingestLocations(body, tenantConfig = null) {
  const locations = ensureBatch(body, 'locations');
  const errs = [];
  locations.forEach((l, i) => errs.push(...validateLocation(l, i)));
  if (errs.length) { const e = new Error(`Validation failed: ${errs.join('; ')}`); e.status = 400; e.details = errs; throw e; }

  const log = await eventLog.start({
    instanceId: body.instance_id,
    objectType: 'location',
    tenantId:   body.tenant_id || null,
    payload:    body,
  });
  if (log.alreadyProcessed) return { upserted: 0, skipped: locations.length, reason: 'already_processed' };

  let upserted = 0;
  for (const loc of locations) {
    const row = {
      id:                       loc.id,
      name:                     loc.name || null,
      city:                     loc.city || null,
      state:                    loc.state || null,
      zip:                      loc.zip || null,
      country:                  loc.country || null,
      type:                     loc.type || 'warehouse',
      fusion_location_id:       loc.fusion_location_id,
      fusion_organization_code: loc.fusion_organization_code || null,
    };
    try {
      await db.dbUpsert('locations', row, 'id', tenantConfig);
      upserted += 1;
    } catch (err) {
      console.error('[fusionIngest.masterData.locations] upsert failed for', row.id, err.message);
    }
  }
  await eventLog.markProcessed(log.id, null);
  return { upserted, count: locations.length };
}

async function ingestCarriers(body, tenantConfig = null) {
  const carriers = ensureBatch(body, 'carriers');
  const errs = [];
  carriers.forEach((c, i) => errs.push(...validateCarrier(c, i)));
  if (errs.length) { const e = new Error(`Validation failed: ${errs.join('; ')}`); e.status = 400; e.details = errs; throw e; }

  const log = await eventLog.start({
    instanceId: body.instance_id,
    objectType: 'carrier',
    tenantId:   null,
    payload:    body,
  });
  if (log.alreadyProcessed) return { upserted: 0, skipped: carriers.length, reason: 'already_processed' };

  let upserted = 0;
  for (const c of carriers) {
    // Use the carrier name (or a slugged form) as TMS id when one isn't given —
    // matches existing carriers table convention.
    const carrierId = c.id || c.scac || c.name.replace(/\s+/g, '-').toUpperCase();
    const row = {
      id:                carrierId,
      name:              c.name,
      scac:              c.scac || null,
      dot_number:        c.dot_number || null,
      active:            c.active !== false,
      fusion_carrier_id: c.fusion_carrier_id,
    };
    try {
      await db.dbUpsert('carriers', row, 'id', tenantConfig);
      upserted += 1;
    } catch (err) {
      console.error('[fusionIngest.masterData.carriers] upsert failed for', row.id, err.message);
    }
  }
  await eventLog.markProcessed(log.id, null);
  return { upserted, count: carriers.length };
}

module.exports = { ingestItems, ingestLocations, ingestCarriers };
