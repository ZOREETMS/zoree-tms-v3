/**
 * ItemMasterScreen — Planning → Item Master (mobile).
 *
 * QA #270 parity with frontend/src/pages/ItemMasterPage.jsx:
 *   - Items vs Packaging Units tab toggle.
 *   - Class filter on Items, type filter on Packaging Units.
 *   - Search box on both tabs.
 *   - Export CSV button on both tabs.
 *   - KPI strip on each tab (items uses ItemStatsGrid; packaging uses
 *     PackagingStatsGrid).
 *   - "+ New Item" FAB on Items tab. Packaging create flow is not yet
 *     ported to mobile, so the FAB is hidden when the Packaging tab is
 *     active (rather than offering a button that goes nowhere).
 */

import React, { useCallback, useMemo, useState } from 'react';
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
import StatusFilter from '../../components/common/StatusFilter';
import EmptyState from '../../components/ui/EmptyState';
import ItemCard from '../../components/items/ItemCard';
import ItemStatsGrid from '../../components/items/ItemStatsGrid';
import PackagingUnitCard from '../../components/items/PackagingUnitCard';
import PackagingStatsGrid from '../../components/items/PackagingStatsGrid';
import MasterTabSwitch from '../../components/common/MasterTabSwitch';
import { ITEM_CLASSES } from '../../shared/constants/itemConstants';
import { exportRowsAsCsv } from '../../services/csvExport';
import { colors, fontSize, fontWeight, spacing } from '../../theme';

const FILTER_STATUSES = ['All', ...ITEM_CLASSES];

const PACKAGING_TYPES = [
  'All', 'Carton', 'Pallet', 'Drum', 'Crate', 'Bag', 'Roll', 'Tote', 'IBC',
] as const;

type TabKey = 'items' | 'pkg';

const TABS = [
  { key: 'items', label: 'Items' },
  { key: 'pkg',   label: 'Packaging Units' },
];

