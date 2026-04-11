import React from 'react';
import { View, ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface StatusFilterProps {
  statuses: string[];
  active: string;
  onSelect: (status: string) => void;
  /** Optional label shown above the filter chips (e.g. "Filter by Status") */
  label?: string;
  /** Optional map of status → count to show badges on each chip */
  counts?: Record<string, number>;
}

const StatusFilter: React.FC<StatusFilterProps> = ({
  statuses,
  active,
  onSelect,
  label,
  counts,
}) => (
  <View style={styles.wrapper}>
    {label ? (
      <Text style={styles.label}>{label}</Text>
    ) : null}
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {statuses.map((status) => {
        const isActive = status === active;
        const count = counts?.[status];
        return (
          <TouchableOpacity
            key={status}
            style={[styles.chip, isActive && styles.chipActive]}
            onPress={() => onSelect(status)}
            activeOpacity={0.7}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
              {status}
            </Text>
            {count != null && (
              <View style={[styles.badge, isActive && styles.badgeActive]}>
                <Text style={[styles.badgeText, isActive && styles.badgeTextActive]}>
                  {count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    letterSpacing: 0.3,
  },
  container: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bg2,
    borderWidth: 1.5,
    borderColor: colors.border,
    marginRight: spacing.sm,
    gap: spacing.sm,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  chipTextActive: {
    color: colors.white,
    fontWeight: fontWeight.bold,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bg3,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeActive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.text2,
  },
  badgeTextActive: {
    color: colors.white,
  },
});

export default StatusFilter;
