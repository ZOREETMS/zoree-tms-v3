/**
 * RouteOptimizerScreen — mobile Route Optimizer (QA #274 redesign).
 *
 * Web RouteOptimizer is a desktop-only canvas (drag/drop orders, build
 * stops, real-time rating). On mobile we surface the same three logical
 * sections the QA spec calls out, each pointing at the right existing
 * mobile flow:
 *
 *   1. Route Builder — kicks into Multi-Stop Routes (where the mobile
 *      route-construction flow already lives) and surfaces unplanned
 *      orders inline so the planner can size up the queue.
 *   2. Optimization Results — read-only summary of recent route
 *      activity (recently-executed templates + lane miles totals).
 *   3. Carrier Rate Comparison — top carrier rates per active lane,
 *      letting the planner compare options at a glance.
 *
 * Removed: the old "Saved Templates" list + dashboard summary that QA
 * #274 flagged as wrong — those concerns live under Multi-Stop Routes.
 */

import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import { useData } from '../../state/DataContext';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

interface RateRow {
  carrier: string;
  mode: string;
  rate: number;
  fsc: number;
}

function topRatesFor(
  lane: string,
  rates: any[],
): RateRow[] {
  return (rates || [])
    .filter((r) => {
      const l = String(r?.lane || '').toUpperCase();
      return l.startsWith(lane.toUpperCase());
    })
    .map((r) => ({
      carrier: r.carrier || r.carrier_name || '—',
      mode:    r.mode || r.transport_mode || '—',
      rate:    parseFloat(r.rate || r.rate_per_mile || 0) || 0,
      fsc:     parseFloat(r.fsc || r.fuel_surcharge || 0) || 0,
    }))
    .filter((r) => r.rate > 0)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3);
}

