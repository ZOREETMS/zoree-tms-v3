import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';
import { formatCurrency } from '../../shared/utils/formatters';
import type { PlanningTabParamList } from '../../navigation/types';

interface ShipmentCardProps {
  shipment: any;
}

type Nav = NativeStackNavigationProp<PlanningTabParamList, 'Shipments'>;

function formatDate(value: string | null | undefined): string {
  if (!value) return '--';
  const d = new Date(value);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const ShipmentCard: React.FC<ShipmentCardProps> = ({ shipment }) => {
  const navigation = useNavigation<Nav>();

  const shipmentId =
    shipment.id || shipment.shipment_id || shipment.shipmentId || '';
  const carrier =
    shipment.carrier_name || shipment.carrierName || shipment.carrier || '--';
  const origin =
    shipment.origin_city || shipment.origin || shipment.originCity || '--';
  const destination =
    shipment.destination_city ||
    shipment.destination ||
    shipment.destinationCity ||
    '--';
  const status = shipment.status || 'Planned';
  const pickupDate = shipment.pickup_date || shipment.pickupDate;
  const deliveryDate = shipment.delivery_date || shipment.deliveryDate;
  const totalCost =
    shipment.total_cost ?? shipment.totalCost ?? shipment.cost ?? null;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() =>
        navigation.navigate('ShipmentDetail', { shipmentId: String(shipmentId) })
      }>
      <Card style={styles.card}>
        {/* Top row: ID + Status */}
        <View style={styles.topRow}>
          <Text style={styles.shipmentId} numberOfLines={1}>
            {shipmentId}
          </Text>
          <StatusBadge status={status} />
        </View>

        {/* Carrier */}
        <Text style={styles.carrier} numberOfLines={1}>
          {carrier}
        </Text>

        {/* Route */}
        <View style={styles.routeRow}>
          <Ionicons
            name="location-outline"
            size={14}
            color={colors.accent}
            style={styles.routeIcon}
          />
          <Text style={styles.routeText} numberOfLines={1}>
            {origin}
          </Text>
          <Ionicons
            name="arrow-forward"
            size={14}
            color={colors.text3}
            style={styles.routeArrow}
          />
          <Ionicons
            name="location-outline"
            size={14}
            color={colors.green}
            style={styles.routeIcon}
          />
          <Text style={styles.routeText} numberOfLines={1}>
            {destination}
          </Text>
        </View>

        {/* Bottom row: Dates + Cost */}
        <View style={styles.bottomRow}>
          <View style={styles.dateGroup}>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Pickup</Text>
              <Text style={styles.dateValue}>{formatDate(pickupDate)}</Text>
            </View>
            <View style={styles.dateItem}>
              <Text style={styles.dateLabel}>Delivery</Text>
              <Text style={styles.dateValue}>{formatDate(deliveryDate)}</Text>
            </View>
          </View>
          {totalCost != null && (
            <Text style={styles.cost}>{formatCurrency(Number(totalCost))}</Text>
          )}
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  shipmentId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
    flex: 1,
    marginRight: spacing.sm,
  },
  carrier: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    marginBottom: spacing.sm,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  routeIcon: {
    marginRight: 2,
  },
  routeArrow: {
    marginHorizontal: spacing.xs,
  },
  routeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text,
    flexShrink: 1,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  dateGroup: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  dateItem: {},
  dateLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    marginBottom: 2,
  },
  dateValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  cost: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.green,
  },
});

export default ShipmentCard;
