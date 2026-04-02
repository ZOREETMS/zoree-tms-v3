import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
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
          (o.customer_name || '').toLowerCase().includes(q) ||
          (o.origin_city || o.origin || '').toLowerCase().includes(q) ||
          (o.destination_city || o.destination || '').toLowerCase().includes(q),
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
        statuses={ORDER_STATUSES}
        active={activeStatus}
        onSelect={setActiveStatus}
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
