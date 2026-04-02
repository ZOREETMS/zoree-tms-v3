import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

type Trend = 'up' | 'down' | 'flat';

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  trend?: Trend;
  color?: string;
}

const TREND_CONFIG: Record<Trend, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  up: { icon: 'trending-up', color: colors.green },
  down: { icon: 'trending-down', color: colors.red },
  flat: { icon: 'remove-outline', color: colors.text2 },
};

const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  subtitle,
  icon,
  trend,
  color = colors.accent,
}) => {
  const trendInfo = trend ? TREND_CONFIG[trend] : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        {icon && (
          <View style={[styles.iconContainer, { backgroundColor: `${color}14` }]}>
            <Ionicons name={icon} size={20} color={color} />
          </View>
        )}
        {trendInfo && (
          <Ionicons name={trendInfo.icon} size={18} color={trendInfo.color} />
        )}
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  value: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.xs,
  },
});

export default KpiCard;
