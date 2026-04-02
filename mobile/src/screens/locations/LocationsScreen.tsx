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
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return data.locations;
    return data.locations.filter((loc: any) => {
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
  }, [data.locations, search]);

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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Locations</Text>
        <Text style={styles.count}>{filtered.length} total</Text>
      </View>

      {/* Search */}
      <View style={styles.searchWrapper}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name, address, or customer..."
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
            <Ionicons name="location-outline" size={48} color={colors.text3} />
            <Text style={styles.emptyText}>No locations found</Text>
          </View>
        }
      />
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
});
