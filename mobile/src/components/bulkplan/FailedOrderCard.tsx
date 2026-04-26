/**
 * Renders one order that failed to plan, with the user-visible reason
 * and category badge derived from the planning-failure catalog.
 *
 * Used by BulkPlanResultsScreen to surface why specific orders dropped
 * out of the plan — replacing the previous generic "X orders could
 * not be planned" copy.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import {
  describeFailure,
  failureCategory,
} from '../../services/planningFailureCatalog';
import type { PlanningFailure } from '../../types/planningFailure';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface FailedOrderCardProps {
  failure: PlanningFailure;
  /** Optional order row, used to enrich the card with customer / lane. */
  order?: any;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Carrier / Rate': colors.yellow,
  Dates: colors.cyan,
  Database: colors.red,
  Other: colors.text3,
};

export default function FailedOrderCard({ failure, order }: FailedOrderCardProps) {
  const category = failureCategory(failure.code);
  const reason = describeFailure(failure);
  const tagColor = CATEGORY_COLORS[category] || colors.text3;

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Ionicons name="alert-circle-outline" size={18} color={tagColor} />
        <Text style={styles.orderId} numberOfLines={1}>
          {order?.order_id || order?.id || failure.orderId}
        </Text>
        <View style={[styles.badge, { backgroundColor: tagColor + '22' }]}>
          <Text style={[styles.badgeText, { color: tagColor }]} numberOfLines={1}>
            {category}
          </Text>
        </View>
      </View>

      {order ? (
        <View style={styles.laneRow}>
          <Text style={styles.laneText} numberOfLines={1}>
            {order.customer || '--'}
            {order.origin || order.dest
              ? `  •  ${order.origin || '?'} → ${order.dest || order.destination || '?'}`
              : ''}
          </Text>
        </View>
      ) : null}

      <Text style={styles.reasonText}>{reason}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  orderId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.3,
  },
  laneRow: {
    marginBottom: spacing.xs,
  },
  laneText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
  },
  reasonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    lineHeight: 20,
  },
});
