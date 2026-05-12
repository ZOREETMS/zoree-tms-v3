/**
 * NetworkModelingScreen — QA P207 (2026-05-11).
 *
 * Mobile-appropriate read-only companion to
 * frontend/src/pages/NetworkModelingPage.jsx. The web page lets users
 * tweak rate / volume scenarios via a desktop-sized side panel; on
 * mobile we surface the KPI snapshot + lane table so planners on the
 * road can see at a glance which lanes are over-benchmark or
 * under-utilized, without trying to fit the scenario builder into a
 * phone form factor. Authoring stays on the web (called out in the
 * subtitle so users know where to go).
 *
 * Data source: the same `computeNetworkKpis` / SEED_LANES the web
 * uses (mobile/src/shared/services/networkService.js — synced copy).
 * A future PR can swap in tenant-real lane stats; the seed shape is
 * already 1:1 with what the web hook produces.
 */

import React, { useMemo } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import EmptyState from '../../components/ui/EmptyState';
import {
  SEED_LANES,
  computeNetworkKpis,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} from '../../shared/services/networkService';
import { formatCurrency } from '../../shared/utils/formatters';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

interface LaneRow {
  lane: string;
  loads: number;
  avgCostMi: number;
  benchmark: number;
  util: number;
  opportunity: string;
}

// Mirror the web's coloring rules from
// frontend/src/components/network/LaneTable — kept local because the
// web component is JSX and we don't want to bring its DOM-specific
// styles into RN.
function utilColor(util: number): string {
  if (util >= 85) return '#22c55e';
  if (util >= 65) return '#f59e0b';
  return '#ef4444';
}

function opportunityTone(text: string): { color: string; bg: string } {
  const t = (text || '').toLowerCase();
  if (t.startsWith('high')) {
    return { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' };
  }
  if (t.startsWith('medium')) {
    return { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  }
  if (t.includes('low')) {
    return { color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
  }
  return { color: '#22c55e', bg: 'rgba(34,197,94,0.12)' };
}

export default function NetworkModelingScreen() {
  const lanes: LaneRow[] = SEED_LANES;
  const kpis = useMemo(() => computeNetworkKpis(lanes), [lanes]);

  const renderItem = ({ item }: { item: LaneRow }) => {
    const variance = item.avgCostMi - item.benchmark;
    const isOver = variance > 0;
    const utilCol = utilColor(item.util);
    const opp = opportunityTone(item.opportunity);
    return (
      <Card style={styles.laneCard}>
        <View style={styles.laneHeader}>
          <Text style={styles.laneName}>{item.lane}</Text>
          <Text style={styles.loads}>{item.loads} loads</Text>
        </View>
        <View style={styles.metricRow}>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Cost / mi</Text>
            <Text style={[styles.metricValue, isOver && styles.overBudget]}>
              ${item.avgCostMi.toFixed(2)}
            </Text>
            <Text style={styles.benchmark}>
              vs ${item.benchmark.toFixed(2)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metricLabel}>Utilization</Text>
            <Text style={[styles.metricValue, { color: utilCol }]}>
              {item.util}%
            </Text>
            <View style={styles.utilBar}>
              <View
                style={[
                  styles.utilFill,
                  { width: `${Math.min(100, item.util)}%`, backgroundColor: utilCol },
                ]}
              />
            </View>
          </View>
        </View>
        <View style={[styles.opportunity, { backgroundColor: opp.bg }]}>
          <Text style={[styles.opportunityText, { color: opp.color }]}>
            {item.opportunity}
          </Text>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Network Modeling</Text>
        <Text style={styles.subtitle}>
          Lane benchmarks + utilization. Scenario authoring lives on the web.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* KPI row */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Active Lanes"
              value={kpis.active}
              icon="navigate-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Optimized"
              value={kpis.optimized}
              icon="checkmark-circle-outline"
              color={colors.green}
            />
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Under-utilized"
              value={kpis.underUtilized}
              icon="alert-circle-outline"
              color={colors.red}
            />
          </View>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Savings Potential"
              value={formatCurrency(kpis.savings)}
              icon="trending-up-outline"
              color={colors.purple}
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Lanes</Text>
        {lanes.length === 0 ? (
          <EmptyState
            icon="git-network-outline"
            title="No lane data yet"
            subtitle="Add carrier rates and run a few shipments to populate the network model."
          />
        ) : (
          <FlatList
            data={lanes}
            keyExtractor={(l) => l.lane}
            renderItem={renderItem}
            scrollEnabled={false}
            contentContainerStyle={styles.listContent}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing['3xl'] },
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
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  kpiHalf: { flex: 1 },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listContent: { paddingHorizontal: spacing.lg },
  laneCard: { marginBottom: spacing.md },
  laneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  laneName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  loads: {
    fontSize: fontSize.xs,
    color: colors.text3,
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  metric: { flex: 1 },
  metricLabel: {
    fontSize: fontSize.xs,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  overBudget: { color: '#ef4444' },
  benchmark: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
  },
  utilBar: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    marginTop: 4,
    overflow: 'hidden',
  },
  utilFill: { height: '100%', borderRadius: 3 },
  opportunity: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
  },
  opportunityText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
