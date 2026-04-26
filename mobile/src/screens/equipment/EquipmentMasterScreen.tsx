/**
 * EquipmentMasterScreen — list / search / CRUD for trailer types.
 *
 * Mobile mirror of the web's EquipmentMasterPage. Reads from
 * DataContext.equipmentTypes when available, falls back to the
 * service's seed catalog when the table is empty.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import SearchBar from '../../components/ui/SearchBar';
import EquipmentFormModal from '../../components/equipment/EquipmentFormModal';
import { useData } from '../../state/DataContext';
import {
  computeEquipmentStats,
  deactivateEquipment,
  deleteEquipment,
  getEquipmentList,
} from '../../services/equipmentService';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function EquipmentMasterScreen() {
  const { data, loading, refreshData } = useData() as any;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Equipment list — DB rows when present, seed catalog otherwise. */
  const list = useMemo<any[]>(
    () => getEquipmentList(data.equipmentTypes),
    [data.equipmentTypes],
  );
  const backedByApi = Array.isArray(data.equipmentTypes) && data.equipmentTypes.length > 0;

  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter((e: any) =>
      String(e.name || '').toLowerCase().includes(q)
      || String(e.code || '').toLowerCase().includes(q)
      || String(e.description || '').toLowerCase().includes(q),
    );
  }, [list, search]);

  const stats = useMemo(() => computeEquipmentStats(list), [list]);

  const handleDeactivate = useCallback(
    (item: any) => {
      Alert.alert(
        'Deactivate Equipment',
        `Mark ${item.name} as Inactive? It will no longer appear in pickers but historical data is preserved.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Deactivate',
            style: 'destructive',
            onPress: async () => {
              setBusyId(item.id);
              try {
                await deactivateEquipment(item.id);
                await refreshData();
              } catch (e: any) {
                Alert.alert('Update failed', e?.message || 'Could not deactivate');
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [refreshData],
  );

  const handleDelete = useCallback(
    (item: any) => {
      Alert.alert(
        'Delete Equipment',
        `Permanently delete ${item.name}? This cannot be undone. Prefer Deactivate to keep historical data.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setBusyId(item.id);
              try {
                await deleteEquipment(item.id);
                await refreshData();
              } catch (e: any) {
                Alert.alert('Delete failed', e?.message || 'Could not delete');
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [refreshData],
  );

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const rowBusy = busyId === item.id;
      const dim = item.length || item.width || item.height;
      return (
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="cube-outline" size={18} color={colors.accent} />
              <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
              {item.code ? (
                <View style={styles.codeBadge}>
                  <Text style={styles.codeBadgeText}>{item.code}</Text>
                </View>
              ) : null}
            </View>
            <StatusBadge status={item.status || 'Active'} />
          </View>

          {item.description ? (
            <Text style={styles.desc} numberOfLines={2}>{item.description}</Text>
          ) : null}

          <View style={styles.specsRow}>
            <View style={styles.spec}>
              <Text style={styles.specLabel}>Max Weight</Text>
              <Text style={styles.specValue}>
                {item.max_weight ? `${Number(item.max_weight).toLocaleString()} lb` : '--'}
              </Text>
            </View>
            <View style={styles.spec}>
              <Text style={styles.specLabel}>Max Volume</Text>
              <Text style={styles.specValue}>
                {item.max_volume ? `${Number(item.max_volume).toLocaleString()} ft³` : '--'}
              </Text>
            </View>
            <View style={styles.spec}>
              <Text style={styles.specLabel}>Dimensions</Text>
              <Text style={styles.specValue}>
                {dim ? `${item.length || 0}×${item.width || 0}×${item.height || 0}` : '--'}
              </Text>
            </View>
          </View>

          {(item.temp_controlled || item.hazmat_certified) ? (
            <View style={styles.flagsRow}>
              {item.temp_controlled ? (
                <View style={[styles.flagPill, { backgroundColor: colors.cyan + '14' }]}>
                  <Ionicons name="snow-outline" size={12} color={colors.cyan} />
                  <Text style={[styles.flagPillText, { color: colors.cyan }]}>Temp</Text>
                </View>
              ) : null}
              {item.hazmat_certified ? (
                <View style={[styles.flagPill, { backgroundColor: colors.yellow + '14' }]}>
                  <Ionicons name="warning-outline" size={12} color={colors.yellow} />
                  <Text style={[styles.flagPillText, { color: colors.yellow }]}>Hazmat</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Actions only on API-backed rows — seed rows have no DB id
              that mutations can target. */}
          {backedByApi ? (
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnEdit, rowBusy && styles.actionBtnBusy]}
                onPress={() => setEditing(item)}
                disabled={rowBusy}
                activeOpacity={0.7}
              >
                <Ionicons name="create-outline" size={16} color={colors.accent} />
                <Text style={[styles.actionBtnText, { color: colors.accent }]}>Edit</Text>
              </TouchableOpacity>
              {item.status !== 'Inactive' ? (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPause, rowBusy && styles.actionBtnBusy]}
                  onPress={() => handleDeactivate(item)}
                  disabled={rowBusy}
                  activeOpacity={0.7}
                >
                  <Ionicons name="pause-outline" size={16} color={colors.yellow} />
                  <Text style={[styles.actionBtnText, { color: colors.yellow }]}>Deactivate</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnDelete, rowBusy && styles.actionBtnBusy]}
                onPress={() => handleDelete(item)}
                disabled={rowBusy}
                activeOpacity={0.7}
              >
                {rowBusy ? (
                  <ActivityIndicator size="small" color={colors.red} />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={16} color={colors.red} />
                    <Text style={[styles.actionBtnText, { color: colors.red }]}>Delete</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>
      );
    },
    [busyId, backedByApi, handleDeactivate, handleDelete],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="cube-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Equipment Master</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{filtered.length}</Text>
          </View>
        </View>

        {/* KPIs */}
        <View style={styles.kpiRow}>
          <KpiCard label="Total" value={String(stats.total)} icon="cube-outline" color={colors.accent} />
          <KpiCard label="Active" value={String(stats.active)} icon="checkmark-circle-outline" color={colors.green} />
          <KpiCard label="Reefer" value={String(stats.refrigerated)} icon="snow-outline" color={colors.cyan} />
          <KpiCard label="Hazmat" value={String(stats.hazmat)} icon="warning-outline" color={colors.yellow} />
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, code, description..."
          />
        </View>

        {/* List */}
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item: any) => String(item.id || item.name)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={!!loading}
              onRefresh={refreshData}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="cube-outline"
              title="No equipment found"
              subtitle={search ? 'Try adjusting your search.' : 'Equipment master is empty.'}
            />
          }
        />

        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
          onPress={() => setCreating(true)}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </TouchableOpacity>

        <EquipmentFormModal
          visible={creating}
          onClose={() => setCreating(false)}
          onSaved={async () => { if (refreshData) await refreshData(); }}
        />
        <EquipmentFormModal
          visible={!!editing}
          equipment={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { if (refreshData) await refreshData(); }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  countBadge: {
    backgroundColor: colors.accentGlow,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  countText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['5xl'],
    flexGrow: 1,
  },
  card: { marginBottom: spacing.sm },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    flexShrink: 1,
  },
  codeBadge: {
    backgroundColor: colors.accentGlow,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  codeBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  desc: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginBottom: spacing.sm,
  },
  specsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  spec: {},
  specLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  specValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  flagsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  flagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  flagPillText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.bg3,
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
  },
  actionBtnEdit: { borderColor: colors.accentGlow, backgroundColor: colors.accentGlow },
  actionBtnPause: { borderColor: colors.yellowDim, backgroundColor: colors.yellowDim },
  actionBtnDelete: { borderColor: colors.redDim, backgroundColor: 'transparent' },
  actionBtnBusy: { opacity: 0.5 },
  actionBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
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
