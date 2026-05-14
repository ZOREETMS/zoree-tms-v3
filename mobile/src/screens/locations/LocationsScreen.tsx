import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import SearchBar from '../../components/ui/SearchBar';
import StatusFilter from '../../components/common/StatusFilter';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import LocationStatsGrid from '../../components/locations/LocationStatsGrid';
import { exportRowsAsCsv } from '../../services/csvExport';
import { LOCATION_TYPES } from '../../shared/constants/locationConstants';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function LocationsScreen() {
  const { data, loading, refreshData } = useData();
  const navigation = useNavigation<any>();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  // QA #271 — web has an "All States" filter so users can narrow by
  // state. Options are derived from the loaded set so we only show
  // states the tenant actually has data for.
  const [stateFilter, setStateFilter] = useState<string>('All');

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { All: data.locations.length };
    data.locations.forEach((l: any) => {
      const t = l.type || 'Other';
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [data.locations]);

  // QA #271 — state-filter options driven by the loaded data so we
  // never advertise filter values that won't return anything.
  const stateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of data.locations || []) {
      const s = String((l as any)?.state || '').trim();
      if (s) set.add(s.toUpperCase());
    }
    return ['All', ...Array.from(set).sort()];
  }, [data.locations]);

  const filtered = useMemo(() => {
    let locs = data.locations;
    if (typeFilter !== 'All') {
      locs = locs.filter((loc: any) => loc.type === typeFilter);
    }
    if (stateFilter !== 'All') {
      locs = locs.filter(
        (loc: any) =>
          String((loc as any)?.state || '').toUpperCase() === stateFilter,
      );
    }
    const q = search.toLowerCase().trim();
    if (!q) return locs;
    return locs.filter((loc: any) => {
      const name = (loc.name ?? '').toLowerCase();
      const address = (loc.address ?? '').toLowerCase();
      const city = (loc.city ?? '').toLowerCase();
      const customer = (loc.customer_name ?? loc.customer ?? '').toLowerCase();
      return (
        name.includes(q) ||
        address.includes(q) ||
        city.includes(q) ||
        customer.includes(q)
      );
    });
  }, [data.locations, search, typeFilter, stateFilter]);

  // QA #271 — Export current (filtered) list as CSV.
  const onExport = useCallback(async () => {
    await exportRowsAsCsv(
      filtered,
      [
        { key: 'id',       header: 'Location ID' },
        { key: 'name',     header: 'Name' },
        { key: 'type',     header: 'Type' },
        { key: 'address',  header: 'Address' },
        { key: 'city',     header: 'City' },
        { key: 'state',    header: 'State' },
        { key: 'zip',      header: 'Zip' },
        { key: 'customer', header: 'Customer', value: (r) => r.customer_name || r.customer },
        { key: 'liftgate', header: 'Liftgate' },
        { key: 'hazmat',   header: 'Hazmat' },
        { key: 'appointment_required', header: 'Appt Required' },
      ],
      { title: 'Locations Export', filename: 'locations.csv' },
    );
  }, [filtered]);

  const handleRefresh = useCallback(() => {
    refreshData();
  }, [refreshData]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => <LocationCard location={item} />,
    [],
  );

  const keyExtractor = useCallback(
    (item: any) => String(item.id ?? Math.random()),
    [],
  );

  return (
    <View style={styles.container}>
      {/* Header — QA #271 page-content parity: title renamed to
          "Location Master" to match the web sidebar label, inline
          Export button mirrors the web page's toolbar. */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Location Master</Text>
          <Text style={styles.count}>{filtered.length} location{filtered.length !== 1 ? 's' : ''}</Text>
        </View>
        <TouchableOpacity
          onPress={onExport}
          style={styles.exportBtn}
          accessibilityRole="button"
          accessibilityLabel="Export current locations as CSV">
          <Ionicons name="download-outline" size={16} color={colors.accent} />
          <Text style={styles.exportText}>Export</Text>
        </TouchableOpacity>
      </View>

      {/* KPI strip — QA #271 page-content parity. */}
      <LocationStatsGrid locations={data.locations} />

      {/* Search */}
      <View style={styles.searchWrapper}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, address, or customer..."
        />
      </View>

      {/* Type Filter */}
      <StatusFilter
        label="Filter by Type"
        statuses={['All', ...LOCATION_TYPES]}
        active={typeFilter}
        onSelect={setTypeFilter}
        counts={typeCounts}
      />

      {/* QA #271 — State filter. Only renders when the loaded data has
          at least one state value (besides the All entry) — no point
          in offering the picker for a tenant with no state column. */}
      {stateOptions.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.stateRow}
          style={styles.stateScroll}>
          {stateOptions.map((s) => {
            const isActive = stateFilter === s;
            return (
              <TouchableOpacity
                key={`state-${s}`}
                activeOpacity={0.7}
                onPress={() => setStateFilter(s)}
                style={[styles.stateChip, isActive && styles.stateChipActive]}>
                <Text
                  style={[
                    styles.stateLabel,
                    isActive && styles.stateLabelActive,
                  ]}>
                  {s === 'All' ? 'All States' : s}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      ) : null}

      {/* List */}
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="location-outline" size={48} color={colors.text3} />
            <Text style={styles.emptyText}>No locations found</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('LocationForm')}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>
    </View>
  );
}

/* ---------- inline LocationCard ---------- */
function LocationCard({ location }: { location: any }) {
  const navigation = useNavigation<any>();

  const address = [location.address, location.city, location.state]
    .filter(Boolean)
    .join(', ');

  const capabilities: string[] = [];
  if (location.liftgate) capabilities.push('Liftgate');
  if (location.hazmat) capabilities.push('Hazmat');
  if (location.appointment_required) capabilities.push('Appt Req');
  if (location.twic) capabilities.push('TWIC');
  if (location.inside_delivery) capabilities.push('Inside Del');

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() =>
        navigation.navigate('LocationDetail', { locationId: location.id })
      }
    >
      <Card style={cardStyles.card}>
        <View style={cardStyles.topRow}>
          <View style={cardStyles.nameBlock}>
            <Text style={cardStyles.name} numberOfLines={1}>
              {location.name}
            </Text>
            {address ? (
              <Text style={cardStyles.address} numberOfLines={1}>
                {address}
              </Text>
            ) : null}
          </View>
          {location.type ? <StatusBadge status={location.type} /> : null}
        </View>

        {capabilities.length > 0 && (
          <View style={cardStyles.capsRow}>
            {capabilities.map((cap) => (
              <View key={cap} style={cardStyles.capBadge}>
                <Text style={cardStyles.capText}>{cap}</Text>
              </View>
            ))}
          </View>
        )}

        {(location.customer_name || location.customer) ? (
          <View style={cardStyles.customerRow}>
            <Ionicons
              name="people-outline"
              size={14}
              color={colors.text3}
              style={{ marginRight: spacing.xs }}
            />
            <Text style={cardStyles.customerText} numberOfLines={1}>
              {location.customer_name ?? location.customer}
            </Text>
          </View>
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  nameBlock: {
    flex: 1,
    marginRight: spacing.md,
  },
  name: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  address: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: 2,
  },
  capsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  capBadge: {
    backgroundColor: colors.bg4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  capText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  customerText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    flex: 1,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
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
  },
  exportText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  stateScroll: { flexGrow: 0, marginBottom: spacing.sm },
  stateRow: {
    paddingHorizontal: spacing.lg,
    paddingRight: spacing.xl,
    gap: spacing.sm,
  },
  stateChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  stateChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  stateLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  stateLabelActive: {
    color: colors.white,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  count: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  searchWrapper: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100,
  },
  empty: {
    alignItems: 'center',
    marginTop: spacing['5xl'],
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.text3,
    marginTop: spacing.md,
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
