// frontend/services/omsSync/pushOrderService.js
// ---------------------------------------------------------------------------
// OMS → TMS: push new Stage-3/4 orders with full line items.
// Replaces the inline runPushOrderFlow() that previously lived in
// zoree-middleware.html. Only selects rows where tms_order_pushed_at IS NULL
// (migration 023 — supersedes mistargeted 010) so the auto-sync cycle
// does not re-push the same orders.
// ---------------------------------------------------------------------------

(function (global) {
  'use strict';

  var ns = (global.ZoreeMW = global.ZoreeMW || {});
  ns.services = ns.services || {};
  ns.services.omsSync = ns.services.omsSync || {};

  var tracking = ns.services.omsSync.tracking;
  if (!tracking) {
    throw new Error(
      'pushOrderService.js must be loaded AFTER omsSyncTracking.js'
    );
  }

  // ── Pure helpers (no IO) ───────────────────────────────────────────────

  function buildCustomerMap(custs) {
    var m = {};
    (custs || []).forEach(function (c) { m[c.id] = c.name; });
    return m;
  }

  function buildLocationMap(locs) {
    var m = {};
    (locs || []).forEach(function (l) {
      m[l.id] = {
        id:      l.id,
        name:    l.name,
        display: (l.city && l.state)
          ? l.city + ', ' + l.state + (l.zip ? ' ' + l.zip : '')
          : (l.name || l.id),
        address: l.address || null,
        zip:     l.zip     || null,
      };
    });
    return m;
  }

  // Resolve a free-text destination string to a known location.
  // Priority: exact id → exact name → city+state contains.
  function resolveDestinationLocation(destination, locMap) {
    var destStr = (destination || '').toLowerCase().trim();
    if (!destStr) return null;

    var values = Object.values(locMap);

    var byId = values.find(function (l) { return destStr === l.id.toLowerCase(); });
    if (byId) return byId;

    var byName = values.find(function (l) { return destStr === (l.name || '').toLowerCase(); });
    if (byName) return byName;

    return values.find(function (l) {
      var city  = (l.city  || '').toLowerCase();
      var state = (l.state || '').toLowerCase();
      return city && state && destStr.includes(city) && destStr.includes(state);
    }) || null;
  }

  function totalsFromLines(lines) {
    var arr = lines || [];
    var wt  = arr.reduce(function (s, l) {
      return s + ((l.qty_ordered || 0) * (parseFloat(l.unit_weight) || 0));
    }, 0);
    var pcs = Math.round(arr.reduce(function (s, l) {
      return s + (l.qty_ordered || 0);
    }, 0));
    return { wt: wt, pcs: pcs };
  }

  // REQ-24: compose a "CITY, ST ZIP" string from the typed parts.
  // Mirrors the helper in types/location.js so both sides of the OMS →
  // TMS boundary produce identical canonical strings.
  function composeAddress(city, state, zip) {
    var head = [String(city || '').toUpperCase(), String(state || '').toUpperCase()]
      .filter(Boolean)
      .join(', ');
    return zip ? (head + ' ' + zip).trim() : head;
  }

  // Bug #66: oms_orders carries the service-level under the legacy
  // `priority` column (the form label is "Service Level" but the DB
  // column was never renamed). The middleware sync was reading every
  // other field from `o` but silently skipping this one — so a TMS
  // order synced from an OMS row marked "Expedited" (or the legacy
  // "Expedite") landed with service_level = NULL.
  //
  // Mirror the canonical alias map used by the in-app OMS push
  // (zoree-oms.html → normalizeOmsServiceLevel) so the two surfaces
  // can never disagree. Inline because pushOrderService.js is loaded
  // as a vanilla IIFE script — no ESM imports available.
  var SVC_LEVEL_ALIASES = {
    STANDARD: 'Standard', STD: 'Standard',
    EXPEDITE: 'Expedited', EXPEDITED: 'Expedited', EXPRESS: 'Expedited', EXP: 'Expedited',
    CRITICAL: 'Time-Critical',
    'TIME-CRITICAL': 'Time-Critical',
    'TIME CRITICAL': 'Time-Critical',
    ECONOMY: 'Economy', ECON: 'Economy',
    GUARANTEED: 'Guaranteed', GTD: 'Guaranteed',
    'WHITE GLOVE': 'White Glove',
    'WHITE-GLOVE': 'White Glove',
    WG: 'White Glove',
  };
  function normalizeOmsServiceLevel(v) {
    if (v === null || v === undefined) return null;
    var raw = String(v).trim();
    if (!raw) return null;
    var key = raw.replace(/\s+/g, ' ').toUpperCase();
    if (SVC_LEVEL_ALIASES[key]) return SVC_LEVEL_ALIASES[key];
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }

  function mapOmsOrderToTmsRow(o, custMap, locMap) {
    var lines = o.oms_order_lines || [];
    var totals = totalsFromLines(lines);

    // REQ-24: ship-from / ship-to now come from the dedicated typed
    // columns on oms_orders (migration 019). Falls back to the legacy
    // locs-table lookup for orders created before the migration so the
    // sync doesn't silently drop data on historical rows.
    var legacyOriginLoc = locMap[o.origin_location] || null;
    var shipFromName  = o.ship_from_name  || (legacyOriginLoc ? legacyOriginLoc.name  : null);
    var shipFromCity  = o.ship_from_city  || (legacyOriginLoc ? legacyOriginLoc.city  : '');
    var shipFromState = o.ship_from_state || (legacyOriginLoc ? legacyOriginLoc.state : '');
    var shipFromZip   = o.origin_zip      || (legacyOriginLoc ? legacyOriginLoc.zip   : null);
    var originDisplay = (shipFromCity || shipFromState || shipFromZip)
      ? composeAddress(shipFromCity, shipFromState, shipFromZip)
      : (legacyOriginLoc ? legacyOriginLoc.display : (o.origin_location || ''));

    // For ship-to, prefer the new typed fields. Fall back to resolving
    // against the locations table only when the legacy `destination`
    // string is all we have (pre-migration rows).
    var legacyDestLoc = resolveDestinationLocation(o.destination, locMap);
    var shipToName  = o.ship_to_name  || (legacyDestLoc ? legacyDestLoc.name  : null);
    var shipToCity  = o.ship_to_city  || (legacyDestLoc ? legacyDestLoc.city  : '');
    var shipToState = o.ship_to_state || (legacyDestLoc ? legacyDestLoc.state : '');
    var shipToZip   = o.dest_zip || (o.destination || '').match(/\b(\d{5})\b/)?.[1] || null;
    var destAddress = (shipToCity || shipToState || shipToZip)
      ? composeAddress(shipToCity, shipToState, shipToZip)
      : (o.destination || '');

    return {
      id:                 o.id,
      customer:           custMap[o.customer_id] || o.customer_id,
      origin:             originDisplay,
      dest:               destAddress,
      origin_location_id: o.origin_location || null,
      dest_location_id:   legacyDestLoc ? legacyDestLoc.id : null,
      ship_from_name:     shipFromName,
      ship_to_name:       shipToName,
      ship_to_address:    destAddress || o.destination || null,
      weight:             totals.wt,
      pieces:             totals.pcs,
      commodity:          o.commodity        || 'General',
      ready:              o.ready_date       || null,
      due:                o.required_date    || null,
      status:             'Unplanned',
      notes:              o.special_instructions || null,
      incoterms:          o.incoterms        || null,
      ship_mode:          o.ship_mode        || null,
      po_number:          o.po_number        || null,
      hazmat:             false,
      line_count:         lines.length,
      origin_zip:         shipFromZip || null,
      dest_zip:           shipToZip   || null,
      // Bug #66 / Bug #33: the OMS column was renamed priority → service_level
      // (migration 20260505_oms_orders_rename_priority_to_service_level) so
      // the field name matches the TMS side end-to-end. The legacy
      // `priority` fallback is kept defensively for any pre-migration row
      // still in flight; normalizeOmsServiceLevel handles either input.
      service_level:      normalizeOmsServiceLevel(o.service_level || o.priority),
      // Sync provenance (migration 005) — flags the row as OMS-origin so the
      // TMS UI can render the "OMS-synced" badge and filter on it.
      sync_source:        'oms',
      auto_synced_at:     new Date().toISOString(),
      oms_order_ref:      o.id,
      _meta: { originDisplay: originDisplay, originLoc: legacyOriginLoc, totals: totals },
    };
  }

  // Canonical order_lines.id format — MUST stay in sync with
  // api/services/orderLineIds.js (buildOrderLineId). Different format here
  // means upsert(onConflict:'id') creates duplicate rows instead of updating,
  // which is the defect fixed in the 20260421 dedupe migration.
  function buildOrderLineId(orderId, lineNum) {
    var n = Number(lineNum) || 1;
    return orderId + '-L' + String(n).padStart(3, '0');
  }

  function mapOmsLineToTmsLine(orderId, l, idx) {
    var qty = l.qty_ordered || 0;
    var uw  = parseFloat(l.unit_weight) || 0;
    var lineNum = l.line_num || (idx + 1);
    return {
      id:           buildOrderLineId(orderId, lineNum),
      order_id:     orderId,
      line_num:     lineNum,
      item_id:      l.item_id   || null,
      description:  l.description || null,
      qty_ordered:  qty,
      unit_weight:  uw,
      total_weight: Math.round(qty * uw * 1000) / 1000,
      unit_value:   parseFloat(l.unit_value)  || 0,
      total_value:  parseFloat(l.total_value) || 0,
    };
  }

  // ── IO: Supabase reads/writes ──────────────────────────────────────────

  async function fetchPendingOrders(omsDb) {
    return omsDb().from('oms_orders')
      .select('*, oms_order_lines(*)')
      .in('stage', [3, 4])
      .is('tms_order_pushed_at', null)
      .limit(50);
  }

  async function fetchLookupMaps(omsDb) {
    var custsRes = await omsDb().from('oms_customers').select('id,name');
    var locsRes  = await omsDb().from('oms_locations').select('id,name,city,state,address,zip');
    return {
      custMap: buildCustomerMap(custsRes.data),
      locMap:  buildLocationMap(locsRes.data),
    };
  }

  async function upsertOrderHeader(tmsDb, tmsRow) {
    var clean = Object.assign({}, tmsRow); delete clean._meta;
    return tmsDb().from('orders').upsert(clean, { onConflict: 'id' });
  }

  async function upsertOrderLines(tmsDb, orderId, lines) {
    var errors = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var tmsLine = mapOmsLineToTmsLine(orderId, l, i);
      var res = await tmsDb().from('order_lines').upsert(tmsLine, { onConflict: 'id' });
      if (res.error) errors.push('L' + (l.line_num || i + 1) + ': ' + res.error.message);
    }
    return errors;
  }

  // ── Orchestration ──────────────────────────────────────────────────────

  async function runPushOrder(deps) {
    var omsDb        = deps.omsDb;
    var tmsDb        = deps.tmsDb;
    var logEvent     = deps.logEvent;
    var payloadBytes = deps.payloadBytes;
    var notifyTMS    = deps.notifyTMS;

    var res = await fetchPendingOrders(omsDb);
    if (res.error) throw res.error;

    var data = res.data || [];
    if (!data.length) {
      logEvent('info', 'push-order', 'No stage 3/4 orders pending TMS push');
      return '0 orders';
    }

    var maps = await fetchLookupMaps(omsDb);

    logEvent('info', '← OMS', 'Read ' + data.length + ' stage 3/4 order(s) from OMS for TMS push', {
      srcSystem: 'OMS', dstSystem: 'TMS',
      rowCount: data.length,
      bytes:    payloadBytes(data),
      fields:   ['id','customer_id','origin_location','destination','ship_mode','incoterms','oms_order_lines'],
      payload:  data.map(function (o) {
        return {
          id: o.id,
          customer_id: o.customer_id,
          origin_location: o.origin_location,
          destination: o.destination,
          ship_mode: o.ship_mode,
          line_count: (o.oms_order_lines || []).length,
        };
      }),
    });

    var pushed = 0;
    for (var i = 0; i < data.length; i++) {
      var o = data[i];
      var lines = o.oms_order_lines || [];
      var tmsRow = mapOmsOrderToTmsRow(o, maps.custMap, maps.locMap);
      var meta = tmsRow._meta;

      var headerRes = await upsertOrderHeader(tmsDb, tmsRow);
      if (headerRes.error) {
        logEvent('err', '→ TMS', 'PUSH FAILED order ' + o.id + ': ' + headerRes.error.message, {
          srcSystem: 'OMS', dstSystem: 'TMS', recordId: o.id,
          payload: { attemptedRow: tmsRow, error: headerRes.error.message },
        });
        continue;
      }

      await tracking.stampOrderPushed(omsDb, o.id);

      var lineErrors = await upsertOrderLines(tmsDb, o.id, lines);

      pushed++;
      var lineStatus = lineErrors.length
        ? ' ⚠️ ' + lineErrors.length + ' line error(s)'
        : ' | ' + lines.length + ' lines pushed';

      logEvent('ok', '→ TMS',
        'PUSH order ' + o.id + ' → TMS | "' + tmsRow.customer + '" | ' +
        meta.originDisplay + ' → ' + o.destination + ' | ' +
        meta.totals.wt.toLocaleString() + ' lbs / ' + meta.totals.pcs + ' pcs' + lineStatus,
        {
          srcSystem: 'OMS', dstSystem: 'TMS',
          recordId:  o.id,
          rowCount:  1 + lines.length,
          bytes:     payloadBytes(tmsRow) + payloadBytes(lines),
          fields:    Object.keys(tmsRow).concat(['order_lines']),
          payload: {
            _meta: {
              flow:       'push-order',
              omsStage:   o.stage,
              pushedAt:   new Date().toISOString(),
              lineErrors: lineErrors,
            },
            _orderHeader: tmsRow,
            _lines: lines.map(function (l) {
              return {
                id:           buildOrderLineId(o.id, l.line_num || 1),
                line_num:     l.line_num,
                item_id:      l.item_id,
                description:  l.description,
                qty_ordered:  l.qty_ordered,
                unit_weight:  l.unit_weight,
                total_weight: (l.qty_ordered || 0) * (parseFloat(l.unit_weight) || 0),
                unit_value:   l.unit_value,
                total_value:  l.total_value,
              };
            }),
            _locationResolved: {
              origin_id:      o.origin_location,
              origin_display: meta.originDisplay,
              origin_name:    meta.originLoc ? meta.originLoc.name : null,
            },
          },
        }
      );
    }

    if (pushed > 0 && typeof notifyTMS === 'function') {
      notifyTMS('orders_updated', { source: 'middleware', count: pushed });
    }
    return pushed + ' order(s) pushed with full lines';
  }

  ns.services.omsSync.pushOrder = {
    run: runPushOrder,
    // Exposed for unit testing - pure helpers.
    _internals: {
      buildCustomerMap:            buildCustomerMap,
      buildLocationMap:            buildLocationMap,
      resolveDestinationLocation:  resolveDestinationLocation,
      totalsFromLines:             totalsFromLines,
      mapOmsOrderToTmsRow:         mapOmsOrderToTmsRow,
      mapOmsLineToTmsLine:         mapOmsLineToTmsLine,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