export default function ItemMasterScreen() {
  const navigation = useNavigation<any>();
  const { data, loading, refreshData } = useData();

  const [tab, setTab] = useState<TabKey>('items');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('All');
  const [pkgSearch, setPkgSearch] = useState('');
  const [pkgType, setPkgType] = useState<string>('All');

  const classCounts = useMemo(() => {
    const counts: Record<string, number> = { All: data.items.length };
    data.items.forEach((i: any) => {
      const c = i.item_class || i.class || 'General';
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }, [data.items]);

  const filteredItems = useMemo(() => {
    let items = data.items;
    if (classFilter !== 'All') {
      items = items.filter((i: any) => (i.item_class || i.class || 'General') === classFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((i: any) =>
        (i.id || '').toLowerCase().includes(q) ||
        (i.description || i.desc || '').toLowerCase().includes(q) ||
        (i.customer || '').toLowerCase().includes(q) ||
        (i.nmfc || '').toLowerCase().includes(q),
      );
    }
    return items;
  }, [data.items, classFilter, search]);

  const pkgTypeCounts = useMemo(() => {
    const counts: Record<string, number> = { All: data.packagingUnits.length };
    data.packagingUnits.forEach((p: any) => {
      const t = p?.type || 'Carton';
      counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
  }, [data.packagingUnits]);

  const filteredPackaging = useMemo(() => {
    let list = data.packagingUnits;
    if (pkgType !== 'All') {
      list = list.filter((p: any) => (p?.type || 'Carton') === pkgType);
    }
    if (pkgSearch.trim()) {
      const q = pkgSearch.toLowerCase();
      list = list.filter((p: any) =>
        (p?.id || '').toLowerCase().includes(q) ||
        (p?.description || p?.desc || '').toLowerCase().includes(q) ||
        (p?.type || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [data.packagingUnits, pkgSearch, pkgType]);

  const handleItemPress = useCallback(
    (item: any) => navigation.navigate('ItemDetail', { itemId: item.id }),
    [navigation],
  );

  const onExport = useCallback(async () => {
    if (tab === 'items') {
      await exportRowsAsCsv(filteredItems, [
        { key: 'id', header: 'Item ID' },
        { key: 'description', header: 'Description', value: (r: any) => r.description || r.desc },
        { key: 'class', header: 'Class', value: (r: any) => r.item_class || r.class },
        { key: 'nmfc', header: 'NMFC' },
        { key: 'freight_class', header: 'Freight Class', value: (r: any) => r.freight_class || r.fclass },
        { key: 'weight_unit', header: 'Weight (lbs)' },
        { key: 'len', header: 'Length (in)' },
        { key: 'wid', header: 'Width (in)' },
        { key: 'hgt', header: 'Height (in)' },
        { key: 'customer', header: 'Customer' },
        { key: 'status', header: 'Status' },
      ], { title: 'Item Master Export', filename: 'items.csv' });
    } else {
      await exportRowsAsCsv(filteredPackaging, [
        { key: 'id', header: 'Packaging ID' },
        { key: 'type', header: 'Type' },
        { key: 'description', header: 'Description', value: (r: any) => r.description || r.desc },
        { key: 'length', header: 'Length (in)' },
        { key: 'width', header: 'Width (in)' },
        { key: 'height', header: 'Height (in)' },
        { key: 'capacity', header: 'Capacity (lbs)' },
        { key: 'status', header: 'Status' },
      ], { title: 'Packaging Units Export', filename: 'packaging.csv' });
    }
  }, [tab, filteredItems, filteredPackaging]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Item Master</Text>
          <Text style={styles.subtitle}>Product catalog with freight attributes and packaging specs</Text>
        </View>
        <TouchableOpacity onPress={onExport} style={styles.exportBtn} accessibilityRole="button" accessibilityLabel="Export current list as CSV">
          <Ionicons name="download-outline" size={16} color={colors.accent} />
          <Text style={styles.exportText}>Export</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabRow}>
        <MasterTabSwitch tabs={TABS} active={tab} onSelect={(k) => setTab(k as TabKey)} />
        <Text style={styles.count}>
          {tab === 'items'
            ? `${filteredItems.length} item${filteredItems.length !== 1 ? 's' : ''}`
            : `${filteredPackaging.length} unit${filteredPackaging.length !== 1 ? 's' : ''}`}
        </Text>
      </View>

      {tab === 'items' ? (
        <>
          <ItemStatsGrid items={data.items} />
          <View style={styles.searchWrap}>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search items..." />
          </View>
          <StatusFilter label="Filter by Class" statuses={FILTER_STATUSES} active={classFilter} onSelect={setClassFilter} counts={classCounts} />
          <FlatList
            data={filteredItems}
            renderItem={({ item }) => <ItemCard item={item} onPress={handleItemPress} />}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={filteredItems.length === 0 ? styles.emptyContainer : styles.listContent}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshData} tintColor={colors.accent} colors={[colors.accent]} />}
            ListEmptyComponent={<EmptyState icon="cube-outline" title="No items found" subtitle="Add items to your master catalog." />}
          />
          <TouchableOpacity style={styles.fab} activeOpacity={0.8} onPress={() => navigation.navigate('ItemForm')}>
            <Ionicons name="add" size={28} color={colors.white} />
          </TouchableOpacity>
        </>
      ) : (
        <>
          <PackagingStatsGrid units={data.packagingUnits} />
          <View style={styles.searchWrap}>
            <SearchBar value={pkgSearch} onChangeText={setPkgSearch} placeholder="Search packaging..." />
          </View>
          <StatusFilter label="Filter by Type" statuses={PACKAGING_TYPES as unknown as string[]} active={pkgType} onSelect={setPkgType} counts={pkgTypeCounts} />
          <FlatList
            data={filteredPackaging}
            renderItem={({ item }) => <PackagingUnitCard unit={item} />}
            keyExtractor={(unit) => String(unit.id)}
            contentContainerStyle={filteredPackaging.length === 0 ? styles.emptyContainer : styles.listContent}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshData} tintColor={colors.accent} colors={[colors.accent]} />}
            ListEmptyComponent={<EmptyState icon="albums-outline" title="No packaging units" subtitle="Packaging unit master is read-only on mobile. Add via the web app." />}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.xs, color: colors.text3, marginTop: 2 },
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
  exportText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.accent },
  tabRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  count: { fontSize: fontSize.sm, color: colors.text2 },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing['5xl'] },
  emptyContainer: { flexGrow: 1 },
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
