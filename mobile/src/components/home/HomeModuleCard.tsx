/**
 * HomeModuleCard — single tappable module tile rendered inside the
 * mobile Home screen's module directory.
 *
 * Mirrors frontend/src/components/home/ModuleCard.jsx — same icon,
 * label, description triple, but laid out for touch (two-column grid
 * on phones).
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface HomeModuleCardProps {
  icon: string;
  label: string;
  description: string;
  onPress: () => void;
}

const HomeModuleCard: React.FC<HomeModuleCardProps> = ({
  icon,
  label,
  description,
  onPress,
}) => {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${description}`}>
      <View style={styles.iconRow}>
        <Text style={styles.icon}>{icon}</Text>
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.description} numberOfLines={2}>
        {description}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 150,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    minHeight: 110,
  },
  iconRow: {
    marginBottom: spacing.sm,
  },
  icon: {
    fontSize: 24,
  },
  label: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  description: {
    fontSize: fontSize.xs,
    color: colors.text3,
    lineHeight: 16,
  },
});

export default HomeModuleCard;
