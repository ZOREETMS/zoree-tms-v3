import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import useAlerts from '../../shared/hooks/useAlerts';
import { ALERT_SEVERITY, ALERT_STATUS } from '../../shared/types/alerts';
import KpiCard from '../../components/ui/KpiCard';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const SEVERITY_FILTERS = [
  { key: '', label: 'All' },
  { key: ALERT_SEVERITY.DANGER, label: 'Critical' },
  { key: ALERT_SEVERITY.WARNING, label: 'Warning' },
  { key: ALERT_SEVERITY.INFO, label: 'Info' },
];

const SEVERITY_ICON: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  [ALERT_SEVERITY.DANGER]: { name: 'alert-circle', color: colors.red },
  [ALERT_SEVERITY.WARNING]: { name: 'warning', color: colors.yellow },
  [ALERT_SEVERITY.INFO]: { name: 'information-circle', color: colors.accent },
  [ALERT_SEVERITY.SUCCESS]: { name: 'checkmark-circle', color: colors.green },
};

export default function AlertsScreen() {
  const {
    alerts,
    stats,
    severityFilter,
    setSeverityFilter,
    // QA #296 — hook already supported category + status filters, the
    // mobile UI just never rendered them. Wire them up to chip rows so
    // the user has the same drill-down the web has.
    categoryFilter,
    setCategoryFilter,
    statusFilter,
    setStatusFilter,
    resolveAlert,
    acknowledgeAlert,
  } = useAlerts();

  // Derive category options from the data set so we never offer a
  // filter value that has no alerts.
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const a of alerts || []) {
      const c = String((a as any)?.category || '').trim();
      if (c) set.add(c);
    }
    return ['', ...Array.from(set).sort()];
  }, [alerts]);

  const STATUS_FILTERS = [
    { key: '',                        label: 'Any Status' },
    { key: ALERT_STATUS.OPEN,         label: 'Open' },
    { key: ALERT_STATUS.ACKNOWLEDGED, label: 'Acknowledged' },
    { key: ALERT_STATUS.RESOLVED,     label: 'Resolved' },
  ];

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const iconCfg = SEVERITY_ICON[item.severity] || SEVERITY_ICON[ALERT_SEVERITY.INFO];
      const isResolved = item.status === ALERT_STATUS.RESOLVED;

      return (
        <Card style={styles.alertCard}>
          <View style={styles.alertHeader}>
            <Ionicons name={iconCfg.name} size={22} color={iconCfg.color} />
            <View style={styles.alertTitleWrap}>
              <Text style={styles.alertTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </View>
            <StatusBadge status={item.status} />
          </View>

          <Text style={styles.alertDesc} numberOfLines={3}>
            {item.description}
          </Text>

          <View style={styles.alertFooter}>
            <Text style={styles.alertTimestamp}>
              {item.timestamp
                ? new Date(item.timestamp).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : ''}
            </Text>

            {!isResolved && (
              <View style={styles.alertActions}>
                {item.status !== ALERT_STATUS.ACKNOWLEDGED && (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    activeOpacity={0.7}
                    onPress={() => acknowledgeAlert(item.id)}
                  >
                    <Text style={styles.actionBtnText}>Acknowledge</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                  activeOpacity={0.7}
                  onPress={() => resolveAlert(item.id)}
                >
                  <Text style={[styles.actionBtnText, styles.actionBtnTextPrimary]}>
                    Resolve
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </Card>
      );
    },
    [acknowledgeAlert, resolveAlert],
  );

  const keyExtractor = useCallback((item: any) => item.id, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Alerts</Text>
          <Text style={styles.count}>{stats.total} active</Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <KpiCard
              label="Total Active"
              value={stats.total}
              icon="notifications-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.statItem}>
            <KpiCard
              label="Critical"
              value={stats.critical}
              icon="alert-circle-outline"
              color={colors.red}
            />
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <KpiCard
              label="Warnings"
              value={stats.warnings}
              icon="warning-outline"
              color={colors.yellow}
            />
          </View>
          <View style={styles.statItem}>
            <KpiCard
              label="Resolved"
              value={stats.resolved}
              icon="checkmark-circle-outline"
              color={colors.green}
            />
          </View>
        </View>

        {/* Severity Filter Chips */}
        <View style={styles.filterRow}>
          {SEVERITY_FILTERS.map((f) => {
            const isActive = f.key === severityFilter;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => setSeverityFilter(f.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* QA #296 — Category filter row (horizontally scrollable). */}
        {categoryOptions.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRowScroll}
            style={styles.filterScroll}>
            {categoryOptions.map((c) => {
              const isActive = c === categoryFilter;
              const label = c === '' ? 'Any Category' : c;
              return (
                <TouchableOpacity
                  key={`cat-${c || 'any'}`}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => setCategoryFilter(c)}
                  activeOpacity={0.7}>
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {/* QA #296 — Status filter row. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRowScroll}
          style={styles.filterScroll}>
          {STATUS_FILTERS.map((f) => {
            const isActive = f.key === statusFilter;
            return (
              <TouchableOpacity
                key={`st-${f.key || 'any'}`}
                style={[styles.chip, isActive && styles.chipActive]}
                onPress={() => setStatusFilter(f.key)}
                activeOpacity={0.7}>
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Alerts List */}
        <FlatList
          data={alerts}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={
            alerts.length === 0 ? styles.emptyContainer : styles.listContent
          }
          ListEmptyComponent={
            <EmptyState
              icon="notifications-off-outline"
              title="No alerts"
              subtitle="All clear! No alerts match your filter."
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
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  statItem: {
    flex: 1,
  },
  filterScroll: { flexGrow: 0, marginBottom: spacing.sm },
  filterRowScroll: {
    paddingHorizontal: spacing.lg,
    paddingRight: spacing.xl,
    gap: spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  chipTextActive: {
    color: colors.white,
    fontWeight: fontWeight.semibold,
  },
  listContent: {
    paddingTop: spacing.xs,
    paddingBottom: spacing['5xl'],
  },
  emptyContainer: {
    flexGrow: 1,
  },
  alertCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  alertTitleWrap: {
    flex: 1,
  },
  alertTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  alertDesc: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.sm,
    lineHeight: fontSize.sm * 1.5,
  },
  alertFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  alertTimestamp: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
  },
  alertActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  actionBtnPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionBtnText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  actionBtnTextPrimary: {
    color: colors.white,
  },
});
