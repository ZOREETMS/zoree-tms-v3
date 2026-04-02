import React from 'react';
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface StatusFilterProps {
  statuses: string[];
  active: string;
  onSelect: (status: string) => void;
}

const StatusFilter: React.FC<StatusFilterProps> = ({ statuses, active, onSelect }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.container}
  >
    {statuses.map((status) => {
      const isActive = status === active;
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
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
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
});

export default StatusFilter;
