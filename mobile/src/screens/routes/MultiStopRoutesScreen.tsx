/**
 * MultiStopRoutesScreen — list of route templates with KPIs, search,
 * and a FAB to create new ones. Tap a card to view / edit / delete.
 *
 * Mobile mirror of frontend/src/pages/MultiStopRoutesPage.jsx + RouteCard.
 */

import React, { useCallback, useMemo, useState } from 'react';
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

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import SearchBar from '../../components/ui/SearchBar';
import RouteFormModal from '../../components/routes/RouteFormModal';
import { useData } from '../../state/DataContext';
import { computeRouteStats } from '../../services/routeService';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function MultiStopRoutesScreen() {
  const { data, loading, refreshData } = useData() as any;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const routes: any[] = data.routeTemplates || [];

  const filtered = useMemo(() => {
    if (!search.trim()) return routes;
    const q = search.toLowerCase();
    return routes.filter(
      (r: any) =>
        String(r.name || '').toLowerCase().includes(q)
        || String(r.carrier || '').toLowerCase().includes(q)
        || (Array.isArray(r.stops)
          ? r.stops.some((s: any) =>
              String(s.city || '').toLowerCase().includes(q)
              || String(s.location || '').toLowerCase().includes(q),
            )
          : false),
    );
  }, [routes, search]);

  const stats = useMemo(() => computeRouteStats(routes), [routes]);

  const renderRoute = useCallback(
    ({ item }: { item: any }) => {
      const stops = Array.isArray(item.stops) ? item.stops : [];
      const pickups = stops.filter((s: any) => s.type === 'pickup');
      const deliveries = stops.filter((s: any) => s.type === 'delivery');
      const lanePreview = stops
        .map((s: any) => s.city || (s.location || '').split(',')[0])
        .filter(Boolean)
        .join(' → ');

      return (
        <TouchableOpacity activeOpacity={0.7} onPress={() => setEditing(item)}>
          <Card style={styles.routeCard}>
            <View style={styles.routeHeader}>
              <View style={styles.flex1}>
                <Text style={styles.routeName} numberOfLines={1}>{item.name || '—'}</Text>
                <Text style={styles.routeCarrier} numberOfLines={1}>
                  {item.carrier || 'Carrier TBD'}  ·  {item.mode || 'TL'}
                </Text>
              </View>
              <StatusBadge status={item.status || 'Active'} />
            </View>

            <View style={styles.lanePreview}>
              <Ionicons name="git-branch-outline" size={14} color={colors.text3} />
              <Text style={styles.lanePreviewText} numberOfLines={2}>
                {lanePreview || 'No stops yet'}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Meta label="Stops" value={String(stops.length)} />
              <Meta label="Pickups" value={String(pickups.length)} />
              <Meta label="Deliveries" value={String(deliveries.length)} />
              <Meta
                label="Miles"
                value={item.total_miles ? Number(item.total_miles).toLocaleString() : '—'}
              />
            </View>
          </Card>
        </TouchableOpacity>
      );
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="git-branch-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Multi-Stop Routes</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{filtered.length}</Text>
          </View>
        </View>

        <View style={styles.kpiRow}>
          <KpiCard label="Total" value={String(stats.total)} icon="git-branch-outline" color={colors.accent} />
          <KpiCard label="Active" value={String(stats.active)} icon="checkmark-circle-outline" color={colors.green} />
          <KpiCard label="Inactive" value={String(stats.inactive)} icon="pause-circle-outline" color={colors.text3} />
        </View>

        <View style={styles.searchWrap}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search routes by name, carrier, or city..."
          />
        </View>

        <FlatList
          data={filtered}
          renderItem={renderRoute}
          keyExtractor={(item: any) => String(item.id)}
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
              icon="git-branch-outline"
              title="No route templates"
              subtitle={
                search
                  ? 'No routes match your search.'
                  : 'Tap + to create the first multi-stop route template.'
              }
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

        <RouteFormModal
          visible={creating}
          onClose={() => setCreating(false)}
          onSaved={async () => { if (refreshData) await refreshData(); }}
        />
        <RouteFormModal
          visible={!!editing}
          route={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { if (refreshData) await refreshData(); }}
        />
      </View>
    </SafeAreaView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCol}>
      <Text style={styles.metaLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
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
  routeCard: { marginBottom: spacing.sm },
  routeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  flex1: { flex: 1 },
  routeName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  routeCarrier: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  lanePreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  lanePreviewText: {
    fontSize: fontSize.sm,
    color: colors.text,
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  metaCol: {},
  metaLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    letterSpacing: 0.5,
  },
  metaValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: 2,
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
