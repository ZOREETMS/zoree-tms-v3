import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import SearchBar from '../../components/ui/SearchBar';
import StatusFilter from '../../components/common/StatusFilter';
import EmptyState from '../../components/ui/EmptyState';
import ItemCard from '../../components/items/ItemCard';
import { ITEM_CLASSES } from '../../shared/constants/itemConstants';
import { colors, fontSize, fontWeight, spacing } from '../../theme';

const FILTER_STATUSES = ['All', ...ITEM_CLASSES];

export default function ItemMasterScreen() {
  const navigation = useNavigation<any>();
  const { data, loading, refreshData } = useData();

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('All');

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

  const handlePress = useCallback((item: any) => {
    navigation.navigate('ItemDetail', { itemId: item.id });
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => <ItemCard item={item} onPress={handlePress} />,
    [handlePress],
  );

  const keyExtractor = useCallback((item: any) => String(item.id), []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Item Master</Text>
        <Text style={styles.count}>
          {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <View style={styles.searchWrap}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search items..." />
      </View>

      <StatusFilter
        label="Filter by Class"
        statuses={FILTER_STATUSES}
        active={classFilter}
        onSelect={setClassFilter}
        counts={classCounts}
      />

      <FlatList
        data={filteredItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={filteredItems.length === 0 ? styles.emptyContainer : styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refreshData} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListEmptyComponent={
          <EmptyState icon="cube-outline" title="No items found" subtitle="Add items to your master catalog." />
        }
      />

      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('ItemForm')}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm,
  },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  count: { fontSize: fontSize.sm, fontWeight: fontWeight.regular, color: colors.text2 },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing['5xl'] },
  emptyContainer: { flexGrow: 1 },
  fab: {
    position: 'absolute', right: spacing.xl, bottom: spacing['3xl'],
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
});
