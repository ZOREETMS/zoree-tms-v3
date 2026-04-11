import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { formatCurrency } from '../../shared/utils/formatters';
import Card from '../../components/ui/Card';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export default function RateManagementScreen() {
  const { data, loading, refreshData } = useData();
  const [search, setSearch] = useState('');

  const filteredRates = useMemo(() => {
    let rates = data.rates;
    if (search.trim()) {
      const q = search.toLowerCase();
      rates = rates.filter(
        (r: any) =>
          (r.lane || r.origin || '').toLowerCase().includes(q) ||
          (r.destination || '').toLowerCase().includes(q) ||
          (r.carrier || r.carrier_name || '').toLowerCase().includes(q) ||
          (r.mode || r.transport_mode || '').toLowerCase().includes(q),
      );
    }
    return rates;
  }, [data.rates, search]);

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const lane =
        item.lane ||
        `${item.origin || item.origin_city || '?'} \u2192 ${item.destination || item.destination_city || '?'}`;
      const carrier = item.carrier || item.carrier_name || 'N/A';
      const mode = item.mode || item.transport_mode || 'TL';
      const rate = parseFloat(item.rate || item.rate_per_mile || 0);
      const fsc = parseFloat(item.fsc || item.fuel_surcharge || 0);

      return (
        <Card style={styles.rateCard}>
          {/* Lane */}
          <View style={styles.laneRow}>
            <Ionicons name="git-commit-outline" size={18} color={colors.accent} />
            <Text style={styles.laneText} numberOfLines={2}>
              {lane}
            </Text>
          </View>

          {/* Details */}
          <View style={styles.detailsRow}>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Carrier</Text>
              <Text style={styles.detailValue} numberOfLines={1}>
                {carrier}
              </Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Mode</Text>
              <View style={styles.modeBadge}>
                <Text style={styles.modeText}>{mode}</Text>
              </View>
            </View>
          </View>

          <View style={styles.detailsRow}>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Rate</Text>
              <Text style={styles.rateValue}>
                {rate >= 100 ? formatCurrency(rate) : `$${rate.toFixed(2)}/mi`}
              </Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>FSC</Text>
              <Text style={styles.detailValue}>
                {fsc > 0
                  ? fsc < 1
                    ? `${(fsc * 100).toFixed(0)}%`
                    : `$${fsc.toFixed(2)}`
                  : '--'}
              </Text>
            </View>
          </View>
        </Card>
      );
    },
    [],
  );

  const keyExtractor = useCallback(
    (item: any, index: number) =>
      (item.id || item.rate_id || index).toString(),
    [],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Rate Management</Text>
          <Text style={styles.count}>
            {filteredRates.length} rate{filteredRates.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search by lane or carrier..."
          />
        </View>

        {/* Rates List */}
        <FlatList
          data={filteredRates}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={
            filteredRates.length === 0
              ? styles.emptyContainer
              : styles.listContent
          }
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
              icon="pricetag-outline"
              title="No rates found"
              subtitle={
                search
                  ? 'Try adjusting your search criteria.'
                  : 'Rate contracts will appear here.'
              }
            />
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  header: {
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
  rateCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  laneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  laneText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
  },
  detailsRow: {
    flexDirection: 'row',
    gap: spacing.xl,
    marginBottom: spacing.sm,
  },
  detailCol: {
    flex: 1,
  },
  detailLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  rateValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  modeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentGlow,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  modeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
});
