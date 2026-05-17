/**
 * routeOptimizerService — mobile parity with web RouteOptimizerPage.
 *
 * Web reference: frontend/src/pages/RouteOptimizerPage.jsx
 *   - getDist()            → resolveDistance() below
 *   - fetchRateRows()      → fetchRateComparison() below
 *
 * Pure service layer: takes inputs, calls the shared API, returns plain
 * data. No React state, no UI side-effects. The screen-level hook
 * (useRouteOptimizer) is the only caller.
 *
 * Backend endpoints used (unchanged):
 *   POST /api/bulk-plan/rate   — TL quotes (BulkPlanApi.rate)
 *   POST /api/ltl/quote        — CzarLite LTL quotes (LtlApi.quote)
 *   GET  /api/mileage/estimate — ZIP haversine (MileageApi.estimate)
 *   GET  /api/mileage/city     — city haversine fallback (MileageApi.city)
 *
 * Decision (2026-05-16): no new /api/mobile/route-optimize endpoint.
 * Reusing the existing four endpoints keeps the rate engine as the
 * single source of truth and satisfies the engineering rule against
 * mega-files / duplicated business logic.
 */

import { BulkPlanApi, LtlApi, MileageApi } from '../lib/api';

/* ── Static lookups (subset of web's CITY_ZIP_MAP) ──────────────────── */

const CITY_ZIP_MAP: Record<string, string> = {
  'Chicago, IL':       '60601',
  'Dallas, TX':        '75201',
  'Columbus, OH':      '43201',
  'Atlanta, GA':       '30301',
  'Houston, TX':       '77001',
  'New York, NY':      '10001',
  'Phoenix, AZ':       '85001',
  'Memphis, TN':       '38101',
  'Denver, CO':        '80201',
  'Los Angeles, CA':   '90001',
  'Seattle, WA':       '98101',
  'Charlotte, NC':     '28201',
  'Boston, MA':        '02101',
  'Miami, FL':         '33101',
  'San Jose, CA':      '95101',
  'Mountain View, CA': '94041',
};

/* ── Types ──────────────────────────────────────────────────────────── */

export type RouteMode = 'ALL' | 'TL' | 'LTL';

export interface RateComparisonRow {
  carrier: string;
  mode: 'TL' | 'LTL';
  base: number;
  fsc: number;
  acc: number;
  total: number;
  transit: number | null;
  serviceLevel?: string;
  miles?: number | null;
  pcmilerMiles?: number | null;
  // CzarLite-flavored fields (LTL only)
  _czarlite: boolean;
  _czarliteClass?: number;
  _cwt?: string;
  ratePerCwt?: string;
  czarBase?: number;
  czarBaseGross?: number;
  fscCharge?: number;
  discountPct?: number;
  discountAmt?: number;
  _ccLive?: boolean;
  _ccFailed?: boolean;
  _pref?: boolean;
}

export interface RateFetchInput {
  origin: string;
  destination: string;
  mode: RouteMode;
  weightLbs: number;
  originZip?: string;
  destZip?: string;
}

export interface OptimizationResult {
  origin: string;
  destination: string;
  miles: number | null;
  driveHours: number | null;
  hosOk: boolean | null;
  trailerUtilizationPct: number;
  best: RateComparisonRow | null;
  rows: RateComparisonRow[];
}

/* ── Distance resolution (mirrors web getDist) ──────────────────────── */

export async function resolveDistance(
  origin: string,
  destination: string,
  originZip?: string,
  destZip?: string,
): Promise<number | null> {
  const oZip = originZip || CITY_ZIP_MAP[origin] || '';
  const dZip = destZip   || CITY_ZIP_MAP[destination] || '';

  // 1. ZIP-based estimate via backend.
  if (oZip && dZip) {
    try {
      const data: any = await MileageApi.estimate(oZip, dZip);
      if (data?.miles) return Number(data.miles);
    } catch {
      /* fall through */
    }
  }

  // 2. City-based geocode haversine via backend.
  if (origin && destination) {
    try {
      const data: any = await MileageApi.city(origin, destination);
      if (data?.miles) return Number(data.miles);
    } catch {
      /* fall through */
    }
  }
  return null;
}

/* ── TL block (mirrors web's `bulk-plan/rate` TL pull) ──────────────── */

