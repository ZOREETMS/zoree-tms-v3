import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, statusColors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface StatusBadgeProps {
  status: string;
}

const FALLBACK = { bg: colors.bg3, color: colors.text2 };

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const { bg, color } = statusColors[status] ?? FALLBACK;

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {status}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});

export default StatusBadge;
