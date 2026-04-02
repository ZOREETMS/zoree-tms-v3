import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
import { colors, fontSize, fontWeight, spacing } from '../../theme';

interface OrderCardProps {
  order: any;
}

const OrderCard: React.FC<OrderCardProps> = ({ order }) => {
  const navigation = useNavigation<any>();

  const handlePress = () => {
    navigation.navigate('OrderDetail', { orderId: order.id });
  };

  const readyDate = order.ready_date
    ? new Date(order.ready_date).toLocaleDateString()
    : '--';

  const weight = order.total_weight != null
    ? `${Number(order.total_weight).toLocaleString()} lbs`
    : '--';

  const pieces = order.total_pieces != null
    ? `${Number(order.total_pieces).toLocaleString()} pcs`
    : '--';

  return (
    <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <Text style={styles.orderId} numberOfLines={1}>
            {order.order_id || order.id}
          </Text>
          <StatusBadge status={order.status || 'Unplanned'} />
        </View>

        {order.customer_name ? (
          <Text style={styles.customer} numberOfLines={1}>
            {order.customer_name}
          </Text>
        ) : null}

        <View style={styles.laneRow}>
          <Ionicons name="location-outline" size={14} color={colors.text2} />
          <Text style={styles.laneText} numberOfLines={1}>
            {order.origin_city || order.origin || '--'}
          </Text>
          <Ionicons name="arrow-forward" size={14} color={colors.text3} style={styles.arrow} />
          <Ionicons name="location-outline" size={14} color={colors.text2} />
          <Text style={styles.laneText} numberOfLines={1}>
            {order.destination_city || order.destination || '--'}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="calendar-outline" size={14} color={colors.text3} />
            <Text style={styles.metaText}>{readyDate}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="scale-outline" size={14} color={colors.text3} />
            <Text style={styles.metaText}>{weight}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="cube-outline" size={14} color={colors.text3} />
            <Text style={styles.metaText}>{pieces}</Text>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  orderId: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  customer: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginBottom: spacing.sm,
  },
  laneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  laneText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
    marginLeft: spacing.xs,
    flexShrink: 1,
  },
  arrow: {
    marginHorizontal: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
  },
});

export default OrderCard;
