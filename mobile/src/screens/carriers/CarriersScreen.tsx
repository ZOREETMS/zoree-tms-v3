import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import SearchBar from '../../components/ui/SearchBar';
import CarrierCard from '../../components/carriers/CarrierCard';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function CarriersScreen() {
  const { data, loading, refreshData } = useData();
  const navigation = useNavigation<any>();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return data.carriers;
    // QA #321 — search now spans the same columns surfaced on the
    // CarrierCard (name, SCAC, mode, MC#, contact, phone, email) so the
    // search behaves like the web Carriers table.
    return data.carriers.filter((c: any) => {
      const name = (c.name ?? '').toLowerCase();
      const scac = String(c.scac ?? '').toLowerCase();
      const mode = String(c.mode ?? '').toLowerCase();
      const mc = String(c.mc_number ?? '').toLowerCase();
      const contact = (c.contact_name ?? c.contact ?? '').toLowerCase();
      const phone = String(c.phone ?? c.contact_phone ?? '').toLowerCase();
      const email = String(c.email ?? c.contact_email ?? '').toLowerCase();
      return (
        name.includes(q) ||
        scac.includes(q) ||
        mode.includes(q) ||
        mc.includes(q) ||
        contact.includes(q) ||
        phone.includes(q) ||
        email.includes(q)
      );
    });
  }, [data.carriers, search]);

  const handleRefresh = useCallback(() => {
    refreshData();
  }, [refreshData]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => <CarrierCard carrier={item} />,
    [],
  );

  const keyExtractor = useCallback(
    (item: any) => String(item.id ?? item.mc_number ?? Math.random()),
    [],
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Carriers</Text>
        <Text style={styles.count}>{filtered.length} total</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrapper}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, SCAC, mode, MC#, contact, phone, or email..."
        />
      </View>

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
            <Ionicons name="business-outline" size={48} color={colors.text3} />
            <Text style={styles.emptyText}>No carriers found</Text>
          </View>
        }
      />

      {/* FAB — add new carrier */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() =>
          navigation.navigate('CarrierDetail', { carrierId: '__new__' })
        }
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
    alignItems: 'baseline',
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
    right: spacing.lg,
    bottom: spacing['3xl'],
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
