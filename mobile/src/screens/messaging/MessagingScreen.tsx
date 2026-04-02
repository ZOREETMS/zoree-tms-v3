import React, { useCallback } from 'react';
import {
  FlatList,
  ScrollView,
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
import { useData } from '../../state/DataContext';
import { useMessaging } from '../../../../shared/src/hooks/useMessaging';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'outbound', label: 'Outbound' },
  { key: 'inbound', label: 'Inbound' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/**
 * Return an Ionicons name based on message direction.
 */
function directionIcon(
  direction: string,
): keyof typeof Ionicons.glyphMap {
  if ((direction || '').toLowerCase() === 'outbound') return 'arrow-up-circle-outline';
  if ((direction || '').toLowerCase() === 'inbound') return 'arrow-down-circle-outline';
  return 'swap-horizontal-outline';
}

/**
 * Color for message status text.
 */
function statusColor(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'delivered') return colors.green;
  if (s === 'sent') return colors.accent;
  if (s === 'failed') return colors.red;
  return colors.text2;
}

/**
 * Format ISO timestamp into a short readable form.
 */
function formatTimestamp(ts: string): string {
  if (!ts) return '--';
  try {
    const d = new Date(ts);
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const hour = d.getHours();
    const minute = String(d.getMinutes()).padStart(2, '0');
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${month} ${day}, ${h}:${minute} ${ampm}`;
  } catch {
    return ts;
  }
}

export default function MessagingScreen() {
  const { data } = useData();

  const {
    messages,
    kpis,
    tab,
    switchTab,
  } = useMessaging(data.shipments);

  const renderItem = useCallback(
    ({ item }: { item: any }) => (
      <Card style={styles.messageCard}>
        <View style={styles.messageRow}>
          {/* Direction icon */}
          <View
            style={[
              styles.directionBubble,
              {
                backgroundColor:
                  (item.direction || '').toLowerCase() === 'outbound'
                    ? colors.accentGlow
                    : colors.greenDim,
              },
            ]}>
            <Ionicons
              name={directionIcon(item.direction)}
              size={20}
              color={
                (item.direction || '').toLowerCase() === 'outbound'
                  ? colors.accent
                  : colors.green
              }
            />
          </View>

          {/* Message details */}
          <View style={styles.messageInfo}>
            <View style={styles.messageTopRow}>
              <Text style={styles.messageType} numberOfLines={1}>
                {item.type || 'Message'}
              </Text>
              <Text style={[styles.messageStatus, { color: statusColor(item.status) }]}>
                {item.status || 'Unknown'}
              </Text>
            </View>
            <Text style={styles.messageDest} numberOfLines={1}>
              {item.dest || item.ref || '--'}
            </Text>
            <Text style={styles.messageTs}>
              {formatTimestamp(item.ts)}
            </Text>
          </View>
        </View>
      </Card>
    ),
    [],
  );

  const keyExtractor = useCallback(
    (item: any) => String(item.id || Math.random()),
    [],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Messaging</Text>
          <TouchableOpacity
            style={styles.composeButton}
            activeOpacity={0.7}>
            <Ionicons
              name="create-outline"
              size={16}
              color={colors.white}
            />
            <Text style={styles.composeButtonText}>Compose</Text>
          </TouchableOpacity>
        </View>

        {/* KPI Cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Total Messages"
              value={kpis.total ?? 0}
              icon="chatbubbles-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Sent"
              value={kpis.sent ?? 0}
              icon="arrow-up-circle-outline"
              color={colors.cyan}
            />
          </View>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Delivered"
              value={kpis.delivered ?? 0}
              icon="checkmark-done-outline"
              color={colors.green}
            />
          </View>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Failed"
              value={kpis.failed ?? 0}
              icon="alert-circle-outline"
              color={colors.red}
            />
          </View>
        </ScrollView>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              activeOpacity={0.7}
              onPress={() => switchTab(t.key)}
              style={[styles.tab, tab === t.key && styles.tabActive]}>
              <Text
                style={[
                  styles.tabLabel,
                  tab === t.key && styles.tabLabelActive,
                ]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Message List */}
        <FlatList
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="chatbubble-ellipses-outline"
              title="No messages"
              subtitle="Messages will appear here once sent or received."
            />
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  composeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  composeButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  kpiRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  kpiItem: {
    width: 150,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tabLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  tabLabelActive: {
    color: colors.white,
    fontWeight: fontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing['5xl'],
    flexGrow: 1,
  },
  messageCard: {
    marginBottom: spacing.sm,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  directionBubble: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  messageInfo: {
    flex: 1,
  },
  messageTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  messageType: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
  },
  messageStatus: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginLeft: spacing.sm,
  },
  messageDest: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginBottom: 2,
  },
  messageTs: {
    fontSize: fontSize.xs,
    color: colors.text3,
  },
});
