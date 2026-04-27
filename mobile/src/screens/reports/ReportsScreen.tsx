/**
 * ReportsScreen — Reports Workbench on mobile.
 *
 * Mobile mirror of frontend/src/pages/ReportsPage.jsx. The web version
 * is a two-pane layout (library on the left, ReportOutput on the right);
 * mobile stacks them: a horizontally-scrollable category-grouped chip
 * library at the top, the selected report's output below.
 *
 * Data builders + the active-report state hook are shared with the web
 * (mobile/src/shared/services/reportsService.js +
 *  mobile/src/shared/hooks/useReports.js).
 */

import React, { useMemo } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import EmptyState from '../../components/ui/EmptyState';
import { useData } from '../../state/DataContext';
import useReports from '../../shared/hooks/useReports';
import {
  buildCarrierPerformance,
  buildConsolidationSavings,
  buildFreightSpend,
  buildLaneCostAnalysis,
  buildOnTimeDelivery,
  buildSustainability,
} from '../../shared/services/reportsService';
import {
  REPORT_CATEGORIES,
  EXPORT_FORMATS,
} from '../../shared/types/reports';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function ReportsScreen() {
  const { data } = useData();
  const { activeReport, selectReport, exportReport, reports } = useReports();

  const carriers = data.carriers || [];
  const shipments = data.shipments || [];

  const handleExport = (format: string) => {
    if (!activeReport) return;
    const result = exportReport(format);
    if (result) {
      Alert.alert(
        'Export queued',
        `${result.label} will be exported as ${result.format}. ` +
          'Real export pipeline lands in a future iteration.',
      );
    }
  };

  // Group reports by category for the library section.
  const groupedReports = useMemo(() => {
    const buckets: Record<string, any[]> = {};
    for (const cat of REPORT_CATEGORIES as readonly string[]) buckets[cat] = [];
    for (const r of reports as any[]) {
      if (!buckets[r.category]) buckets[r.category] = [];
      buckets[r.category].push(r);
    }
    return buckets;
  }, [reports]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Ionicons name="bar-chart-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Reports Workbench</Text>
        </View>
        <Text style={styles.subtitle}>
          Custom reports, KPI dashboards, and exports. Tap a report to load it
          below — the data is computed live from your current shipments and carriers.
        </Text>

        {/* Library — chips per category */}
        {(REPORT_CATEGORIES as readonly string[]).map((cat) => {
          const list = groupedReports[cat] || [];
          if (list.length === 0) return null;
          return (
            <View key={cat} style={styles.categoryBlock}>
              <Text style={styles.categoryLabel}>{cat.toUpperCase()}</Text>
              <View style={styles.chipRow}>
                {list.map((r: any) => {
                  const isActive = activeReport?.id === r.id;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[styles.chip, isActive && styles.chipActive]}
                      onPress={() => selectReport(r.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.chipIcon}>{r.icon}</Text>
                      <Text
                        style={[styles.chipText, isActive && styles.chipTextActive]}
                        numberOfLines={2}
                      >
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}

        {/* Output area */}
        <View style={styles.outputHeaderRow}>
          <Text style={styles.outputTitle}>
            {activeReport ? `${activeReport.icon}  ${activeReport.label}` : 'Output'}
          </Text>
          {activeReport ? (
            <View style={styles.exportRow}>
              {(EXPORT_FORMATS as readonly string[]).map((fmt) => (
                <TouchableOpacity
                  key={fmt}
                  style={styles.exportBtn}
                  onPress={() => handleExport(fmt)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="download-outline" size={14} color={colors.accent} />
                  <Text style={styles.exportBtnText}>{fmt.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>

        {!activeReport ? (
          <Card style={styles.outputCard}>
            <EmptyState
              icon="bar-chart-outline"
              title="Pick a report"
              subtitle="Select any report from the library above to see its data."
            />
          </Card>
        ) : (
          <ReportRenderer
            reportId={activeReport.id}
            carriers={carriers}
            shipments={shipments}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Per-report rendering ──────────────────────────────────────────── */

function ReportRenderer({
  reportId,
  carriers,
  shipments,
}: {
  reportId: string;
  carriers: any[];
  shipments: any[];
}) {
  switch (reportId) {
    case 'carrier-perf':
      return <CarrierPerformanceReport carriers={carriers} shipments={shipments} />;
    case 'lane-cost':
      return <LaneCostReport />;
    case 'on-time':
      return <OnTimeDeliveryReport carriers={carriers} shipments={shipments} />;
    case 'freight-spend':
      return <FreightSpendReport shipments={shipments} />;
    case 'consolidation':
      return <ConsolidationSavingsReport shipments={shipments} />;
    case 'sustainability':
      return <SustainabilityReport carriers={carriers} shipments={shipments} />;
    default:
      return (
        <Card style={styles.outputCard}>
          <EmptyState
            icon="construct-outline"
            title="Coming soon"
            subtitle="This report doesn't have a mobile renderer yet — the data builders are pending."
          />
        </Card>
      );
  }
}

function gradeColor(grade: string): string {
  if (grade === 'A') return colors.green;
  if (grade === 'B') return colors.yellow;
  return colors.red;
}

function otdColor(otd: number): string {
  if (otd > 95) return colors.green;
  if (otd > 90) return colors.yellow;
  return colors.red;
}

function CarrierPerformanceReport({
  carriers,
  shipments,
}: {
  carriers: any[];
  shipments: any[];
}) {
  const rows = useMemo(
    () => buildCarrierPerformance(carriers, shipments),
    [carriers, shipments],
  );
  if (rows.length === 0) {
    return (
      <Card style={styles.outputCard}>
        <Text style={styles.emptyText}>No carrier data available.</Text>
      </Card>
    );
  }
  return (
    <View>
      {rows.map((r: any, i: number) => (
        <Card key={r.scac || i} style={styles.rowCard}>
          <View style={styles.rowHeader}>
            <View style={styles.flex1}>
              <Text style={styles.rowTitle} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.rowSub}>
                {r.scac || '—'}  ·  {r.mode || '—'}
              </Text>
            </View>
            <Text style={[styles.gradeBadge, { color: gradeColor(r.grade) }]}>
              {r.grade}
            </Text>
          </View>
          <View style={styles.metricsRow}>
            <Metric label="OTD" value={`${r.otd}%`} color={otdColor(r.otd)} />
            <Metric label="Claim" value={`${r.claim}%`} />
            <Metric label="Avg Rate" value={`$${Number(r.avgRate).toFixed(2)}/mi`} />
            <Metric label="Shipments" value={String(r.shipments)} />
          </View>
        </Card>
      ))}
    </View>
  );
}

function LaneCostReport() {
  const rows = useMemo(() => buildLaneCostAnalysis(), []);
  return (
    <View>
      {rows.map((r: any) => {
        const overBenchmark = (r.variance || 0) > 0;
        return (
          <Card key={r.lane} style={styles.rowCard}>
            <View style={styles.rowHeader}>
              <View style={styles.flex1}>
                <Text style={styles.rowTitle}>{r.lane}</Text>
                <Text style={styles.rowSub}>
                  {r.loads} loads  ·  {r.util}% util
                </Text>
              </View>
              <Text
                style={[
                  styles.varianceBadge,
                  { color: overBenchmark ? colors.red : colors.green },
                ]}
              >
                {overBenchmark ? '+' : ''}{r.variance}%
              </Text>
            </View>
            <View style={styles.metricsRow}>
              <Metric label="Avg $/mi" value={`$${r.avgCostMi.toFixed(2)}`} />
              <Metric label="Benchmark" value={`$${r.benchmark.toFixed(2)}`} />
            </View>
            <Text style={styles.opportunityText}>
              Opportunity: <Text style={styles.opportunityValue}>{r.opportunity}</Text>
            </Text>
          </Card>
        );
      })}
    </View>
  );
}

function OnTimeDeliveryReport({
  carriers,
  shipments,
}: {
  carriers: any[];
  shipments: any[];
}) {
  const out = useMemo(
    () => buildOnTimeDelivery(carriers, shipments),
    [carriers, shipments],
  );
  return (
    <View>
      <View style={styles.kpiRow}>
        <KpiCard label="Avg OTD" value={`${out.avg}%`} icon="checkmark-circle-outline" color={colors.accent} />
        <KpiCard label="Best" value={out.best} icon="ribbon-outline" color={colors.green} />
        <KpiCard label="Worst" value={out.worst} icon="warning-outline" color={colors.red} />
      </View>
      {out.rows.map((r: any) => (
        <Card key={r.name} style={styles.rowCard}>
          <View style={styles.rowHeader}>
            <Text style={styles.rowTitle}>{r.name}</Text>
            <Text style={[styles.otdBadge, { color: otdColor(r.otd) }]}>{r.otd}%</Text>
          </View>
          <Text style={styles.rowSub}>{r.shipments} shipments</Text>
        </Card>
      ))}
    </View>
  );
}

function FreightSpendReport({ shipments }: { shipments: any[] }) {
  const out = useMemo(() => buildFreightSpend(shipments), [shipments]);
  if (out.breakdown.length === 0) {
    return (
      <Card style={styles.outputCard}>
        <Text style={styles.emptyText}>No invoiced shipments to spend-analyze.</Text>
      </Card>
    );
  }
  return (
    <View>
      <View style={styles.kpiRow}>
        <KpiCard
          label="Total Spend"
          value={`$${Math.round(out.total).toLocaleString()}`}
          icon="cash-outline"
          color={colors.accent}
        />
        <KpiCard
          label="Carriers"
          value={String(out.breakdown.length)}
          icon="business-outline"
          color={colors.cyan}
        />
      </View>
      {out.breakdown.map((b: any) => (
        <Card key={b.name} style={styles.rowCard}>
          <View style={styles.rowHeader}>
            <Text style={styles.rowTitle} numberOfLines={1}>{b.name}</Text>
            <Text style={styles.spendValue}>
              ${Math.round(b.amount).toLocaleString()}
            </Text>
          </View>
          {/* Lightweight progress bar */}
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.min(100, b.pct)}%` }]} />
          </View>
          <Text style={styles.rowSub}>{b.pct}% of total spend</Text>
        </Card>
      ))}
    </View>
  );
}

function ConsolidationSavingsReport({ shipments }: { shipments: any[] }) {
  const out = useMemo(() => buildConsolidationSavings(shipments), [shipments]);
  return (
    <View>
      <View style={styles.kpiRow}>
        <KpiCard
          label="Consolidated"
          value={String(out.count)}
          icon="git-merge-outline"
          color={colors.accent}
        />
        <KpiCard
          label="Total Saved"
          value={`$${Math.round(out.totalSavings).toLocaleString()}`}
          icon="trending-down-outline"
          color={colors.green}
        />
        <KpiCard
          label="Avg / Ship"
          value={`$${out.avgSaving}`}
          icon="cash-outline"
          color={colors.cyan}
        />
      </View>
      {out.rows.length === 0 ? (
        <Card style={styles.outputCard}>
          <Text style={styles.emptyText}>
            No consolidated shipments yet. Use Bulk Plan to combine orders into multi-stop loads.
          </Text>
        </Card>
      ) : (
        out.rows.map((r: any) => (
          <Card key={r.id} style={styles.rowCard}>
            <View style={styles.rowHeader}>
              <View style={styles.flex1}>
                <Text style={styles.rowTitle} numberOfLines={1}>{r.id}</Text>
                <Text style={styles.rowSub}>
                  {r.origin || '?'} → {r.dest || '?'}  ·  {r.orderCount} orders
                </Text>
              </View>
              <Text style={styles.spendValue}>
                ${Math.round(r.saving).toLocaleString()}
              </Text>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}

function SustainabilityReport({
  carriers,
  shipments,
}: {
  carriers: any[];
  shipments: any[];
}) {
  const out = useMemo(
    () => buildSustainability(carriers, shipments),
    [carriers, shipments],
  );
  return (
    <View>
      <View style={styles.kpiRow}>
        <KpiCard
          label="Total Miles"
          value={Number(out.totalMiles).toLocaleString()}
          icon="speedometer-outline"
          color={colors.accent}
        />
        <KpiCard
          label="CO₂ kg"
          value={Number(out.co2kg).toLocaleString()}
          icon="leaf-outline"
          color={colors.green}
        />
        <KpiCard
          label="Saved (cons.)"
          value={`${Number(out.savedViaConsolidation).toLocaleString()} kg`}
          icon="trending-down-outline"
          color={colors.cyan}
        />
      </View>
      <Text style={styles.sectionLabel}>BY CARRIER</Text>
      {out.byCarrier.length === 0 ? (
        <Card style={styles.outputCard}>
          <Text style={styles.emptyText}>No carrier data yet.</Text>
        </Card>
      ) : (
        out.byCarrier.map((c: any) => (
          <Card key={c.name} style={styles.rowCard}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowTitle} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.spendValue}>{c.co2.toLocaleString()} kg</Text>
            </View>
            <Text style={styles.rowSub}>
              {c.miles.toLocaleString()} miles
            </Text>
          </Card>
        ))
      )}
    </View>
  );
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.metricCol}>
      <Text style={styles.metricLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.metricValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  categoryBlock: { marginBottom: spacing.md },
  categoryLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    minWidth: 130,
    flexShrink: 1,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentGlow },
  chipIcon: { fontSize: fontSize.md },
  chipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    flexShrink: 1,
  },
  chipTextActive: { color: colors.accent },
  outputHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  outputTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    flex: 1,
  },
  exportRow: { flexDirection: 'row', gap: spacing.xs },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  exportBtnText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  outputCard: {
    minHeight: 140,
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.text3,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  rowCard: { marginBottom: spacing.sm },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  flex1: { flex: 1 },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  rowSub: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
  },
  gradeBadge: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  varianceBadge: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  otdBadge: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  metricCol: { minWidth: 80 },
  metricLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: 2,
  },
  opportunityText: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: spacing.sm,
  },
  opportunityValue: {
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  spendValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  barTrack: {
    height: 6,
    backgroundColor: colors.bg3,
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: spacing.xs,
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
});
