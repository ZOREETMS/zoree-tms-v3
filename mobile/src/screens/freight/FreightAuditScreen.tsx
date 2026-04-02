import React, { useCallback, useEffect } from 'react';
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
    filtered,
    filter,
    setFilter,
    kpis,
    approveInvoice,
    disputeInvoice,
    releaseHold,
    setRecords,
  } = useFreightAudit(SEED_AUDIT_DATA);

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
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Freight Audit</Text>
          <Text style={styles.subtitle}>Invoice verification and payment</Text>
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

        {/* Filter Chips */}
        <View style={styles.filterRow}>
          {AUDIT_FILTERS.map((f) => {
            const isActive = f.key === filter;
            return (
              <TouchableOpacity
                key={f.key || 'all'}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

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
