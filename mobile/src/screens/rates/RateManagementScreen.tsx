import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { formatCurrency } from '../../shared/utils/formatters';
import { deleteRate, duplicateRate } from '../../services/rateService';
import Card from '../../components/ui/Card';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export default function RateManagementScreen() {
  const navigation = useNavigation<any>();
  const { data, loading, refreshData } = useData();
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Resolve a stable id for a rate row (handles legacy aliasing). */
  const idOf = useCallback(
    (item: any): string =>
      String(item.id ?? item.rate_id ?? item.lane ?? ''),
    [],
  );

  const handleEdit = useCallback(
    (item: any) => {
      navigation.navigate('EditRate', { mode: 'edit', rateId: idOf(item) });
    },
    [navigation, idOf],
  );

  const handleNew = useCallback(() => {
    navigation.navigate('EditRate', { mode: 'create' });
  }, [navigation]);

  const handleDuplicate = useCallback(
    (item: any) => {
      Alert.alert(
        'Duplicate Rate',
        `Create a copy of "${item.lane || idOf(item)}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Duplicate',
            onPress: async () => {
              setBusyId(idOf(item));
              try {
                await duplicateRate(item);
                await refreshData();
              } catch (e: any) {
                Alert.alert('Duplicate failed', e?.message || 'Could not duplicate rate');
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [refreshData, idOf],
  );

  const handleDelete = useCallback(
    (item: any) => {
      const id = idOf(item);
      Alert.alert(
        'Delete Rate',
        `Permanently delete "${item.lane || id}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setBusyId(id);
              try {
                await deleteRate(id);
                await refreshData();
              } catch (e: any) {
                Alert.alert('Delete failed', e?.message || 'Could not delete rate');
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [refreshData, idOf],
  );

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
      const rowBusy = busyId === idOf(item);

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

          {/* Actions */}
          <View style={styles.actionsRow}>
            <RateAction
              icon="create-outline"
              label="Edit"
              color={colors.accent}
              onPress={() => handleEdit(item)}
              disabled={rowBusy}
            />
            <RateAction
              icon="copy-outline"
              label="Duplicate"
              color={colors.cyan}
              onPress={() => handleDuplicate(item)}
              disabled={rowBusy}
            />
            <RateAction
              icon="trash-outline"
              label="Delete"
              color={colors.red}
              onPress={() => handleDelete(item)}
              disabled={rowBusy}
            />
          </View>

          {rowBusy ? (
            <View style={styles.rowOverlay}>
              <ActivityIndicator size="small" color={colors.accent} />
            </View>
          ) : null}
        </Card>
      );
    },
    [busyId, idOf, handleEdit, handleDuplicate, handleDelete],
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

        {/* New-rate FAB — mirrors the OrdersScreen pattern. */}
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
          onPress={handleNew}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

interface RateActionProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}

function RateAction({ icon, label, color, onPress, disabled }: RateActionProps) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { borderColor: color }, disabled && styles.actionBtnDisabled]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Ionicons name={icon} size={16} color={disabled ? colors.text3 : color} />
      <Text style={[styles.actionLabel, { color: disabled ? colors.text3 : color }]}>
        {label}
      </Text>
    </TouchableOpacity>
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
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    backgroundColor: colors.bg2,
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  rowOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: borderRadius.md,
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
