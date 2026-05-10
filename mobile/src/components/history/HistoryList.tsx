// ═══════════════════════════════════════════════════════════════════
// HistoryList — REQ-02 Phase 1 (mobile parity).
//
// Shared presentation component for any change-history timeline
// produced by orderHistoryService.shapeOrderHistoryRows() (or any
// future service that returns the same OrderHistoryEntry shape, e.g.
// shipments / rates). Pure renderer — no data fetching.
//
// CLAUDE_RULES §2 (single-purpose component) + §3 (UI doesn't call
// APIs directly): the parent screen is responsible for loading data
// and passing it in.
// ═══════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import type { OrderHistoryEntry } from '../../services/orderHistoryService';

export interface HistoryListProps {
  entries: OrderHistoryEntry[];
  loading?: boolean;
  emptyLabel?: string;
}

/**
 * Pick a glyph that visually matches the action type. Keeps the
 * timeline scannable at a glance.
 */
function iconFor(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'create':   return 'add-circle-outline';
    case 'delete':   return 'trash-outline';
    case 'plan':     return 'git-merge-outline';
    case 'unassign': return 'unlink-outline';
    case 'tender':   return 'send-outline';
    case 'untender': return 'arrow-undo-outline';
    case 'status':   return 'flag-outline';
    default:         return 'create-outline';
  }
}

function colorFor(type: string): string {
  switch (type) {
    case 'create':   return colors.green ?? colors.accent;
    case 'delete':   return colors.red;
    case 'plan':     return colors.purple;
    case 'tender':   return colors.cyan;
    case 'status':   return colors.accent;
    default:         return colors.text2;
  }
}

export default function HistoryList({ entries, loading = false, emptyLabel }: HistoryListProps) {
  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <Text style={styles.empty}>
        {emptyLabel ?? 'No history yet.'}
      </Text>
    );
  }

  return (
    <View>
      {entries.map((entry, idx) => (
        <HistoryEntryRow
          key={`${entry.action}-${entry.tsRaw}-${idx}`}
          entry={entry}
          isLast={idx === entries.length - 1}
        />
      ))}
    </View>
  );
}

function HistoryEntryRow({ entry, isLast }: { entry: OrderHistoryEntry; isLast: boolean }) {
  const tint = colorFor(entry.type);
  return (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <View style={[styles.iconBubble, { borderColor: tint }]}>
        <Ionicons name={iconFor(entry.type)} size={16} color={tint} />
      </View>
      <View style={styles.body}>
        <View style={styles.headerLine}>
          <Text style={styles.user} numberOfLines={1}>
            {entry.user}
            {entry.userRole ? ` · ${entry.userRole}` : ''}
          </Text>
          <Text style={styles.ts} numberOfLines={1}>{entry.ts}</Text>
        </View>
        {entry.changes.length === 1 ? (
          <SingleChangeLine change={entry.changes[0]} />
        ) : (
          <MultiChangeBlock count={entry.changes.length} changes={entry.changes} />
        )}
      </View>
    </View>
  );
}

function SingleChangeLine({ change }: { change: { label: string; old: string; new: string } }) {
  return (
    <Text style={styles.changeLine} numberOfLines={2}>
      <Text style={styles.changeLabel}>{change.label}: </Text>
      <Text style={styles.oldVal}>{change.old || '—'}</Text>
      <Text style={styles.arrow}>  →  </Text>
      <Text style={styles.newVal}>{change.new || '—'}</Text>
    </Text>
  );
}

function MultiChangeBlock({ count, changes }: { count: number; changes: { label: string; old: string; new: string }[] }) {
  return (
    <View>
      <Text style={styles.changeSummary}>{count} fields changed</Text>
      {changes.map((c, i) => (
        <Text key={`${c.label}-${i}`} style={styles.changeBullet} numberOfLines={2}>
          <Text style={styles.changeLabel}>{c.label}: </Text>
          <Text style={styles.oldVal}>{c.old || '—'}</Text>
          <Text style={styles.arrow}>  →  </Text>
          <Text style={styles.newVal}>{c.new || '—'}</Text>
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { paddingVertical: spacing.lg, alignItems: 'center' },
  empty: {
    fontSize: fontSize.md,
    color: colors.text3,
    textAlign: 'center',
    paddingVertical: spacing.lg,
    fontWeight: fontWeight.regular,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconBubble: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg2,
  },
  body: { flex: 1 },
  headerLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  user: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  ts: {
    fontSize: fontSize.xs,
    color: colors.text3,
    fontWeight: fontWeight.medium,
  },
  changeLine: {
    fontSize: fontSize.sm,
    color: colors.text2,
    fontWeight: fontWeight.regular,
  },
  changeSummary: {
    fontSize: fontSize.sm,
    color: colors.text2,
    fontWeight: fontWeight.medium,
    marginBottom: 4,
  },
  changeBullet: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginBottom: 2,
    marginLeft: spacing.sm,
  },
  changeLabel: {
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  oldVal: {
    color: colors.text3,
    textDecorationLine: 'line-through',
  },
  newVal: {
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  arrow: {
    color: colors.text3,
  },
});
