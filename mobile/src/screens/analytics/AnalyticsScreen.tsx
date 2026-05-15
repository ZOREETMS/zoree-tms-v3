import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { useAnalytics } from '../../shared/hooks/useAnalytics';
import { formatCurrency } from '../../shared/utils/formatters';
import KpiCard from '../../components/ui/KpiCard';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import { exportRowsAsCsv } from '../../services/csvExport';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const MODE_COLORS: Record<string, string> = {
  TL: colors.accent,
  LTL: colors.cyan,
  RAIL: colors.purple,
  AIR: colors.yellow,
  PARCEL: colors.green,
};

const GRADE_COLORS: Record<string, string> = {
  A: colors.green,
  B: colors.accent,
  C: colors.yellow,
};

export default function AnalyticsScreen() {
  const { data, loading, refreshData } = useData();
  const { kpis, spendByMode, carrierScorecard } = useAnalytics(
    data.shipments,
    data.carriers,
  );

  const maxSpend = useMemo(
    () => Math.max(...spendByMode.map((m: any) => m.amount), 1),
    [spendByMode],
  );

  // QA #294 — Export carrier scorecard + spend by mode + KPI summary
  // as a single CSV. Mirrors the web Analytics page's Export button.
  //
  // QA #329 follow-up — `Claims` was missing from the scorecard row
  // even though computeCarrierScorecard already populates it
  // (mobile/src/shared/services/analyticsService.js:104). Added below
  // so the exported CSV matches the web column set users compare
  // against. Cost per Shipment is now prepended as a single-cell KPI
  // line so testers reading the file see the same headline number the
  // dashboard displays — the per-carrier table follows.
  const onExport = useCallback(async () => {
    await exportRowsAsCsv(
      carrierScorecard,
      [
        { key: 'name',  header: 'Carrier' },
        { key: 'otd',   header: 'On-Time Delivery %', value: (r: any) => Number(r.otd || 0).toFixed(1) },
        // QA #329 — restore the Claims column.
        { key: 'claims', header: 'Claims %',          value: (r: any) => Number(r.claims || 0).toFixed(2) },
        { key: 'grade', header: 'Grade' },
        { key: 'shipments', header: 'Shipments' },
        { key: 'spend',     header: 'Spend', value: (r: any) => r.spend },
      ],
      {
        title: `Carrier Scorecard — Cost/Shipment ${formatCurrency(kpis.costPerShipment)}`,
        filename: 'analytics_scorecard.csv',
      },
    );
  }, [carrierScorecard, kpis.costPerShipment]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refreshData}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {/* Header — QA #294 adds inline Export button. */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Analytics</Text>
            <Text style={styles.subtitle}>Shipment and spend insights</Text>
          </View>
          <TouchableOpacity
            onPress={onExport}
            style={styles.exportBtn}
            accessibilityRole="button"
            accessibilityLabel="Export analytics as CSV">
            <Ionicons name="download-outline" size={16} color={colors.accent} />
            <Text style={styles.exportText}>Export</Text>
          </TouchableOpacity>
        </View>

        {/* KPI Cards */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Total Shipments"
              value={kpis.totalShipments}
              icon="cube-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="On-Time %"
              value={`${kpis.onTimePct}%`}
              icon="checkmark-circle-outline"
              color={colors.green}
            />
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Total Spend"
              value={formatCurrency(kpis.totalSpend)}
              icon="wallet-outline"
              color={colors.purple}
            />
          </View>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Cost / Shipment"
              value={formatCurrency(kpis.costPerShipment)}
              icon="trending-down"
              color={colors.cyan}
            />
          </View>
        </View>

        {/* Spend by Mode */}
        <Text style={styles.sectionTitle}>Spend by Mode</Text>
        <Card style={styles.sectionCard}>
          {spendByMode.length === 0 ? (
            <Text style={styles.emptyText}>No shipment data</Text>
          ) : (
            spendByMode.map((mode: any) => (
              <View key={mode.key} style={styles.modeRow}>
                <View style={styles.modeLabelRow}>
                  <Text style={styles.modeLabel}>{mode.label}</Text>
                  <Text style={styles.modePct}>
                    {mode.pct}% ({formatCurrency(mode.amount)})
                  </Text>
                </View>
                <View style={styles.barBg}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${Math.round((mode.amount / maxSpend) * 100)}%`,
                        backgroundColor: MODE_COLORS[mode.key] || colors.accent,
                      },
                    ]}
                  />
                </View>
              </View>
            ))
          )}
        </Card>

        {/* Carrier Scorecard */}
        <Text style={styles.sectionTitle}>Carrier Scorecard</Text>
        {carrierScorecard.length === 0 ? (
          <Card style={styles.sectionCard}>
            <EmptyState
              icon="people-outline"
              title="No carrier data"
              subtitle="Carrier performance will appear here."
            />
          </Card>
        ) : (
          <Card style={styles.sectionCard}>
            {/* Table Header */}
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, styles.colCarrier]}>
                Carrier
              </Text>
              <Text style={[styles.tableHeaderText, styles.colOtd]}>OTD%</Text>
              <Text style={[styles.tableHeaderText, styles.colGrade]}>
                Grade
              </Text>
            </View>

            {carrierScorecard.map((c: any, idx: number) => (
              <View
                key={c.name}
                style={[
                  styles.tableRow,
                  idx === carrierScorecard.length - 1 && styles.tableRowLast,
                ]}
              >
                <Text style={[styles.tableCell, styles.colCarrier]} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={[styles.tableCell, styles.colOtd]}>
                  {c.otd.toFixed(1)}%
                </Text>
                <View style={styles.colGrade}>
                  <View
                    style={[
                      styles.gradeBadge,
                      {
                        backgroundColor: `${GRADE_COLORS[c.grade] || colors.text3}18`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.gradeText,
                        { color: GRADE_COLORS[c.grade] || colors.text3 },
                      ]}
                    >
                      {c.grade}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['5xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  exportText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.md,
  },
  kpiHalf: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionCard: {
    marginHorizontal: spacing.lg,
  },
  emptyText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    textAlign: 'center',
  },

  // Spend by Mode bar chart
  modeRow: {
    marginBottom: spacing.md,
  },
  modeLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  modeLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  modePct: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
  },
  barBg: {
    height: 8,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
    borderRadius: borderRadius.sm,
  },

  // Carrier Scorecard table
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
  },
  tableHeaderText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg3,
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tableCell: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text,
  },
  colCarrier: {
    flex: 2,
  },
  colOtd: {
    flex: 1,
    textAlign: 'center',
  },
  colGrade: {
    flex: 1,
    alignItems: 'center',
  },
  gradeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  gradeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  bottomSpacer: {
    height: spacing['3xl'],
  },
});
