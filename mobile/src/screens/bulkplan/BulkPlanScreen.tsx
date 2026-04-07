import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import useBulkPlan from '../../shared/hooks/useBulkPlan';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import KpiCard from '../../components/ui/KpiCard';
import SelectableOrderCard from '../../components/bulkplan/SelectableOrderCard';
import { classifyLoadType } from '../../shared/utils/laneUtils';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export default function BulkPlanScreen() {
  const navigation = useNavigation<any>();
  const {
    unplannedOrders, selectedIds, selectionSummary, lanes,
    busy, progress, results, error,
    toggleSelect, selectAll, executePlan, reset,
  } = useBulkPlan();

  const [search, setSearch] = useState('');

  // Navigate to results when available
  React.useEffect(() => {
    if (results) {
      navigation.navigate('BulkPlanResults', { results });
      reset();
    }
  }, [results, navigation, reset]);

  const filteredOrders = useMemo(() => {
    if (!search.trim()) return unplannedOrders;
    const q = search.toLowerCase();
    return unplannedOrders.filter((o: any) =>
      (o.id || '').toLowerCase().includes(q) ||
      (o.customer || '').toLowerCase().includes(q) ||
      (o.origin || '').toLowerCase().includes(q) ||
      (o.destination || '').toLowerCase().includes(q),
    );
  }, [unplannedOrders, search]);

  const allSelected = filteredOrders.length > 0 && filteredOrders.every((o: any) => selectedIds.has(o.id));

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <SelectableOrderCard order={item} selected={selectedIds.has(item.id)} onToggle={toggleSelect} />
    ),
    [selectedIds, toggleSelect],
  );

  const keyExtractor = useCallback((item: any) => String(item.id), []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Bulk Plan</Text>
        <Text style={styles.subtitle}>{unplannedOrders.length} unplanned orders</Text>
      </View>

      {/* KPIs */}
      <View style={styles.kpiRow}>
        <KpiCard label="Selected" value={String(selectionSummary.count)} icon="checkbox-outline" color={colors.accent} />
        <KpiCard label="Weight" value={`${(selectionSummary.weight / 1000).toFixed(1)}K`} icon="scale-outline" color={colors.cyan} />
        <KpiCard label="Lanes" value={String(lanes.length)} icon="git-merge-outline" color={colors.purple} />
      </View>

      {/* Lane summary when orders selected */}
      {lanes.length > 0 && (
        <View style={styles.lanesSummary}>
          {lanes.slice(0, 3).map((lane) => (
            <View key={lane.laneKey} style={styles.laneChip}>
              <Text style={styles.laneChipText} numberOfLines={1}>
                {lane.orderIds.length} orders • {classifyLoadType(lane.totalWeight)}
              </Text>
            </View>
          ))}
          {lanes.length > 3 && (
            <Text style={styles.moreLanes}>+{lanes.length - 3} more</Text>
          )}
        </View>
      )}

      {/* Search + Select All */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search orders..." />
        </View>
        <TouchableOpacity
          style={[styles.selectAllBtn, allSelected && styles.selectAllActive]}
          onPress={() => selectAll(filteredOrders)}
        >
          <Ionicons
            name={allSelected ? 'checkbox' : 'square-outline'}
            size={20}
            color={allSelected ? colors.accent : colors.text3}
          />
        </TouchableOpacity>
      </View>

      {/* Error */}
      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color={colors.red} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Order List */}
      <FlatList
        data={filteredOrders}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={filteredOrders.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <EmptyState icon="cube-outline" title="No unplanned orders" subtitle="All orders have been planned." />
        }
      />

      {/* Plan Button */}
      {selectionSummary.count > 0 && (
        <TouchableOpacity
          style={styles.planBtn}
          activeOpacity={0.8}
          disabled={busy}
          onPress={() => executePlan('cost')}
        >
          {busy ? (
            <View style={styles.planBtnContent}>
              <ActivityIndicator size="small" color={colors.white} />
              <Text style={styles.planBtnText}>{progress || 'Planning...'}</Text>
            </View>
          ) : (
            <View style={styles.planBtnContent}>
              <Ionicons name="rocket-outline" size={20} color={colors.white} />
              <Text style={styles.planBtnText}>
                Plan {selectionSummary.count} Order{selectionSummary.count !== 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs,
  },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.text2, marginTop: spacing.xs },
  kpiRow: {
    flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm,
    marginTop: spacing.md, marginBottom: spacing.sm,
  },
  lanesSummary: {
    flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg,
    gap: spacing.xs, marginBottom: spacing.sm,
  },
  laneChip: {
    backgroundColor: 'rgba(124,58,237,0.08)', paddingHorizontal: spacing.sm,
    paddingVertical: 3, borderRadius: borderRadius.sm,
  },
  laneChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.purple },
  moreLanes: { fontSize: fontSize.xs, color: colors.text3, alignSelf: 'center' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm, gap: spacing.sm,
  },
  searchWrap: { flex: 1 },
  selectAllBtn: {
    width: 40, height: 40, borderRadius: borderRadius.md,
    backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  selectAllActive: { borderColor: colors.accent, backgroundColor: 'rgba(37,99,235,0.06)' },
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    padding: spacing.md, backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: borderRadius.md,
  },
  errorText: { fontSize: fontSize.sm, color: colors.red, flex: 1 },
  listContent: { paddingTop: spacing.xs, paddingBottom: 120 },
  emptyContainer: { flexGrow: 1 },
  planBtn: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing['3xl'],
    backgroundColor: colors.accent, paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg, shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12, elevation: 8,
  },
  planBtnContent: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  planBtnText: {
    color: colors.white, fontSize: fontSize.lg, fontWeight: fontWeight.bold,
  },
});