export default function RouteOptimizerScreen() {
  const navigation = useNavigation<any>();
  const { data } = useData();

  const unplannedCount = useMemo(
    () => (data.orders || []).filter((o: any) => o.status === 'Unplanned').length,
    [data.orders],
  );

  // Recent route templates that look like they were used in the last
  // 30 days — proxy for "recent optimization activity" without a
  // dedicated route_executions table on mobile.
  const recentExecutions = useMemo(() => {
    const list: any[] = data.routeTemplates || [];
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return list
      .filter((t) => {
        const ts = new Date(t?.updated_at || t?.created_at || 0).getTime();
        return Number.isFinite(ts) && ts >= cutoff;
      })
      .slice(0, 5);
  }, [data.routeTemplates]);

  // Pick the top 3 active lanes (by shipment volume) and surface the
  // best carrier rates for each — the mobile read of "Carrier Rate
  // Comparison".
  const lanesForComparison = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const s of data.shipments || []) {
      const lane = `${(s.origin_city || s.origin || '').toString().toUpperCase()} → ${
        (s.destination_city || s.destination || '').toString().toUpperCase()
      }`;
      if (lane === ' → ') continue;
      groups[lane] = (groups[lane] || 0) + 1;
    }
    return Object.entries(groups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([lane, count]) => ({
        lane,
        count,
        rates: topRatesFor(lane.split(' → ')[0] || '', data.rates || []),
      }));
  }, [data.shipments, data.rates]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Route Optimizer</Text>
        <Text style={styles.subtitle}>
          Build routes, review results, compare carrier rates.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* SECTION 1 — Route Builder */}
        <Text style={styles.sectionTitle}>Route Builder</Text>
        <Card style={styles.sectionCard}>
          <View style={styles.sectionRow}>
            <Ionicons name="construct-outline" size={22} color={colors.accent} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.sectionHeading}>
                {unplannedCount} unplanned order{unplannedCount === 1 ? '' : 's'}
              </Text>
              <Text style={styles.sectionBody}>
                Build a multi-stop route from orders awaiting planning.
              </Text>
            </View>
          </View>
          <View style={styles.ctaRow}>
            <TouchableOpacity
              style={[styles.cta, styles.ctaSecondary]}
              onPress={() => navigation.navigate('BulkPlanTab', { screen: 'BulkPlan' })}>
              <Ionicons name="layers-outline" size={14} color={colors.accent} />
              <Text style={styles.ctaSecondaryText}>Bulk Plan</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cta, styles.ctaPrimary]}
              onPress={() => navigation.navigate('MultiStopTab', { screen: 'MultiStopRoutes' })}>
              <Ionicons name="git-branch-outline" size={14} color={colors.white} />
              <Text style={styles.ctaPrimaryText}>Multi-Stop Builder</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* SECTION 2 — Optimization Results */}
        <Text style={styles.sectionTitle}>Optimization Results</Text>
        <Card style={styles.sectionCard}>
          {recentExecutions.length === 0 ? (
            <EmptyState
              icon="trending-up-outline"
              title="No recent route activity"
              subtitle="Execute a multi-stop template to see results here."
            />
          ) : (
            recentExecutions.map((t: any) => {
              const stops = Array.isArray(t.stops) ? t.stops.length : t.stop_count || 0;
              const miles = Number(t.total_miles || t.totalMiles || 0);
              return (
                <View key={String(t.id || t.name)} style={styles.resultRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {t.name || `Route ${t.id}`}
                    </Text>
                    <Text style={styles.resultMeta}>
                      {stops} stop{stops === 1 ? '' : 's'} ·{' '}
                      {miles ? `${miles.toLocaleString()} mi` : '— mi'} ·{' '}
                      Updated {String(t.updated_at || t.created_at || '').slice(0, 10) || '—'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.text3} />
                </View>
              );
            })
          )}
        </Card>

        {/* SECTION 3 — Carrier Rate Comparison */}
        <Text style={styles.sectionTitle}>Carrier Rate Comparison</Text>
        <Card style={styles.sectionCard}>
          {lanesForComparison.length === 0 ? (
            <EmptyState
              icon="cash-outline"
              title="No lane data yet"
              subtitle="Run a few shipments so we can compare carrier rates here."
            />
          ) : (
            lanesForComparison.map((laneRow) => (
              <View key={laneRow.lane} style={styles.laneBlock}>
                <View style={styles.laneHeader}>
                  <Text style={styles.laneName} numberOfLines={1}>
                    {laneRow.lane}
                  </Text>
                  <Text style={styles.laneMeta}>
                    {laneRow.count} shipment{laneRow.count === 1 ? '' : 's'}
                  </Text>
                </View>
                {laneRow.rates.length === 0 ? (
                  <Text style={styles.laneEmpty}>
                    No matching carrier rates loaded.
                  </Text>
                ) : (
                  laneRow.rates.map((r, idx) => (
                    <View key={`${r.carrier}-${idx}`} style={styles.rateRow}>
                      <View style={styles.rateRankBadge}>
                        <Text style={styles.rateRankText}>#{idx + 1}</Text>
                      </View>
                      <Text style={styles.rateCarrier} numberOfLines={1}>
                        {r.carrier}
                      </Text>
                      <Text style={styles.rateMode}>{r.mode}</Text>
                      <Text style={styles.rateValue}>
                        ${r.rate.toFixed(2)}
                        {r.fsc ? ` +${r.fsc}% FSC` : ''}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
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
  scroll: {
    paddingBottom: spacing['3xl'],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center' },
  sectionHeading: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  sectionBody: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  cta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  ctaPrimary:   { backgroundColor: colors.accent },
  ctaSecondary: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.bg2 },
  ctaPrimaryText: {
    color: colors.white,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.sm,
  },
  ctaSecondaryText: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.sm,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  resultMeta: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
  },
  laneBlock: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  laneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  laneName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  laneMeta: { fontSize: fontSize.xs, color: colors.text3 },
  laneEmpty: { fontSize: fontSize.xs, color: colors.text3, fontStyle: 'italic' },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  rateRankBadge: {
    width: 22,
    height: 22,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(37,99,235,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rateRankText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  rateCarrier: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  rateMode: {
    fontSize: fontSize.xs,
    color: colors.text3,
    minWidth: 32,
    textAlign: 'center',
  },
  rateValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.green,
  },
});
