import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Alert,
  TextInput,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import useBulkPlan from '../../shared/hooks/useBulkPlan';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import KpiCard from '../../components/ui/KpiCard';
import SelectableOrderCard from '../../components/bulkplan/SelectableOrderCard';
import OrderEditModal from '../../components/bulkplan/OrderEditModal';
import { classifyLoadType } from '../../shared/utils/laneUtils';
import { useData } from '../../state/DataContext';
import type { BulkPlanTabParamList } from '../../navigation/types';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export default function BulkPlanScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<BulkPlanTabParamList, 'BulkPlan'>>();
  const { refreshData } = useData();
  const {
    unplannedOrders, selectedIds, selectionSummary, lanes,
    busy, progress, results, error,
    toggleSelect, selectAll, executePlan, reset,
  } = useBulkPlan();

  const [search, setSearch] = useState('');
  // QA 244 (2026-05-12): web BulkPlan exposes a Customer dropdown so
  // a planner can scope the unplanned list to one shipper at a time.
  // Empty string == "All customers".
  const [customerFilter, setCustomerFilter] = useState('');
  const [editingOrder, setEditingOrder] = useState<any | null>(null);
  // Bug #162 / #168: optional dock/loading + preferred-carrier defaults
  // applied to every plan produced by this run. Empty values are not
  // sent — per-plan/per-lane values produced by planAllLanes survive
  // untouched. The carrier override partially addresses #168 ("only one
  // carrier is shown") by letting the planner force a specific carrier
  // on every lane in this run; a full per-lane multi-quote review
  // screen (web parity: PlanRateReview) is tracked separately.
  const [planOptionsOpen, setPlanOptionsOpen] = useState(false);
  const [dockDoor, setDockDoor] = useState('');
  const [dockTime, setDockTime] = useState('');
  const [loadingStart, setLoadingStart] = useState('');
  const [loadingEnd, setLoadingEnd] = useState('');
  const [preferredCarrier, setPreferredCarrier] = useState('');
  const planningDefaults = useMemo(
    () => ({
      dockDoor:         dockDoor.trim() || null,
      dockTime:         dockTime.trim() || null,
      loadingStart:     loadingStart.trim() || null,
      loadingEnd:       loadingEnd.trim() || null,
      preferredCarrier: preferredCarrier.trim() || null,
    }),
    [dockDoor, dockTime, loadingStart, loadingEnd, preferredCarrier],
  );

  /**
   * Pre-select orders handed off from OrdersScreen's "Plan Selected"
   * action. We feed them through `selectAll` so the lane preview /
   * KPI cards are populated immediately. The route param is cleared
   * after consumption so re-renders don't re-trigger.
   */
  const initialSelectedIds = route.params?.initialSelectedIds;
  React.useEffect(() => {
    if (!initialSelectedIds || initialSelectedIds.length === 0) return;
    if (!Array.isArray(unplannedOrders) || unplannedOrders.length === 0) return;
    const matchedSet = new Set(initialSelectedIds);
    const matched = unplannedOrders.filter((o: any) => matchedSet.has(String(o.id)));
    if (matched.length > 0) selectAll(matched);
    navigation.setParams({ initialSelectedIds: undefined } as any);
  }, [initialSelectedIds, unplannedOrders, selectAll, navigation]);

  React.useEffect(() => {
    if (results) {
      navigation.navigate('BulkPlanResults', { results });
      reset();
    }
  }, [results, navigation, reset]);

  // QA 244 (2026-05-12): unique customer list derived from the
  // currently-loaded unplanned orders. Sorted alphabetically so the
  // dropdown order stays stable as data refreshes.
  const customerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of unplannedOrders) {
      const c = (o as any).customer || (o as any).customer_name;
      if (c) set.add(String(c));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [unplannedOrders]);

  const filteredOrders = useMemo(() => {
    let list = unplannedOrders;
    if (customerFilter) {
      list = list.filter(
        (o: any) =>
          (o.customer || o.customer_name || '').toString() === customerFilter,
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((o: any) =>
        (o.id || '').toLowerCase().includes(q) ||
        (o.customer || '').toLowerCase().includes(q) ||
        (o.origin || '').toLowerCase().includes(q) ||
        (o.destination || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [unplannedOrders, search, customerFilter]);

  const allSelected = filteredOrders.length > 0 && filteredOrders.every((o: any) => selectedIds.has(o.id));

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <SelectableOrderCard
        order={item}
        selected={selectedIds.has(item.id)}
        onToggle={toggleSelect}
        onEdit={setEditingOrder}
      />
    ),
    [selectedIds, toggleSelect],
  );

  const keyExtractor = useCallback((item: any) => String(item.id), []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Bulk Plan</Text>
        <Text style={styles.subtitle}>{unplannedOrders.length} unplanned orders</Text>
      </View>

      <View style={styles.kpiRow}>
        <KpiCard label="Selected" value={String(selectionSummary.count)} icon="checkbox-outline" color={colors.accent} />
        <KpiCard label="Weight" value={`${(selectionSummary.weight / 1000).toFixed(1)}K`} icon="scale-outline" color={colors.cyan} />
        <KpiCard label="Lanes" value={String(lanes.length)} icon="git-merge-outline" color={colors.purple} />
      </View>

      {lanes.length > 0 && (
        <View style={styles.lanesSummary}>
          {lanes.slice(0, 3).map((lane) => (
            <View key={lane.laneKey} style={styles.laneChip}>
              <Text style={styles.laneChipText} numberOfLines={1}>
                {lane.orderIds.length} orders - {classifyLoadType(lane.totalWeight)}
              </Text>
            </View>
          ))}
          {lanes.length > 3 && (
            <Text style={styles.moreLanes}>+{lanes.length - 3} more</Text>
          )}
        </View>
      )}

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

      {/* QA 244 (2026-05-12): Customer dropdown — scopes the unplanned
          list to one customer. Implemented as a horizontal chip row to
          stay consistent with the Shipments status filter on this app;
          a native Picker would have shipped fewer lines but rendered
          inconsistently across iOS / Android. */}
      {customerOptions.length > 0 && (
        <View style={styles.customerFilterRow}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setCustomerFilter('')}
            style={[
              styles.customerChip,
              customerFilter === '' && styles.customerChipActive,
            ]}
          >
            <Text
              style={[
                styles.customerChipLabel,
                customerFilter === '' && styles.customerChipLabelActive,
              ]}
            >
              All Customers
            </Text>
          </TouchableOpacity>
          {customerOptions.map((c) => (
            <TouchableOpacity
              key={c}
              activeOpacity={0.7}
              onPress={() => setCustomerFilter(c)}
              style={[
                styles.customerChip,
                customerFilter === c && styles.customerChipActive,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.customerChipLabel,
                  customerFilter === c && styles.customerChipLabelActive,
                ]}
              >
                {c}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={16} color={colors.red} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={filteredOrders}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={filteredOrders.length === 0 ? styles.emptyContainer : styles.listContent}
        ListEmptyComponent={
          <EmptyState icon="cube-outline" title="No unplanned orders" subtitle="All orders have been planned." />
        }
      />

      {/* Bug #162: collapsible Dock & Loading defaults so the planner
          can stamp Dock Door / Dock Time / Loading Start / Loading End
          on every shipment produced by this run. Web parity:
          PlanConfirmationModal.jsx. The values flow through useBulkPlan
          → /bulk-plan/execute, which already accepts them per plan. */}
      {selectionSummary.count > 0 && (
        <View style={styles.planOptionsCard}>
          <TouchableOpacity
            style={styles.planOptionsHeader}
            onPress={() => setPlanOptionsOpen((v) => !v)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={planOptionsOpen ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color={colors.text2}
            />
            <Text style={styles.planOptionsHeaderText}>
              Dock & Loading (optional)
            </Text>
          </TouchableOpacity>
          {planOptionsOpen && (
            <View style={styles.planOptionsBody}>
              <View style={styles.planOptionsRow}>
                <View style={styles.planOptionsField}>
                  <Text style={styles.planOptionsLabel}>DOCK DOOR</Text>
                  <TextInput
                    style={styles.planOptionsInput}
                    value={dockDoor}
                    onChangeText={setDockDoor}
                    placeholder="e.g. D7"
                    placeholderTextColor={colors.text3}
                  />
                </View>
                <View style={styles.planOptionsField}>
                  <Text style={styles.planOptionsLabel}>DOCK TIME</Text>
                  <TextInput
                    style={styles.planOptionsInput}
                    value={dockTime}
                    onChangeText={setDockTime}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.text3}
                  />
                </View>
              </View>
              <View style={styles.planOptionsRow}>
                <View style={styles.planOptionsField}>
                  <Text style={styles.planOptionsLabel}>LOADING START</Text>
                  <TextInput
                    style={styles.planOptionsInput}
                    value={loadingStart}
                    onChangeText={setLoadingStart}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.text3}
                  />
                </View>
                <View style={styles.planOptionsField}>
                  <Text style={styles.planOptionsLabel}>LOADING END</Text>
                  <TextInput
                    style={styles.planOptionsInput}
                    value={loadingEnd}
                    onChangeText={setLoadingEnd}
                    placeholder="HH:MM"
                    placeholderTextColor={colors.text3}
                  />
                </View>
              </View>
              {/* Bug #168: preferred-carrier override. When set, the
                  planner ignores the auto-picked bestQuote and forces
                  this carrier on every plan in the run. */}
              <View style={styles.planOptionsField}>
                <Text style={styles.planOptionsLabel}>PREFERRED CARRIER (OVERRIDE)</Text>
                <TextInput
                  style={styles.planOptionsInput}
                  value={preferredCarrier}
                  onChangeText={setPreferredCarrier}
                  placeholder="Leave blank to use the cheapest quote"
                  placeholderTextColor={colors.text3}
                  autoCapitalize="words"
                />
              </View>
            </View>
          )}
        </View>
      )}

      {/* QA bug #53 fix: Plan & Create Shipments button now confirms
          before firing executePlan, mirroring web's BulkPlanPage label. */}
      {selectionSummary.count > 0 && (
        <TouchableOpacity
          style={styles.planBtn}
          activeOpacity={0.8}
          disabled={busy}
          onPress={() => {
            const orderWord = selectionSummary.count === 1 ? 'order' : 'orders';
            const laneWord = lanes.length === 1 ? 'lane' : 'lanes';
            Alert.alert(
              'Plan & Create Shipments',
              `This will rate ${selectionSummary.count} ${orderWord} across ${lanes.length} ${laneWord} and create the resulting shipments. Continue?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Plan & Create',
                  onPress: () => executePlan('cost', planningDefaults),
                },
              ],
            );
          }}
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
                Plan & Create Shipments ({selectionSummary.count})
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      <OrderEditModal
        visible={!!editingOrder}
        order={editingOrder}
        onClose={() => setEditingOrder(null)}
        onSaved={async () => {
          await refreshData();
        }}
      />
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
  // QA 244 (2026-05-12): Customer filter chips. Horizontal row of
  // selectable chips, one per unique customer; the active chip uses
  // the accent fill to mirror the status filter on ShipmentsScreen.
  customerFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  customerChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    maxWidth: 180,
  },
  customerChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  customerChipLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  customerChipLabelActive: {
    color: colors.white,
  },
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
  // Bug #162: collapsible Dock & Loading defaults card.
  planOptionsCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planOptionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  planOptionsHeaderText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  planOptionsBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  planOptionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  planOptionsField: {
    flex: 1,
  },
  planOptionsLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  planOptionsInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.bg,
  },
});
