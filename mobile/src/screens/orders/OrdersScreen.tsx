import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Alert,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import StatusFilter from '../../components/common/StatusFilter';
import OrderCard from '../../components/orders/OrderCard';
import OrderSelectionBar from '../../components/orders/OrderSelectionBar';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const ORDER_STATUSES = [
  'All',
  'Unplanned',
  'Planned',
  'Consolidated',
  'Tendered',
  'Delivered',
  'Cancelled',
];

export default function OrdersScreen() {
  const navigation = useNavigation<any>();
  const { data, loading, refreshData } = useData();

  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState('All');
  /**
   * Selection state. `selectionMode` flips on when the user
   * long-presses any card, and stays on until they tap Clear or
   * complete an action. Selected IDs survive across re-renders so the
   * realtime data refresh doesn't drop the user's picks.
   */
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * Selection helpers. Long-press flips selectionMode on and selects
   * the long-pressed order; subsequent taps add/remove. Tapping in
   * normal mode still navigates to detail.
   */
  const enterSelectionWith = useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Auto-exit selection mode when the user empties their picks.
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  /** Count orders per status for filter badges */
  const statusCounts = useMemo(() => {
    // `All` is the true table total from /api/orders/count, not
    // `data.orders.length` (which tops out at the 500-row page
    // DbApi.orders returns). Per-status entries below remain derived
    // from the loaded page — promoting those would need per-status
    // count endpoints and isn't part of this fix. Falls back to the
    // loaded length for the brief pre-fetch window.
    const counts: Record<string, number> = {
      All: data.ordersTotal || data.orders.length,
    };
    data.orders.forEach((o) => {
      const s = o.status || 'Unplanned';
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [data.orders, data.ordersTotal]);

  const filteredOrders = useMemo(() => {
    let orders = data.orders;

    if (activeStatus !== 'All') {
      orders = orders.filter((o) => o.status === activeStatus);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      orders = orders.filter(
        (o) =>
          (o.order_id || o.id || '').toString().toLowerCase().includes(q) ||
          (o.customer || o.customer_name || '').toLowerCase().includes(q) ||
          (o.origin || o.origin_city || '').toLowerCase().includes(q) ||
          (o.destination || o.destination_city || '').toLowerCase().includes(q),
      );
    }

    return orders;
  }, [data.orders, activeStatus, search]);

  const handleRefresh = useCallback(() => {
    refreshData();
  }, [refreshData]);

  /* ── Selection summary + actions ─────────────────────────────────── */
  const selectedOrders = useMemo(
    () => data.orders.filter((o: any) => selectedIds.has(String(o.id))),
    [data.orders, selectedIds],
  );

  const selectionSummary = useMemo(() => {
    const totalWeight = selectedOrders.reduce(
      (s: number, o: any) => s + (Number(o.weight) || 0),
      0,
    );
    const unplannedCount = selectedOrders.filter(
      (o: any) => (o.status || '').toLowerCase() === 'unplanned',
    ).length;
    return {
      count: selectedOrders.length,
      totalWeight,
      unplannedCount,
    };
  }, [selectedOrders]);

  /**
   * "Plan Selected" hands off to the BulkPlanScreen with the user's
   * picks pre-loaded. We avoid duplicating the rate / consolidate /
   * execute pipeline here — the BulkPlanScreen already owns it via
   * useBulkPlan, and surfacing it gives the user a chance to review
   * the lane grouping before committing. Cross-stack navigation works
   * because BulkPlan is registered on the BulkPlanTab drawer entry.
   */
  const handlePlanSelected = useCallback(() => {
    if (selectionSummary.unplannedCount === 0) {
      Alert.alert(
        'Nothing to plan',
        'Select at least one Unplanned order to plan.',
      );
      return;
    }
    const ids = selectedOrders
      .filter((o: any) => (o.status || '').toLowerCase() === 'unplanned')
      .map((o: any) => String(o.id));
    navigation.navigate('BulkPlanTab', {
      screen: 'BulkPlan',
      params: { initialSelectedIds: ids },
    });
    clearSelection();
  }, [selectedOrders, selectionSummary.unplannedCount, navigation, clearSelection]);

  /**
   * "Create Multi-Stop Route" hands off to MultiStopRoutesScreen with
   * the selected order IDs. That screen decides whether to open the
   * Execute sheet (existing template matches) or the RouteFormModal
   * with a draft pre-built from those orders. Mirrors the web
   * `?orderIds=` deep-link.
   */
  const handleCreateMultiStop = useCallback(() => {
    if (selectionSummary.unplannedCount < 2) {
      Alert.alert(
        'Need 2+ Unplanned orders',
        'Multi-stop routes need at least two unplanned orders with different destinations.',
      );
      return;
    }
    const ids = selectedOrders
      .filter((o: any) => (o.status || '').toLowerCase() === 'unplanned')
      .map((o: any) => String(o.id));
    navigation.navigate('MultiStopTab', {
      screen: 'MultiStopRoutes',
      params: { selectedOrderIds: ids },
    });
    clearSelection();
  }, [selectedOrders, selectionSummary.unplannedCount, navigation, clearSelection]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const id = String(item.id ?? item.order_id ?? '');
      return (
        <OrderCard
          order={item}
          selectionMode={selectionMode}
          selected={selectedIds.has(id)}
          onToggleSelect={toggleSelected}
          onLongPressSelect={enterSelectionWith}
        />
      );
    },
    [selectionMode, selectedIds, toggleSelected, enterSelectionWith],
  );

  const keyExtractor = useCallback(
    (item: any) => (item.id ?? item.order_id ?? '').toString(),
    [],
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Orders</Text>
          <Text style={styles.count}>
            {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
          </Text>
        </View>
      </View>

      {/* Quick Nav. Bulk Plan / Multi-Stop are also reachable from the
          drawer (top-level entries) and from the long-press selection
          bar — the buttons here are kept as a redundant shortcut for
          users who prefer in-screen navigation. */}
      <View style={styles.quickNav}>
        <TouchableOpacity style={styles.quickNavBtn} onPress={() => navigation.navigate('Shipments')}>
          <Ionicons name="airplane-outline" size={16} color="#FFFFFF" />
          <Text style={styles.quickNavText}>Shipments</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickNavBtn}
          onPress={() => navigation.navigate('BulkPlanTab', { screen: 'BulkPlan' })}
        >
          <Ionicons name="rocket-outline" size={16} color="#FFFFFF" />
          <Text style={styles.quickNavText}>Bulk Plan</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickNavBtn}
          onPress={() => navigation.navigate('MultiStopTab', { screen: 'MultiStopRoutes' })}
        >
          <Ionicons name="git-branch-outline" size={16} color="#FFFFFF" />
          <Text style={styles.quickNavText}>Multi-Stop</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickNavBtn} onPress={() => navigation.navigate('ItemMaster')}>
          <Ionicons name="cube-outline" size={16} color="#FFFFFF" />
          <Text style={styles.quickNavText}>Items</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search orders..."
        />
      </View>

      {/* Status Filter */}
      <StatusFilter
        label="Filter by Status"
        statuses={ORDER_STATUSES}
        active={activeStatus}
        onSelect={setActiveStatus}
        counts={statusCounts}
      />

      {/* Order List */}
      <FlatList
        data={filteredOrders}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={`${selectionMode}-${selectedIds.size}`}
        contentContainerStyle={
          filteredOrders.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title="No orders found"
            subtitle={
              search || activeStatus !== 'All'
                ? 'Try adjusting your search or filter criteria.'
                : 'Orders will appear here once created.'
            }
          />
        }
      />

      {/* FAB — hidden during selection mode so it doesn't fight with
          the SelectionBar for the same screen corner. */}
      {!selectionMode && (
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('OrderDetail', { orderId: 'new' })}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </TouchableOpacity>
      )}

      {selectionMode && selectionSummary.count > 0 && (
        <OrderSelectionBar
          count={selectionSummary.count}
          totalWeight={selectionSummary.totalWeight}
          unplannedCount={selectionSummary.unplannedCount}
          onClear={clearSelection}
          onPlanSelected={handlePlanSelected}
          onCreateMultiStop={handleCreateMultiStop}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  count: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  quickNav: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 8,
  },
  quickNavBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2563EB',
  },
  quickNavText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing['5xl'],
  },
  emptyContainer: {
    flexGrow: 1,
  },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing['3xl'],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
