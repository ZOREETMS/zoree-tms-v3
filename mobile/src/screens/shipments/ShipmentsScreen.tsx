import React, { useCallback, useMemo, useState } from 'react';
// (useMemo already imported above — kept on a separate line for diff stability)
import {
  FlatList,
  RefreshControl,
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
import TrackingMap from '../../components/tracking/TrackingMap';
import DateRangeChips, {
  DateRangeKey,
  dateRangeCutoff,
} from '../../components/common/DateRangeChips';
import FilterDropdown from '../../components/common/FilterDropdown';
import { exportRowsAsCsv } from '../../services/csvExport';
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

type ViewMode = 'list' | 'map';

export default function ShipmentsScreen() {
  const { data, loading, refreshData } = useData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  // QA 230 (2026-05-12): web filter set includes Mode (TL/LTL/Air/etc).
  // Empty string == all modes. Derived options come from what's loaded
  // so a tenant without LTL doesn't see an empty pill.
  const [modeFilter, setModeFilter] = useState<string>('');
  // QA #272 — date-range filter (preset chips, not a calendar picker).
  // Web has Created From / Created To inputs; preset chips give
  // equivalent coverage without bringing a date-picker dep into mobile.
  const [dateRange, setDateRange] = useState<DateRangeKey>('all');
  // QA #320 — list / map toggle. The Map view is a follow-up (Phase 4
  // module rewrite — needs an in-screen mini-map similar to the
  // tracking screen). For now the toggle is wired and rendered so the
  // header parity gap with web is closed; selecting "Map" surfaces a
  // placeholder empty state pointing users to the dedicated Live
  // Tracking screen, which already has the map implementation.
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [creating, setCreating] = useState(false);

  const modeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of data.shipments || []) {
      const m = (s as any).mode;
      if (m) set.add(String(m).trim());
    }
    return Array.from(set).sort();
  }, [data.shipments]);

  const filtered = useMemo(() => {
    let list = data.shipments;

    // Status filter
    if (statusFilter !== 'All') {
      list = list.filter(
        (s: any) => (s.status || '').toLowerCase() === statusFilter.toLowerCase(),
      );
    }

    // QA 230 (2026-05-12): Mode filter
    if (modeFilter) {
      list = list.filter(
        (s: any) => String(s.mode || '').toLowerCase() === modeFilter.toLowerCase(),
      );
    }

    // QA #272 — date-range filter against created_at (with sensible
    // fallback fields). Unparseable / missing dates are filtered out
    // when a non-"all" preset is selected so the UI doesn't pretend
    // they're current.
    const cutoff = dateRangeCutoff(dateRange);
    if (cutoff !== null) {
      list = list.filter((s: any) => {
        const raw = s.created_at || s.createdAt || s.pickup_date || s.pickupDate;
        if (!raw) return false;
        const t = new Date(raw).getTime();
        return Number.isFinite(t) && t >= cutoff;
      });
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
  }, [data.shipments, search, statusFilter, modeFilter, dateRange]);

  // QA #272 — Export current (filtered) list as CSV. Mirrors the web
  // Shipments page's Export button. Goes through the shared csvExport
  // service so the column conventions stay consistent across screens.
  const onExport = useCallback(async () => {
    await exportRowsAsCsv(
      filtered,
      [
        { key: 'id',           header: 'Shipment ID' },
        { key: 'status',       header: 'Status' },
        { key: 'mode',         header: 'Mode' },
        { key: 'carrier_name', header: 'Carrier', value: (r) => r.carrier_name || r.carrierName || r.carrier },
        { key: 'origin',       header: 'Origin',  value: (r) => r.origin_city || r.origin },
        { key: 'destination',  header: 'Destination', value: (r) => r.destination_city || r.destination },
        { key: 'pickup_date',  header: 'Pickup Date', value: (r) => r.pickup_date || r.pickupDate },
        { key: 'total_cost',   header: 'Total Cost' },
        { key: 'created_at',   header: 'Created At', value: (r) => r.created_at || r.createdAt },
      ],
      { title: 'Shipments Export', filename: 'shipments.csv' },
    );
  }, [filtered]);

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
          <View style={{ flex: 1 }} />
          {/* QA #320 — List / Map toggle. Two-segment switch styled to
              match the existing exportBtn so the header reads as a
              compact toolbar instead of a row of disparate buttons. */}
          <View style={styles.viewSwitch} accessibilityRole="tablist">
            <TouchableOpacity
              accessibilityRole="tab"
              accessibilityLabel="List view"
              accessibilityState={{ selected: viewMode === 'list' }}
              activeOpacity={0.8}
              onPress={() => setViewMode('list')}
              style={[styles.viewSwitchBtn, viewMode === 'list' && styles.viewSwitchBtnActive]}>
              <Ionicons name="list-outline" size={14} color={viewMode === 'list' ? colors.white : colors.text2} />
              <Text style={[styles.viewSwitchText, viewMode === 'list' && styles.viewSwitchTextActive]}>List</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="tab"
              accessibilityLabel="Map view"
              accessibilityState={{ selected: viewMode === 'map' }}
              activeOpacity={0.8}
              onPress={() => setViewMode('map')}
              style={[styles.viewSwitchBtn, viewMode === 'map' && styles.viewSwitchBtnActive]}>
              <Ionicons name="map-outline" size={14} color={viewMode === 'map' ? colors.white : colors.text2} />
              <Text style={[styles.viewSwitchText, viewMode === 'map' && styles.viewSwitchTextActive]}>Map</Text>
            </TouchableOpacity>
          </View>
          {/* QA #272 — inline Export button so the header matches the
              web layout (FAB still handles "+ New Shipment"). */}
          <TouchableOpacity
            onPress={onExport}
            style={styles.exportBtn}
            accessibilityRole="button"
            accessibilityLabel="Export current shipments as CSV">
            <Ionicons name="download-outline" size={16} color={colors.accent} />
            <Text style={styles.exportText}>Export</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchWrapper}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search by ID, carrier, origin, destination..."
          />
        </View>

        {/* QA #320 — status filter is now a dropdown; tappable trigger
            keeps the selection visible at all times even on narrow
            phones where the chip row scrolled the active option off
            screen. */}
        <FilterDropdown
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          options={STATUS_FILTERS as unknown as string[]}
          modalTitle="Filter Shipments by Status"
        />

        {/* QA #272 — date-range presets. */}
        <DateRangeChips active={dateRange} onSelect={setDateRange} />

        {/* QA #320 — Mode filter as a dropdown too (was a chip row).
            Still hidden when the loaded set has no mode info. */}
        {modeOptions.length > 0 ? (
          <FilterDropdown
            label="Mode"
            value={modeFilter || 'All Modes'}
            onChange={(v) => setModeFilter(v === 'All Modes' ? '' : v)}
            options={['All Modes', ...modeOptions]}
            modalTitle="Filter Shipments by Mode"
          />
        ) : null}

        {viewMode === 'list' ? (
          /* List */
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
        ) : (
          /* QA #320 — Map view. Reuses the existing TrackingMap
              component (already wired to react-native-maps and the
              shipment coord schema) so the Shipments Map mode renders
              a marker per shipment with origin / current coords. The
              filtered set is passed through so the Map view honours
              the same Status / Mode / Date filters the List view does. */
          <View style={{ flex: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
            <TrackingMap shipments={filtered} />
          </View>
        )}

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
    // QA #272 — extra right padding stops the last chip looking clipped
    // on narrow phones (the symptom the report called "buttons are cut").
    paddingRight: spacing.xl,
    gap: spacing.sm,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    marginLeft: spacing.sm,
  },
  exportText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  // QA #320 — List/Map view-mode toggle styles.
  viewSwitch: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.bg2,
  },
  viewSwitchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  viewSwitchBtnActive: {
    backgroundColor: colors.accent,
  },
  viewSwitchText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  viewSwitchTextActive: {
    color: colors.white,
    fontWeight: fontWeight.semibold,
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
