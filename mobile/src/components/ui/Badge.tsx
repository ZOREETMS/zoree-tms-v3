import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface BadgeProps {
  label: string;
  color: string;
  bg: string;
  small?: boolean;
}

const Badge: React.FC<BadgeProps> = ({ label, color, bg, small = false }) => (
  <View style={[styles.badge, { backgroundColor: bg }, small && styles.badgeSmall]}>
    <Text
      style={[styles.label, { color }, small && styles.labelSmall]}
      numberOfLines={1}
    >
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  badgeSmall: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  labelSmall: {
    fontSize: fontSize.xs,
  },
});

export default Badge;
