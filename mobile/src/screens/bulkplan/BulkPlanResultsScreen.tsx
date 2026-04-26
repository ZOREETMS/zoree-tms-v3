import React, { useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import PlanResultCard from '../../components/bulkplan/PlanResultCard';
import FailedOrderCard from '../../components/bulkplan/FailedOrderCard';
import KpiCard from '../../components/ui/KpiCard';
import { useData } from '../../state/DataContext';
import { FAILURE_CODES } from '../../types/planningFailure';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

type ResultsRoute = RouteProp<{ BulkPlanResults: { results: any } }, 'BulkPlanResults'>;

export default function BulkPlanResultsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<ResultsRoute>();
  const { data } = useData();
  const results = route.params?.results || {};

  const shipments = results.shipments || [];
  const ordersUpdated = results.ordersUpdated || 0;
  const totalCost = shipments.reduce((s: number, sh: any) => s + (sh.total_cost || 0), 0);

  // Prefer the new structured failure list when present; fall back to
  // the legacy `failed: string[]` shape so older results still render.
  const failures: Array<{ orderId: string; code: string; details: string }> = useMemo(() => {
    if (Array.isArray(results.failures) && results.failures.length > 0) {
      return results.failures;
    }
    if (Array.isArray(results.failed) && results.failed.length > 0) {
      return results.failed.map((id: string) => ({
        orderId: id,
        code: FAILURE_CODES.NO_CARRIER_QUOTE,
        details: '',
      }));
    }
    return [];
  }, [results.failures, results.failed]);

  // Index orders by id so each FailedOrderCard can show customer / lane.
  const orderById = useMemo(() => {
    const map: Record<string, any> = {};
    for (const o of data.orders || []) {
      const id = o.id ?? o.order_id;
      if (id) map[String(id)] = o;
    }
    return map;
  }, [data.orders]);

  const failedCount = failures.length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Plan Results</Text>
      </View>

      {/* Success Banner */}
      <View style={styles.successBanner}>
        <Ionicons name="checkmark-circle" size={28} color={colors.green} />
        <View style={styles.successContent}>
          <Text style={styles.successTitle}>Planning Complete</Text>
          <Text style={styles.successSub}>
            {shipments.length} shipment{shipments.length !== 1 ? 's' : ''} created
          </Text>
        </View>
      </View>

      {/* KPIs */}
      <View style={styles.kpiRow}>
        <KpiCard label="Shipments" value={String(shipments.length)} icon="cube-outline" color={colors.accent} />
        <KpiCard label="Orders" value={String(ordersUpdated)} icon="receipt-outline" color={colors.green} />
        <KpiCard
          label="Total Cost"
          value={`$${totalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
          icon="cash-outline"
          color={colors.purple}
        />
      </View>

      {failedCount > 0 && (
        <View style={styles.warnBanner}>
          <Ionicons name="warning-outline" size={16} color={colors.yellow} />
          <Text style={styles.warnText}>
            {failedCount} order{failedCount !== 1 ? 's' : ''} could not be planned — see reasons below
          </Text>
        </View>
      )}

      {/* Shipments + failures together so the user can scroll the
          whole results page (a single FlatList can't span two lists). */}
      <ScrollView contentContainerStyle={styles.listContent}>
        <Text style={styles.sectionTitle}>Created Shipments</Text>
        {shipments.length === 0 ? (
          <Text style={styles.emptyText}>No shipments created</Text>
        ) : (
          shipments.map((item: any) => (
            <PlanResultCard key={String(item.id)} shipment={item} />
          ))
        )}

        {failedCount > 0 ? (
          <>
            <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
              Could Not Plan ({failedCount})
            </Text>
            {failures.map((f) => (
              <FailedOrderCard
                key={f.orderId}
                failure={f as any}
                order={orderById[f.orderId]}
              />
            ))}
          </>
        ) : null}
      </ScrollView>

      {/* Done Button */}
      <TouchableOpacity
        style={styles.doneBtn}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('Orders')}
      >
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { marginRight: spacing.md, padding: spacing.xs },
  headerTitle: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  successBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    margin: spacing.lg, padding: spacing.lg,
    backgroundColor: 'rgba(5,150,105,0.08)', borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: 'rgba(5,150,105,0.2)',
  },
  successContent: { flex: 1 },
  successTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.green },
  successSub: { fontSize: fontSize.sm, color: colors.text2, marginTop: 2 },
  kpiRow: {
    flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.md,
  },
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    padding: spacing.md, backgroundColor: 'rgba(217,119,6,0.08)', borderRadius: borderRadius.md,
  },
  warnText: { fontSize: fontSize.sm, color: colors.yellow, flex: 1 },
  sectionTitle: {
    fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text2,
    paddingHorizontal: spacing.lg, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  sectionTitleSpaced: {
    marginTop: spacing.lg,
  },
  listContent: { paddingBottom: 100 },
  emptyText: { fontSize: fontSize.md, color: colors.text3, textAlign: 'center', marginTop: spacing.xl },
  doneBtn: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing['3xl'],
    backgroundColor: colors.accent, paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg, alignItems: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
  doneBtnText: { color: colors.white, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
});
