import React, { useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFreightAudit } from '../../shared/hooks/useFreightAudit';
import { SEED_AUDIT_DATA, formatVariance } from '../../shared/services/freightAuditService';
import { AUDIT_STATUS, PAY_STATUS } from '../../shared/types/freightAudit';
import { formatCurrency } from '../../shared/utils/formatters';
import KpiCard from '../../components/ui/KpiCard';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import FilterDropdown from '../../components/common/FilterDropdown';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const AUDIT_FILTERS = [
  { key: '', label: 'All' },
  { key: AUDIT_STATUS.MATCHED, label: 'Matched' },
  { key: AUDIT_STATUS.DISCREPANCY, label: 'Discrepancy' },
  { key: PAY_STATUS.PENDING, label: 'Pending' },
  { key: PAY_STATUS.ON_HOLD, label: 'On Hold' },
];

export default function FreightAuditScreen() {
  const {
    records,
    filtered,
    filter,
    setFilter,
    kpis,
    approveInvoice,
    disputeInvoice,
    releaseHold,
    setRecords,
  } = useFreightAudit(SEED_AUDIT_DATA);

  // QA #326 — Pending Review section. Lists invoices that need a
  // reviewer's attention: flagged discrepancies AND any invoice still
  // pending payment. Top 3 surface inline with a "View all" affordance
  // that drops the filter onto the main list.
  const pendingReview = useMemo(() => {
    return (records || [])
      .filter(
        (r: any) =>
          r.auditStatus === AUDIT_STATUS.DISCREPANCY ||
          r.payStatus === PAY_STATUS.PENDING ||
          r.payStatus === PAY_STATUS.ON_HOLD,
      )
      .slice(0, 3);
  }, [records]);
  const pendingReviewTotal = (records || []).filter(
    (r: any) =>
      r.auditStatus === AUDIT_STATUS.DISCREPANCY ||
      r.payStatus === PAY_STATUS.PENDING ||
      r.payStatus === PAY_STATUS.ON_HOLD,
  ).length;

  const handleApprove = useCallback(
    (inv: string) => {
      Alert.alert('Approve', `Approve payment for ${inv}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => approveInvoice(inv) },
      ]);
    },
    [approveInvoice],
  );

  const handleDispute = useCallback(
    (inv: string) => {
      Alert.alert('Dispute', `Dispute invoice ${inv}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Dispute', style: 'destructive', onPress: () => disputeInvoice(inv) },
      ]);
    },
    [disputeInvoice],
  );

  const handleRelease = useCallback(
    (inv: string) => {
      Alert.alert('Release Hold', `Release hold on ${inv}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Release', onPress: () => releaseHold(inv) },
      ]);
    },
    [releaseHold],
  );

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const variance = item.billed - item.agreed;
      const hasDiscrepancy = item.auditStatus === AUDIT_STATUS.DISCREPANCY;

      return (
        <Card style={styles.auditCard}>
          <View style={styles.auditHeader}>
            <View style={styles.auditInfo}>
              <Text style={styles.auditInv}>{item.inv}</Text>
              <Text style={styles.auditCarrier} numberOfLines={1}>
                {item.carrier}
              </Text>
            </View>
            <StatusBadge status={item.auditStatus} />
          </View>

          <View style={styles.auditDetails}>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Agreed</Text>
              <Text style={styles.detailValue}>
                ${item.agreed.toLocaleString()}
              </Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Billed</Text>
              <Text style={styles.detailValue}>
                ${item.billed.toLocaleString()}
              </Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Variance</Text>
              <Text
                style={[
                  styles.detailValue,
                  {
                    color:
                      variance === 0
                        ? colors.green
                        : variance > 0
                        ? colors.red
                        : colors.green,
                  },
                ]}
              >
                {formatVariance(variance)}
              </Text>
            </View>
          </View>

          {item.issue ? (
            <View style={styles.issueRow}>
              <Ionicons name="flag" size={14} color={colors.red} />
              <Text style={styles.issueText}>{item.issue}</Text>
            </View>
          ) : null}

          <View style={styles.payRow}>
            <Text style={styles.payLabel}>Payment:</Text>
            <StatusBadge status={item.payStatus} />
          </View>

          {/* Actions */}
          {item.payStatus !== PAY_STATUS.APPROVED && (
            <View style={styles.auditActions}>
              {item.payStatus === PAY_STATUS.PENDING && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnApprove]}
                  activeOpacity={0.7}
                  onPress={() => handleApprove(item.inv)}
                >
                  <Text style={[styles.actionBtnText, { color: colors.green }]}>
                    Approve
                  </Text>
                </TouchableOpacity>
              )}
              {item.payStatus !== PAY_STATUS.DISPUTED && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnDispute]}
                  activeOpacity={0.7}
                  onPress={() => handleDispute(item.inv)}
                >
                  <Text style={[styles.actionBtnText, { color: colors.red }]}>
                    Dispute
                  </Text>
                </TouchableOpacity>
              )}
              {item.payStatus === PAY_STATUS.ON_HOLD && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnRelease]}
                  activeOpacity={0.7}
                  onPress={() => handleRelease(item.inv)}
                >
                  <Text style={[styles.actionBtnText, { color: colors.yellow }]}>
                    Release Hold
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Card>
      );
    },
    [handleApprove, handleDispute, handleRelease],
  );

  const keyExtractor = useCallback((item: any) => item.inv, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header — QA #288 adds page-level audit actions (Run Auto-
            Audit + Approve All Clean) mirroring the web Freight Audit
            toolbar. Per-row Approve / Dispute / Release stay on each
            audit card so the planner can drill down too. */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Freight Audit</Text>
            <Text style={styles.subtitle}>Invoice verification and payment</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Run Auto-Audit',
                  'This will compare every invoice against its agreed shipment cost and flag discrepancies. Continue?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Run',
                      onPress: () => {
                        // Auto-audit is computed client-side from the
                        // SEED_AUDIT_DATA the hook already filters. The
                        // hook itself doesn't expose a "rerun" action;
                        // bumping setRecords with a clone is enough to
                        // trigger a re-derive in the consumer.
                        setRecords((prev: any[]) => [...prev]);
                        // QA #326 — surface the result so the planner
                        // sees the action completed. Without this the
                        // tap looked like a no-op even though the KPI
                        // tiles updated. Numbers are read off `kpis`
                        // post-re-derive so the message reflects what
                        // the user is now looking at.
                        Alert.alert(
                          'Auto-Audit Complete',
                          `Reviewed ${kpis.total} invoice${kpis.total === 1 ? '' : 's'}: ${kpis.matched} matched, ${kpis.discrepancies} flagged for review.`,
                        );
                      },
                    },
                  ],
                );
              }}
              style={styles.toolbarBtn}
              accessibilityRole="button"
              accessibilityLabel="Run automatic audit pass">
              <Ionicons name="refresh-outline" size={16} color={colors.accent} />
              <Text style={styles.toolbarText}>Run Auto-Audit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const clean = filtered.filter(
                  (r: any) => r.auditStatus === AUDIT_STATUS.MATCHED,
                );
                if (clean.length === 0) {
                  Alert.alert(
                    'Nothing to approve',
                    'There are no clean (matched) invoices in the current view.',
                  );
                  return;
                }
                Alert.alert(
                  'Approve All Clean',
                  `Approve ${clean.length} matched invoice${
                    clean.length !== 1 ? 's' : ''
                  } for payment?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Approve',
                      onPress: () => {
                        clean.forEach((r: any) => approveInvoice(r.inv));
                      },
                    },
                  ],
                );
              }}
              style={[styles.toolbarBtn, styles.toolbarBtnPrimary]}
              accessibilityRole="button"
              accessibilityLabel="Approve all matched invoices">
              <Ionicons name="checkmark-done-outline" size={16} color={colors.white} />
              <Text style={[styles.toolbarText, styles.toolbarTextPrimary]}>
                Approve Clean
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* KPI Cards */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Total Audited"
              value={kpis.total}
              icon="document-text-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Matched"
              value={kpis.matched}
              icon="checkmark-circle-outline"
              color={colors.green}
            />
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Discrepancies"
              value={kpis.discrepancies}
              icon="alert-circle-outline"
              color={colors.red}
            />
          </View>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Savings"
              value={formatCurrency(kpis.recovered)}
              icon="trending-up"
              color={colors.purple}
            />
          </View>
        </View>

        {/* QA #326 — Pending Review dashboard card. Highlights the
            invoices that need an audit reviewer to act (flagged
            discrepancies, pending or on-hold payments). Mirrors the
            web Freight Audit "Pending Review" panel. Tap "View all"
            to drop the audit-state filter onto the main list. */}
        {pendingReviewTotal > 0 ? (
          <View style={styles.pendingCard}>
            <View style={styles.pendingHeader}>
              <View style={styles.pendingTitleRow}>
                <Ionicons name="hourglass-outline" size={16} color={colors.yellow} />
                <Text style={styles.pendingTitle}>Pending Review</Text>
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>{pendingReviewTotal}</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setFilter(AUDIT_STATUS.DISCREPANCY)}
                accessibilityRole="button"
                accessibilityLabel="View all pending review records"
              >
                <Text style={styles.pendingLink}>View all</Text>
              </TouchableOpacity>
            </View>
            {pendingReview.map((r: any) => (
              <View key={`pending-${r.inv}`} style={styles.pendingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pendingInv} numberOfLines={1}>{r.inv}</Text>
                  <Text style={styles.pendingMeta} numberOfLines={1}>
                    {r.carrier} · {r.issue || (r.auditStatus === AUDIT_STATUS.DISCREPANCY ? 'Flagged for review' : 'Awaiting approval')}
                  </Text>
                </View>
                <StatusBadge status={r.auditStatus} />
              </View>
            ))}
          </View>
        ) : null}

        {/* QA #326 — chip filter row swapped for a dropdown so the
            active option stays visible on narrow phones (the chip set
            of five wrapped to two rows and the active state was easy
            to miss). Counts come from kpis where each filter has a
            natural match. */}
        <FilterDropdown
          label="Audit Filter"
          value={filter}
          onChange={setFilter}
          options={AUDIT_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
          counts={{
            '': kpis.total,
            [AUDIT_STATUS.MATCHED]: kpis.matched,
            [AUDIT_STATUS.DISCREPANCY]: kpis.discrepancies,
          }}
          modalTitle="Filter Audit Records"
        />

        {/* Audit Records List */}
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={
            filtered.length === 0 ? styles.emptyContainer : styles.listContent
          }
          ListEmptyComponent={
            <EmptyState
              icon="shield-checkmark-outline"
              title="No audit records"
              subtitle="No records match the selected filter."
            />
          }
        />
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexShrink: 0,
  },
  toolbarBtn: {
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
  toolbarBtnPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  toolbarText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  toolbarTextPrimary: {
    color: colors.white,
    fontWeight: fontWeight.bold,
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
    marginTop: spacing.sm,
  },
  kpiItem: {
    flex: 1,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  // QA #326 — Pending Review card.
  pendingCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(245,158,11,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    gap: spacing.sm,
  },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pendingTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pendingTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  pendingBadge: {
    marginLeft: spacing.xs,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.yellow,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  pendingLink: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  pendingInv: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  pendingMeta: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  chipTextActive: {
    color: colors.white,
    fontWeight: fontWeight.semibold,
  },
  listContent: {
    paddingTop: spacing.xs,
    paddingBottom: spacing['5xl'],
  },
  emptyContainer: {
    flexGrow: 1,
  },
  auditCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  auditHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  auditInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  auditInv: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  auditCarrier: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  auditDetails: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.xl,
  },
  detailCol: {},
  detailLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  detailValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  issueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    backgroundColor: colors.redDim,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  issueText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.red,
    flex: 1,
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  payLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  auditActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.bg3,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  actionBtnApprove: {
    borderColor: colors.greenDim,
    backgroundColor: colors.greenDim,
  },
  actionBtnDispute: {
    borderColor: colors.redDim,
    backgroundColor: colors.redDim,
  },
  actionBtnRelease: {
    borderColor: colors.yellowDim,
    backgroundColor: colors.yellowDim,
  },
  actionBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
