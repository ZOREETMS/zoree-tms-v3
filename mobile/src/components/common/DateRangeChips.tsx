/**
 * DateRangeChips — preset date-range filter chips (All / Today / 7 days
 * / 30 days). Mobile-friendly stand-in for the web's two date pickers
 * (Created From / Created To). Reuses the same chip styling as status
 * filters so the row aligns visually.
 */

import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export type DateRangeKey = 'all' | 'today' | '7d' | '30d';

const PRESETS: Array<{ key: DateRangeKey; label: string }> = [
  { key: 'all',   label: 'All Dates' },
  { key: 'today', label: 'Today' },
  { key: '7d',    label: 'Last 7 days' },
  { key: '30d',   label: 'Last 30 days' },
];

interface Props {
  active: DateRangeKey;
  onSelect: (key: DateRangeKey) => void;
}

const DateRangeChips: React.FC<Props> = ({ active, onSelect }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.row}
    style={styles.scroll}>
    {PRESETS.map((p) => {
      const isActive = p.key === active;
      return (
        <TouchableOpacity
          key={p.key}
          activeOpacity={0.7}
          onPress={() => onSelect(p.key)}
          style={[styles.chip, isActive && styles.chipActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: isActive }}>
          <Text style={[styles.label, isActive && styles.labelActive]}>
            {p.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

/**
 * Translate a preset key into a cutoff (epoch ms) — rows with an
 * `created_at` newer than the cutoff match. `null` means no cutoff
 * (the All preset).
 */
export function dateRangeCutoff(key: DateRangeKey): number | null {
  if (key === 'all') return null;
  const now = Date.now();
  if (key === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (key === '7d')  return now - 7  * 24 * 60 * 60 * 1000;
  if (key === '30d') return now - 30 * 24 * 60 * 60 * 1000;
  return null;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, marginBottom: spacing.sm },
  row: {
    paddingHorizontal: spacing.lg,
    paddingRight: spacing.xl, // QA #272 — extra right padding so the
                              // last chip is never visually clipped.
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  labelActive: {
    color: colors.white,
  },
});

export default DateRangeChips;