async function fetchTLRows(input: RateFetchInput): Promise<RateComparisonRow[]> {
  const lane = {
    laneKey:      `${input.origin} -> ${input.destination}`,
    origin:       input.origin,
    destination:  input.destination,
    originZip:    input.originZip || CITY_ZIP_MAP[input.origin] || '',
    destZip:      input.destZip   || CITY_ZIP_MAP[input.destination] || '',
    freightClass: '70',
    totalWeight:  input.weightLbs,
    totalPieces:  1,
    orderIds:     [],
  };

  try {
    const res: any = await BulkPlanApi.rate([lane], 'cost');
    const results = Array.isArray(res?.results) ? res.results : [];
    const tlQuotes = (results[0]?.quotes || []).filter((q: any) => q.mode === 'TL');
    return tlQuotes.map((q: any) => ({
      carrier:       q.carrier || '—',
      mode:          'TL' as const,
      base:          Number(q.czarBaseGross || 0),
      fsc:           Number(q.fscCharge || 0),
      acc:           0,
      total:         Number(q.totalCharge || 0),
      transit:       q.transitDays ?? null,
      _czarlite:     false,
      miles:         q.miles ?? null,
      pcmilerMiles:  q.pcmilerMiles ?? null,
      serviceLevel:  q.serviceLevel || '',
    }));
  } catch (err: any) {
    // Mobile path keeps the surface terse — no FALLBACK_TL_RATES mock
    // table on phone; if the backend rate fails, callers see empty TL
    // rows (the screen surfaces the loading-error state instead).
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[routeOptimizerService] TL rate error:', err?.message || err);
    }
    return [];
  }
}

/* ── CzarLite LTL block (mirrors web's `/api/ltl/quote` pull) ───────── */

async function fetchLTLRows(input: RateFetchInput): Promise<RateComparisonRow[]> {
  const oZip = input.originZip || CITY_ZIP_MAP[input.origin] || '';
  const dZip = input.destZip   || CITY_ZIP_MAP[input.destination] || '';
  if (oZip.length < 4 || dZip.length < 4) return [];

  try {
    const data: any = await LtlApi.quote({
      originZip:    oZip,
      destZip:      dZip,
      weight:       input.weightLbs,
      freightClass: 70,
      originCity:   input.origin,
      destCity:     input.destination,
    });
    const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
    return quotes.map((q: any) => {
      const billedWeight = Number(q.billedWeight || input.weightLbs);
      const czarBase     = Number(q.czarBase || 0);
      return {
        carrier:       q.carrier || '—',
        mode:          'LTL' as const,
        base:          Number(q.czarBaseGross || q.czarBase || 0),
        fsc:           Number(q.fscCharge || 0),
        acc:           0,
        total:         Number(q.totalCharge || 0),
        transit:       q.transitDays ?? null,
        _czarlite:     true,
        _czarliteClass: Number(q.class || 70),
        _cwt:          ((billedWeight) / 100).toFixed(1),
        ratePerCwt:    billedWeight > 0
                         ? (czarBase / (billedWeight / 100)).toFixed(2)
                         : '0.00',
        czarBase:      czarBase,
        czarBaseGross: Number(q.czarBaseGross || czarBase || 0),
        fscCharge:     Number(q.fscCharge || 0),
        discountPct:   Number(q.discountPct || 0),
        discountAmt:   Number(q.discountAmt || 0),
        _ccLive:       !!q._ccLive,
        _ccFailed:     !!q._ccFailed,
        _pref:         false,
        serviceLevel:  q.serviceLevel || '',
      };
    });
  } catch (err: any) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[routeOptimizerService] LTL quote error:', err?.message || err);
    }
    return [];
  }
}

/* ── Orchestrator ───────────────────────────────────────────────────── */

const TRAILER_CAPACITY_LBS = 44_000;
const AVG_DRIVE_MPH        = 55;
const HOS_LIMIT_HOURS      = 11;

export async function fetchRateComparison(
  input: RateFetchInput,
): Promise<RateComparisonRow[]> {
  const showTL  = input.mode === 'ALL' || input.mode === 'TL';
  const showLTL = input.mode === 'ALL' || input.mode === 'LTL';

  // Run TL + LTL in parallel — neither depends on the other.
  const [tlRows, ltlRows] = await Promise.all([
    showTL  ? fetchTLRows(input)  : Promise.resolve([] as RateComparisonRow[]),
    showLTL ? fetchLTLRows(input) : Promise.resolve([] as RateComparisonRow[]),
  ]);

  const rows = [...tlRows, ...ltlRows];
  rows.sort((a, b) => a.total - b.total);
  return rows;
}

export async function optimizeRoute(input: RateFetchInput): Promise<OptimizationResult> {
  const rows = await fetchRateComparison(input);
  const best = rows[0] || null;
  const miles = best?.miles ?? (await resolveDistance(
    input.origin,
    input.destination,
    input.originZip,
    input.destZip,
  ));
  const driveHours = miles ? Number((miles / AVG_DRIVE_MPH).toFixed(1)) : null;
  const hosOk      = driveHours !== null ? driveHours <= HOS_LIMIT_HOURS : null;
  const utilPct    = Math.min(
    100,
    Math.round((input.weightLbs / TRAILER_CAPACITY_LBS) * 100),
  );

  return {
    origin:                 input.origin,
    destination:            input.destination,
    miles,
    driveHours,
    hosOk,
    trailerUtilizationPct:  utilPct,
    best,
    rows,
  };
}
