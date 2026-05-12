/**
 * RouteOptimizerScreen — QA P202 (2026-05-11).
 *
 * Mobile-appropriate companion to frontend/src/pages/RouteOptimizerPage.jsx.
 * The web RouteOptimizer is a 975-line interactive optimizer (drag
 * orders into stops, re-rate, swap carriers) that needs a desktop-sized
 * canvas to be useful. The mobile version focuses on the read-side:
 *
 *   - Surface saved route templates (data.routeTemplates) with a
 *     compact card per template — name, stop count, total miles,
 *     active/inactive badge.
 *   - Show a Quick Stats KPI row (templates total, active, average
 *     stops) computed from the same data the web reads.
 *   - Tap a card → jump to MultiStopRoutes (drawer's Multi-Stop tab)
 *     where the existing mobile execution flow already lives.
 *   - Big CTA buttons to "Plan from Orders" (BulkPlan) and "Multi-Stop
 *     Builder" so planners on the road can still kick off the two
 *     workflows the web Route Optimizer fronts.
 *
 * Full template authoring + rate scenarios stay web-only and are
 * called out in the page subtitle so users know where to go for the
 * advanced flow.
 */

import React, { useCallback, useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import EmptyState from '../../components/ui/EmptyState';
import { useData } from '../../state/DataContext';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

interface RouteTemplate {
  id?: string;
  name?: string;
  description?: string;
  stops?: any[];
  stop_count?: number;
  total_miles?: number;
  totalMiles?: number;
  active?: boolean;
  updated_at?: string;
  created_at?: string;
}

function stopCount(t: RouteTemplate): number {
  if (Array.isArray(t.stops)) return t.stops.length;
  if (typeof t.stop_count === 'number') return t.stop_count;
  return 0;
}

function totalMiles(t: RouteTemplate): number {
  return Number(t.total_miles ?? t.totalMiles ?? 0) || 0;
}

export default function RouteOptimizerScreen() {
  const navigation = useNavigation<any>();
  const { data, loading, refreshData } = useData();

  const templates: RouteTemplate[] = Array.isArray(data.routeTemplates)
    ? data.routeTemplates
    : [];

  const kpis = useMemo(() => {
    const total = templates.length;
    const active = templates.filter((t) => t.active !== false).length;
    const avgStops =
      total === 0
        ? 0
        : Math.round(
            templates.reduce((s, t) => s + stopCount(t), 0) / total,
          );
    const totalMi = templates.reduce((s, t) => s + totalMiles(t), 0);
    return { total, active, avgStops, totalMi };
  }, [templates]);

  const handleTemplatePress = useCallback(
    (t: RouteTemplate) => {
      // Cross-stack hop into the Multi-Stop drawer entry — the existing
      // mobile MultiStopRoutesScreen owns the execute / preview flow.
      navigation.navigate('MultiStopTab', {
        screen: 'MultiStopRoutes',
      });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: RouteTemplate }) => {
      const stops = stopCount(item);
      const miles = totalMiles(item);
      const inactive = item.active === false;
      return (
        <TouchableOpacity activeOpacity={0.7} onPress={() => handleTemplatePress(item)}>
          <Card style={styles.templateCard}>
            <View style={styles.templateHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.templateName} numberOfLines={1}>
                  {item.name || `Route ${item.id ?? ''}`}
                </Text>
                {item.description ? (
                  <Text style={styles.templateDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              {inactive ? (
                <View style={styles.inactiveBadge}>
                  <Text style={styles.inactiveText}>Inactive</Text>
                </View>
              ) : (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeText}>Active</Text>
                </View>
              )}
            </View>
            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <Ionicons name="location-outline" size={14} color={colors.text3} />
                <Text style={styles.metaText}>
                  {stops} stop{stops === 1 ? '' : 's'}
                </Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="speedometer-outline" size={14} color={colors.text3} />
                <Text style={styles.metaText}>
                  {miles ? `${miles.toLocaleString()} mi` : '— mi'}
                </Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      );
    },
    [handleTemplatePress],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Route Optimizer</Text>
        <Text style={styles.subtitle}>
          Templates + quick actions. Full template authoring lives on the web.
        </Text>
      </View>

      {/* KPI row */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiHalf}>
          <KpiCard
            label="Templates"
            value={kpis.total}
            icon="git-branch-outline"
            color={colors.accent}
          />
        </View>
        <View style={styles.kpiHalf}>
          <KpiCard
            label="Active"
            value={kpis.active}
            icon="checkmark-circle-outline"
            color={colors.green}
          />
        </View>
      </View>
      <View style={styles.kpiRow}>
        <View style={styles.kpiHalf}>
          <KpiCard
            label="Avg Stops"
            value={kpis.avgStops}
            icon="navigate-outline"
            color={colors.cyan}
          />
        </View>
        <View style={styles.kpiHalf}>
          <KpiCard
            label="Total Miles"
            value={kpis.totalMi.toLocaleString()}
            icon="speedometer-outline"
            color={colors.purple}
          />
        </View>
      </View>

      {/* Quick actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionPrimary]}
          activeOpacity={0.8}
          onPress={() =>
            navigation.navigate('BulkPlanTab', { screen: 'BulkPlan' })
          }>
          <Ionicons name="rocket-outline" size={16} color={colors.white} />
          <Text style={styles.actionText}>Plan from Orders</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionSecondary]}
          activeOpacity={0.8}
          onPress={() =>
            navigation.navigate('MultiStopTab', { screen: 'MultiStopRoutes' })
          }>
          <Ionicons name="git-branch-outline" size={16} color={colors.white} />
          <Text style={styles.actionText}>Multi-Stop Builder</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Saved templates</Text>
      <FlatList
        data={templates}
        keyExtractor={(t, i) => String(t.id ?? i)}
        renderItem={renderItem}
        contentContainerStyle={
          templates.length === 0 ? styles.emptyContainer : styles.listContent
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
            icon="git-branch-outline"
            title="No route templates yet"
            subtitle="Create templates on the web → Planning → Route Optimizer."
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  kpiHalf: { flex: 1 },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginVertical: spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  actionPrimary: { backgroundColor: colors.accent },
  actionSecondary: { backgroundColor: colors.bg2 },
  actionText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  listContent: { paddingBottom: spacing['5xl'] },
  emptyContainer: { flexGrow: 1 },
  templateCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  templateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  templateName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  templateDesc: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  activeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(34,197,94,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
  },
  activeText: {
    fontSize: fontSize.xs,
    color: colors.green,
    fontWeight: fontWeight.semibold,
  },
  inactiveBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(100,116,139,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.4)',
  },
  inactiveText: {
    fontSize: fontSize.xs,
    color: colors.text2,
    fontWeight: fontWeight.semibold,
  },
  metaRow: { flexDirection: 'row', gap: spacing.lg },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaText: { fontSize: fontSize.xs, color: colors.text2 },
});
