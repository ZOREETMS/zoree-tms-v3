import React from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
  /**
   * QA P223 (2026-05-11): per-row overflow menu callbacks. When any
   * of these are supplied the card renders a kebab icon that opens an
   * ActionSheet (iOS) or Alert-buttons fallback (Android) with the
   * available actions for that row. All callbacks are optional —
   * actions for which no callback is supplied are simply omitted from
   * the sheet. Delete is intentionally NOT exposed on mobile to avoid
   * destructive taps; users do that on the web (per triage decision).
   */
  onEdit?: (orderId: string) => void;
  onDuplicate?: (orderId: string) => void;
  onAddToShipment?: (orderId: string) => void;
  onCrossDockPlan?: (orderId: string) => void;
  onCancelOrder?: (orderId: string) => void;
  /**
   * QA 234 (2026-05-12): Unplan action — surfaced only when the row's
   * status indicates it has a shipment attached and the server permits
   * unplanning. Lets the user move the order back to Unplanned from the
   * single-row 3-dot menu, matching the web 3-dot parity.
   */
  onUnplan?: (orderId: string) => void;
}

const OrderCard: React.FC<OrderCardProps> = ({
  order,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onLongPressSelect,
  onEdit,
  onDuplicate,
  onAddToShipment,
  onCrossDockPlan,
  onCancelOrder,
  onUnplan,
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

  /**
   * QA P223: 3-dot per-row overflow menu. Built as a single action
   * sheet that lists only the callbacks the parent actually supplied.
   * "View Details" always appears (it's just the row tap behaviour,
   * surfaced here for discoverability). Delete is omitted on mobile
   * — the web has it under a separate confirm dialog and that's where
   * destructive flows live (per docs/p1_bug_triage_2026-05-11.md
   * P223 decision).
   */
  const handleMorePress = () => {
    const status = String(order?.status || '').toLowerCase();
    const isUnplanned = status === 'unplanned';
    const isCancellable = !['delivered', 'cancelled'].includes(status);
    // QA 234 (2026-05-12): server permits unplanning for orders that
    // have a shipment attached and are not yet in transit / delivered /
    // cancelled. Mirrors the locked-status guard in OrdersScreen's bulk
    // Remove Shipments flow so the single-row Unplan has the same
    // semantics as the multi-select one.
    const sid = (order as any)?.shipment_id || (order as any)?.shipmentId;
    const isUnplannable =
      Boolean(sid) &&
      !['unplanned', 'tender accepted', 'in-transit', 'in transit', 'delivered', 'cancelled'].includes(status);

    type SheetItem = { label: string; run: () => void };
    const items: SheetItem[] = [];
    items.push({
      label: 'View Details',
      run: () => navigation.navigate('OrderDetail', { orderId: id }),
    });
    if (onEdit) items.push({ label: 'Edit', run: () => onEdit(id) });
    if (onDuplicate) items.push({ label: 'Duplicate', run: () => onDuplicate(id) });
    if (onAddToShipment && isUnplanned) {
      items.push({ label: 'Add to Shipment', run: () => onAddToShipment(id) });
    }
    if (onCrossDockPlan && isUnplanned) {
      items.push({ label: 'Cross-Dock Plan', run: () => onCrossDockPlan(id) });
    }
    if (onUnplan && isUnplannable) {
      items.push({ label: 'Unplan', run: () => onUnplan(id) });
    }
    if (onCancelOrder && isCancellable) {
      items.push({ label: 'Cancel Order', run: () => onCancelOrder(id) });
    }
    if (items.length === 0) return;

    const labels = items.map((i) => i.label);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...labels, 'Close'],
          cancelButtonIndex: labels.length,
          // Cancel Order is the only destructive action surfaced here;
          // identify it by index if present.
          destructiveButtonIndex: labels.indexOf('Cancel Order') >= 0
            ? labels.indexOf('Cancel Order')
            : undefined,
        },
        (chosen) => {
          if (chosen >= 0 && chosen < items.length) items[chosen].run();
        },
      );
    } else {
      // Android / web fallback: Alert with buttons. RN Alert tops out
      // at 3 buttons on Android — for longer menus we'd want a custom
      // bottom-sheet, but the small list here keeps it usable.
      Alert.alert(
        `Order ${order.order_id || id}`,
        undefined,
        [
          ...items.map((it) => ({ text: it.label, onPress: it.run })),
          { text: 'Close', style: 'cancel' as const },
        ],
        { cancelable: true },
      );
    }
  };

  // Show the kebab only when at least one row callback is wired AND
  // we're not in multi-select mode (the selection bar owns bulk
  // actions in that mode).
  const showMore =
    !selectionMode &&
    Boolean(onEdit || onDuplicate || onAddToShipment || onCrossDockPlan || onCancelOrder || onUnplan);

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
          {showMore ? (
            <TouchableOpacity
              onPress={handleMorePress}
              hitSlop={10}
              accessibilityLabel={`More actions for order ${order.order_id || id}`}
              style={styles.moreBtn}>
              <Ionicons name="ellipsis-vertical" size={18} color={colors.text2} />
            </TouchableOpacity>
          ) : null}
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
  moreBtn: {
    marginLeft: spacing.sm,
    padding: 2,
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
