import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import ShipmentCard from '../../components/shipments/ShipmentCard';
import NewShipmentModal from '../../components/shipments/NewShipmentModal';
import { useData } from '../../state/DataContext';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

const STATUS_FILTERS = [
  'All',
  'Planned',
  'Tendered',
  'In Transit',
  'Picked Up',
  'Delivered',
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function ShipmentsScreen() {
  const { data, loading, refreshData } = useData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let list = data.shipments;

    // Status filter
    if (statusFilter !== 'All') {
      list = list.filter(
        (s: any) => (s.status || '').toLowerCase() === statusFilter.toLowerCase(),
      );
    }

    // Search filter
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((s: any) => {
        const id = String(
          s.id || s.shipment_id || s.shipmentId || '',
        ).toLowerCase();
        const carrier = String(
          s.carrier_name || s.carrierName || s.carrier || '',
        ).toLowerCase();
        const origin = String(
          s.origin_city || s.origin || s.originCity || '',
        ).toLowerCase();
        const dest = String(
          s.destination_city || s.destination || s.destinationCity || '',
        ).toLowerCase();
        return (
          id.includes(q) ||
          carrier.includes(q) ||
          origin.includes(q) ||
          dest.includes(q)
        );
      });
    }

    return list;
  }, [data.shipments, search, statusFilter]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => <ShipmentCard shipment={item} />,
    [],
  );

  const keyExtractor = useCallback(
    (item: any) =>
      String(item.id || item.shipment_id || item.shipmentId || Math.random()),
    [],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Shipments</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{filtered.length}</Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchWrapper}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search by ID, carrier, origin, destination..."
          />
        </View>

        {/* Status filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}>
          {STATUS_FILTERS.map(s => (
            <TouchableOpacity
              key={s}
              activeOpacity={0.7}
              onPress={() => setStatusFilter(s)}
              style={[
                styles.chip,
                statusFilter === s && styles.chipActive,
              ]}>
              <Text
                style={[
                  styles.chipLabel,
                  statusFilter === s && styles.chipLabelActive,
                ]}>
                {s}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* List */}
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refreshData}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="cube-outline"
              title="No shipments found"
              subtitle={
                search || statusFilter !== 'All'
                  ? 'Try adjusting your search or filters.'
                  : 'Shipments will appear here once created.'
              }
            />
          }
        />

        {/* New-shipment FAB — mirrors OrdersScreen / RateManagementScreen. */}
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
          onPress={() => setCreating(true)}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </TouchableOpacity>

        <NewShipmentModal
          visible={creating}
          onClose={() => setCreating(false)}
          carriers={data.carriers as any}
          equipmentTypes={(data as any).equipmentTypes}
          onCreated={async () => {
            await refreshData();
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
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
  countBadge: {
    backgroundColor: colors.accentGlow,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginLeft: spacing.sm,
  },
  countText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  searchWrapper: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chipScroll: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  chipRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  chipLabelActive: {
    color: colors.white,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing['5xl'],
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
