import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { colors, fontSize, fontWeight, spacing } from '../../theme';

interface Props {
  shipment: any;
}

const PlanResultCard: React.FC<Props> = ({ shipment }) => {
  const cost = shipment.total_cost != null
    ? `$${Number(shipment.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
    : '--';

  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.shipId}>{shipment.id}</Text>
        <Badge
          label={shipment.mode || 'LTL'}
          color={shipment.mode === 'TL' ? colors.purple : colors.cyan}
          bg={shipment.mode === 'TL' ? 'rgba(124,58,237,0.1)' : 'rgba(8,145,178,0.1)'}
        />
      </View>

      <View style={styles.carrierRow}>
        <Ionicons name="business-outline" size={14} color={colors.text2} />
        <Text style={styles.carrier}>{shipment.carrier || 'Unknown'}</Text>
      </View>

      <View style={styles.laneRow}>
        <Ionicons name="location-outline" size={12} color={colors.text3} />
        <Text style={styles.laneText} numberOfLines={1}>
          {shipment.origin || '--'}
        </Text>
        <Ionicons name="arrow-forward" size={10} color={colors.text3} />
        <Text style={styles.laneText} numberOfLines={1}>
          {shipment.dest || '--'}
        </Text>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Ionicons name="cash-outline" size={14} color={colors.green} />
          <Text style={[styles.metaText, { color: colors.green, fontWeight: fontWeight.semibold }]}>
            {cost}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="scale-outline" size={14} color={colors.text3} />
          <Text style={styles.metaText}>
            {shipment.weight ? `${Number(shipment.weight).toLocaleString()} lbs` : '--'}
          </Text>
        </View>
        {shipment.pickup_date && (
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={14} color={colors.text3} />
            <Text style={styles.metaText}>{shipment.pickup_date}</Text>
          </View>
        )}
      </View>

      {shipment.order_ids?.length > 0 && (
        <Text style={styles.orderCount}>
          {shipment.order_ids.length} order{shipment.order_ids.length !== 1 ? 's' : ''}
        </Text>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  shipId: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  carrierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  carrier: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  laneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  laneText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    flexWrap: 'wrap',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text3,
  },
  orderCount: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    marginTop: spacing.sm,
  },
});

export default React.memo(PlanResultCard);
