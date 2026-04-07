import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
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

  /** Count orders per status for filter badges */
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { All: data.orders.length };
    data.orders.forEach((o) => {
      const s = o.status || 'Unplanned';
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [data.orders]);

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

  const renderItem = useCallback(
    ({ item }: { item: any }) => <OrderCard order={item} />,
    [],
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

      {/* Quick Nav */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickNav}
      >
        {[
          { label: 'Shipments', icon: 'airplane-outline' as const, screen: 'Shipments' },
          { label: 'Bulk Plan', icon: 'rocket-outline' as const, screen: 'BulkPlan' },
          { label: 'Items', icon: 'cube-outline' as const, screen: 'ItemMaster' },
          { label: 'Locations', icon: 'location-outline' as const, screen: 'LocationMaster' },
        ].map((nav) => (
          <TouchableOpacity
            key={nav.screen}
            style={styles.quickNavBtn}
            activeOpacity={0.7}
            onPress={() => navigation.navigate(nav.screen)}
          >
            <Ionicons name={nav.icon} size={18} color={colors.accent} />
            <Text style={styles.quickNavText}>{nav.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('OrderDetail', { orderId: 'new' })}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  quickNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.bg2,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginRight: spacing.sm,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  quickNavText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
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
