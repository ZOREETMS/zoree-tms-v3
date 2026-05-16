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

import React, { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import EmptyState from '../../components/ui/EmptyState';
import WhatIfBuilder, {
  type WhatIfScenario,
} from '../../components/network/WhatIfBuilder';
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
  // QA #292 — What-If scenario builder. Modifiers reapply to a base
  // copy of SEED_LANES so toggling "Run Analysis" with different
  // values shows what the network looks like under each scenario.
  // Saved scenarios live in component state for now (no server-side
  // scenarios table on mobile yet).
  const [modifiers, setModifiers] = useState<{ ratePct: number; volumePct: number }>({
    ratePct: 0,
    volumePct: 0,
  });
  const [scenarios, setScenarios] = useState<WhatIfScenario[]>([]);
  // QA #328 — Scenario Builder now opens by default. Earlier revisions
  // collapsed it until the user tapped the header chevron, which is
  // why the Run Analysis / Save Scenario buttons read as "missing" in
  // QA reports — they were one tap away and easy to miss.
  const [builderOpen, setBuilderOpen] = useState(true);

  const lanes: LaneRow[] = useMemo(() => {
    const rateFactor = 1 + (modifiers.ratePct || 0) / 100;
    const volFactor  = 1 + (modifiers.volumePct || 0) / 100;
    if (rateFactor === 1 && volFactor === 1) return SEED_LANES;
    return SEED_LANES.map((l) => ({
      ...l,
      avgCostMi: Math.max(0.01, l.avgCostMi * rateFactor),
      loads:     Math.max(0, Math.round(l.loads * volFactor)),
    }));
  }, [modifiers]);

  const kpis = useMemo(() => computeNetworkKpis(lanes), [lanes]);

  const handleRun = (s: { ratePct: number; volumePct: number }) => setModifiers(s);
  const handleSave = (s: { ratePct: number; volumePct: number; label: string }) => {
    setScenarios((prev) => [
      ...prev,
      { id: `s-${Date.now()}`, ...s },
    ]);
  };
  const handleLoadScenario = (s: WhatIfScenario) => {
    setModifiers({ ratePct: s.ratePct, volumePct: s.volumePct });
  };

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
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Network Modeling</Text>
          <Text style={styles.subtitle}>
            Lane benchmarks + utilization. Tweak rate / volume in the
            Scenario Builder below.
          </Text>
        </View>
      </View>
      {/* QA #328 — header-level Run Analysis + Save Scenario buttons
          so the two primary scenario actions are always visible at the
          top of the screen, mirroring the web page header. Both call
          straight into the WhatIfBuilder handlers using the currently
          applied modifiers; the builder card below still lets the user
          adjust the rate / volume inputs in-place. */}
      <View style={styles.headerActions}>
        <TouchableOpacity
          style={[styles.headerActionBtn, styles.headerActionGhost]}
          activeOpacity={0.7}
          onPress={() => {
            Alert.prompt
              ? Alert.prompt(
                  'Save Scenario',
                  'Name this scenario so you can return to it from the list.',
                  (name?: string) => {
                    const label = (name || '').trim();
                    if (!label) return;
                    handleSave({ ratePct: modifiers.ratePct, volumePct: modifiers.volumePct, label });
                    Alert.alert('Scenario saved', label);
                  },
                )
              : (() => {
                  const label = `Scenario ${scenarios.length + 1}`;
                  handleSave({ ratePct: modifiers.ratePct, volumePct: modifiers.volumePct, label });
                  Alert.alert('Scenario saved', label);
                })();
          }}
          accessibilityRole="button"
          accessibilityLabel="Save current scenario">
          <Ionicons name="bookmark-outline" size={16} color={colors.accent} />
          <Text style={[styles.headerActionText, { color: colors.accent }]}>Save Scenario</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.headerActionBtn, styles.headerActionPrimary]}
          activeOpacity={0.7}
          onPress={() => {
            handleRun({ ratePct: modifiers.ratePct, volumePct: modifiers.volumePct });
            setBuilderOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Run analysis on the current scenario">
          <Ionicons name="play-outline" size={16} color={colors.white} />
          <Text style={[styles.headerActionText, { color: colors.white }]}>Run Analysis</Text>
        </TouchableOpacity>
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

        {/* QA #292 — What-If scenario builder. */}
        <WhatIfBuilder
          expanded={builderOpen}
          onToggle={() => setBuilderOpen((v) => !v)}
          onRun={handleRun}
          onSave={handleSave}
          scenarios={scenarios}
          onLoadScenario={handleLoadScenario}
        />

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
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  // QA #328 — header-level Save / Run buttons.
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  headerActionGhost: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  headerActionPrimary: {
    backgroundColor: colors.accent,
  },
  headerActionText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
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
