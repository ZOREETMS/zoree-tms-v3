import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
import { colors, fontSize, fontWeight, spacing } from '../../theme';

interface OrderCardProps {
  order: any;
  /**
   * When true, the OrdersScreen is in multi-select mode. The card
   * shows a checkbox, tap toggles selection, and we skip the
   * navigate-to-detail path. When false (default), the card behaves
   * exactly as before.
   */
  selectionMode?: boolean;
  /** Whether this order is currently selected (only meaningful in selectionMode). */
  selected?: boolean;
  /** Tap handler in selection mode — toggles this order's selection. */
  onToggleSelect?: (orderId: string) => void;
  /**
   * Long-press handler — used by OrdersScreen to *enter* selection
   * mode from the regular list view. The OrderCard doesn't track that
   * state itself; the parent owns it.
   */
  onLongPressSelect?: (orderId: string) => void;
}

const OrderCard: React.FC<OrderCardProps> = ({
  order,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onLongPressSelect,
}) => {
  const navigation = useNavigation<any>();
  const id = (order.id ?? order.order_id ?? '').toString();

  const handlePress = () => {
    if (selectionMode) {
      onToggleSelect?.(id);
      return;
    }
    navigation.navigate('OrderDetail', { orderId: id });
  };

  const handleLongPress = () => {
    onLongPressSelect?.(id);
  };

  const readyDate = (order.readyDate || order.ready_date || order.ready)
    ? new Date(order.readyDate || order.ready_date || order.ready).toLocaleDateString()
    : '--';

  const weight = (order.weight ?? order.total_weight) != null
    ? `${Number(order.weight ?? order.total_weight).toLocaleString()} lbs`
    : '--';

  const pieces = (order.pieces ?? order.total_pieces) != null
    ? `${Number(order.pieces ?? order.total_pieces).toLocaleString()} pcs`
    : '--';

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={300}
      activeOpacity={0.7}
    >
      <Card style={[styles.card, selectionMode && selected && styles.cardSelected]}>
        <View style={styles.topRow}>
          {selectionMode ? (
            <Ionicons
              name={selected ? 'checkbox' : 'square-outline'}
              size={20}
              color={selected ? colors.accent : colors.text3}
              style={styles.checkboxIcon}
            />
          ) : null}
          <Text style={styles.orderId} numberOfLines={1}>
            {order.order_id || order.id}
          </Text>
          <StatusBadge status={order.status || 'Unplanned'} />
        </View>

        {(order.customer || order.customer_name) ? (
          <Text style={styles.customer} numberOfLines={1}>
            {order.customer || order.customer_name}
          </Text>
        ) : null}

        <View style={styles.laneRow}>
          <Ionicons name="location-outline" size={14} color={colors.text2} />
          <Text style={styles.laneText} numberOfLines={1}>
            {order.origin || order.origin_city || '--'}
          </Text>
          <Ionicons name="arrow-forward" size={14} color={colors.text3} style={styles.arrow} />
          <Ionicons name="location-outline" size={14} color={colors.text2} />
          <Text style={styles.laneText} numberOfLines={1}>
            {order.destination || order.destination_city || '--'}
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
  cardSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(37,99,235,0.04)',
  },
  checkboxIcon: {
    marginRight: spacing.sm,
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
