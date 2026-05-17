/**
 * useRouteOptimizer — form state + rate-fetch orchestration for the
 * mobile Route Optimizer screen.
 *
 * Mirrors the state surface of the web RouteOptimizerPage but keeps
 * the UI-agnostic logic in this hook so the screen file stays focused
 * on layout.
 *
 * The hook intentionally does NOT auto-fire a fetch on mount — the
 * planner taps "Optimize Route" once the form is filled. After the
 * first optimize, ZIP/weight edits debounce-refresh in the background
 * (parity with the web "auto-refresh when ZIP or weight changes").
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchRateComparison,
  optimizeRoute,
  type OptimizationResult,
  type RateComparisonRow,
  type RateFetchInput,
  type RouteMode,
} from '../services/routeOptimizerService';

export interface RouteOptimizerFormState {
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  mode: RouteMode;
  weightLbs: string;
  originZip: string;
  destZip: string;
}

const INITIAL_FORM: RouteOptimizerFormState = {
  originCity:  '',
  originState: '',
  destCity:    '',
  destState:   '',
  mode:        'ALL',
  weightLbs:   '4000',
  originZip:   '',
  destZip:     '',
};

function joinCityState(city: string, state: string): string {
  const c = city.trim();
  const s = state.trim();
  if (c && s) return `${c}, ${s}`;
  return c || '';
}

function toInput(form: RouteOptimizerFormState): RateFetchInput {
  return {
    origin:       joinCityState(form.originCity, form.originState),
    destination:  joinCityState(form.destCity, form.destState),
    mode:         form.mode,
    weightLbs:    parseInt(form.weightLbs, 10) || 5000,
    originZip:    form.originZip.trim(),
    destZip:      form.destZip.trim(),
  };
}

export interface UseRouteOptimizer {
  form: RouteOptimizerFormState;
  setField: <K extends keyof RouteOptimizerFormState>(
    key: K,
    value: RouteOptimizerFormState[K],
  ) => void;
  reset: () => void;
  loading: boolean;
  hasOptimized: boolean;
  result: OptimizationResult | null;
  rows: RateComparisonRow[];
  error: string | null;
  optimize: () => Promise<void>;
}

export function useRouteOptimizer(): UseRouteOptimizer {
  const [form, setForm]           = useState<RouteOptimizerFormState>(INITIAL_FORM);
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<OptimizationResult | null>(null);
  const [rows, setRows]           = useState<RateComparisonRow[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [hasOptimized, setHasOptimized] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef    = useRef(0);

  const setField = useCallback(
    <K extends keyof RouteOptimizerFormState>(
      key: K,
      value: RouteOptimizerFormState[K],
    ) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const reset = useCallback(() => {
    setForm(INITIAL_FORM);
    setResult(null);
    setRows([]);
    setError(null);
    setHasOptimized(false);
  }, []);

  const optimize = useCallback(async () => {
    const input = toInput(form);
    if (!input.origin || !input.destination) {
      setError('Enter both origin and destination.');
      return;
    }
    setError(null);
    setLoading(true);
    const reqId = ++reqIdRef.current;
    try {
      const optResult = await optimizeRoute(input);
      // Drop the response if a newer request has been issued mid-flight.
      if (reqId !== reqIdRef.current) return;
      setResult(optResult);
      setRows(optResult.rows);
      setHasOptimized(true);
    } catch (err: any) {
      if (reqId !== reqIdRef.current) return;
      setError(err?.message || 'Failed to optimize route.');
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [form]);

  /* ── Debounced background refresh after the first optimize ─────────
     Parity with web: tweaking ZIPs/weight after the initial Optimize
     call kicks off a 600ms-debounced re-fetch so the rate table stays
     live. The mode/origin/destination changes require the explicit
     button tap (matches web behavior). */
  useEffect(() => {
    if (!hasOptimized) return;
    const input = toInput(form);
    if (!input.origin || !input.destination) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        const fresh = await fetchRateComparison(input);
        if (reqId !== reqIdRef.current) return;
        setRows(fresh);
        setResult((prev) => (prev ? { ...prev, rows: fresh, best: fresh[0] || null } : prev));
      } catch {
        /* keep prior result on background-refresh failure */
      }
    }, 600);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.originZip, form.destZip, form.weightLbs]);

  return {
    form,
    setField,
    reset,
    loading,
    hasOptimized,
    result,
    rows,
    error,
    optimize,
  };
}
