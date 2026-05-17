/**
 * RouteOptimizerScreen — mobile parity with the web Route Optimizer
 * (frontend/src/pages/RouteOptimizerPage.jsx).
 *
 * Replaces the prior QA #274 "shortcut" screen (links to Multi-Stop /
 * Bulk Plan) with the same input-driven flow the planners use on the
 * web: enter origin, destination, weight, ZIPs → tap Optimize → see
 * the cheapest carrier and the full quote comparison.
 *
 * Composition (services-first, no mega-files per CLAUDE_RULES):
 *   - useRouteOptimizer (hook)        → form state + rate fetch
 *   - routeOptimizerService           → API orchestration (TL + LTL + miles)
 *   - RouteBuilderCard                → inputs
 *   - OptimizationResultsCard         → summary panel
 *   - CarrierRateList                 → quote list (mobile-friendly)
 *
 * Backend: reuses /api/bulk-plan/rate, /api/ltl/quote, /api/mileage/*
 * with no new mobile-specific endpoints (see service file header for
 * the rationale).
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useRouteOptimizer } from '../../hooks/useRouteOptimizer';
import { borderRadius, colors, fontSize, fontWeight, spacing } from '../../theme';
import RouteBuilderCard from './components/RouteBuilderCard';
import OptimizationResultsCard from './components/OptimizationResultsCard';
import CarrierRateList from './components/CarrierRateList';
import type { RateComparisonRow } from '../../services/routeOptimizerService';

export default function RouteOptimizerScreen() {
  const {
    form,
    setField,
    loading,
    hasOptimized,
    result,
    rows,
    error,
    optimize,
  } = useRouteOptimizer();

  const [toast, setToast] = useState<{ text: string; type: 'info' | 'success' } | null>(null);

  const handleOptimize = useCallback(async () => {
    await optimize();
  }, [optimize]);

  const handleSelect = useCallback((row: RateComparisonRow) => {
    setToast({
      text: `Selected ${row.carrier} (${row.mode}) — $${row.total.toLocaleString()}`,
      type: 'success',
    });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Route Optimizer</Text>
          <Text style={styles.subtitle}>
            Compare TL + CzarLite LTL rates for any lane.
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.optimizeBtn, loading && styles.optimizeBtnDisabled]}
          onPress={handleOptimize}
          disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons name="flash" size={14} color={colors.white} />
          )}
          <Text style={styles.optimizeBtnText}>
            {loading ? 'Optimizing…' : 'Optimize'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Toast */}
      {(toast || error) && (
        <View
          style={[
            styles.toast,
            error
              ? styles.toastError
              : toast?.type === 'success'
                ? styles.toastSuccess
                : styles.toastInfo,
          ]}>
          <Text style={styles.toastText}>
            {error || toast?.text}
          </Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled">
        <RouteBuilderCard form={form} setField={setField} />
        <OptimizationResultsCard hasOptimized={hasOptimized} result={result} />
        <CarrierRateList
          rows={rows}
          hasOptimized={hasOptimized}
          onSelect={handleSelect}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  optimizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accent,
  },
  optimizeBtnDisabled: { opacity: 0.7 },
  optimizeBtnText: {
    color: colors.white,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.sm,
  },
  toast: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  toastSuccess: {
    backgroundColor: colors.greenDim,
    borderColor: 'rgba(5,150,105,0.25)',
  },
  toastInfo: {
    backgroundColor: colors.accentGlow,
    borderColor: 'rgba(37,99,235,0.25)',
  },
  toastError: {
    backgroundColor: colors.redDim,
    borderColor: 'rgba(220,38,38,0.25)',
  },
  toastText: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  scroll: { paddingBottom: spacing.xl },
});
