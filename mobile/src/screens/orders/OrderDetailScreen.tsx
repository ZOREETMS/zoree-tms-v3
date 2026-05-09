import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { OrdersApi } from '../../lib/api';
import { copyOrder, deleteOrder } from '../../services/ordersService';
// QA bugs #120 / #121 / #122 — central gating helpers so this screen
// never duplicates status rules inline. Updates here automatically
// flow into any future bulk-action UIs that want the same guards.
import {
  canPlanOrder,
  canTenderOrder,
  canCancelOrder,
  canDeleteOrder,
} from '../../services/orderActionRules';
import {
  rateAllCarriersForOrder,
  buildPlanFromQuote,
  executeOrderPlan,
  isFailure,
  type SingleOrderCarrierQuote,
} from '../../services/planSingleOrderService';
import CarrierPickerModal from '../../components/orders/CarrierPickerModal';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import type { PlanningTabParamList } from '../../navigation/types';

type DetailRoute = RouteProp<PlanningTabParamList, 'OrderDetail'>;

export default function OrderDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<DetailRoute>();
  const { orderId } = route.params;

  const { data, refreshData } = useData();

  const [lines, setLines] = useState<any[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  // Carrier-picker state. `pickerQuotes` is the rated list shown in
  // the modal; `pickerBusy` blocks the Confirm button while we run
  // buildPlanFromQuote + executeOrderPlan. We deliberately keep these
  // as plain useState rather than a reducer — the modal is short-lived
  // and the four transitions (open / pick / busy / close) are simple.
  const [pickerQuotes, setPickerQuotes] = useState<SingleOrderCarrierQuote[] | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  const order = useMemo(
    () => data.orders.find((o) => (o.id ?? o.order_id)?.toString() === orderId),
    [data.orders, orderId],
  );

  useEffect(() => {
    if (!orderId || orderId === 'new') return;
    setLinesLoading(true);
    OrdersApi.lines(orderId)
      .then((res: any) => setLines(Array.isArray(res) ? res : []))
      .catch(() => setLines([]))
      .finally(() => setLinesLoading(false));
  }, [orderId]);

  const handleCopy = useCallback(() => {
    if (!order) return;
    Alert.alert(
      'Copy Order',
      `Create a new Unplanned order from "${order.order_id || order.id}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: async () => {
            setUpdating(true);
            try {
              const created = await copyOrder(order);
              await refreshData();
              navigation.replace('OrderDetail', { orderId: created.id });
            } catch (e: any) {
              Alert.alert('Copy failed', e?.message || 'Could not copy order');
            } finally {
              setUpdating(false);
            }
          },
        },
      ],
    );
  }, [order, navigation, refreshData]);

  /**
   * Status change. QA bug #58 + #61 fix: route through OrdersApi.update
   * (PATCH /api/orders/:id) so the server-side cascade fires.
   *
   * NOTE: Do NOT call this with newStatus='Planned'. Planning requires a
   * shipment row to be created via BulkPlanApi.execute — the bare PATCH
   * leaves the order in an orphan Planned/no-shipment state (the bug
   * that produced ORD-2026-991550). Use `planThisOrder` instead.
   */
  const changeStatus = useCallback(
    async (newStatus: string) => {
      if (!order) return;
      const id = order.id ?? order.order_id;
      Alert.alert(
        'Confirm Status Change',
        `Change order status to "${newStatus}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm',
            onPress: async () => {
              setUpdating(true);
              try {
                await OrdersApi.update(id, { status: newStatus });
                await refreshData();
              } catch (e: any) {
                Alert.alert('Error', e.message || 'Failed to update status');
              } finally {
                setUpdating(false);
              }
            },
          },
        ],
      );
    },
    [order, refreshData],
  );

  /**
   * Plan this single order — rate via BulkPlanApi, show ALL viable
   * carriers in the picker modal, and execute the plan the user
   * chooses (which inserts the shipment row + sets shipment_id +
   * cascades through audit history).
   *
   * Was previously: rate → single-carrier Alert → execute the cheapest.
   * That flow only ever surfaced one carrier, so the user couldn't see
   * — let alone choose — alternative options that returned a quote on
   * the same lane. The picker fixes that gap. The "create shipment
   * row, not just flip status" guarantee from the original fix
   * (ORD-2026-991550) is preserved because the chosen plan still
   * executes through `BulkPlanApi.execute`.
   *
   * Pure orchestration: open picker on rate-success, no business logic.
   */
  const planThisOrder = useCallback(async () => {
    if (!order) return;
    setUpdating(true);
    try {
      const rated = await rateAllCarriersForOrder(order, 'cost');
      if (isFailure(rated)) {
        Alert.alert('Cannot plan order', rated.message);
        return;
      }
      setPickerQuotes(rated.quotes);
    } catch (e: any) {
      Alert.alert('Plan failed', e.message || 'Rating failed');
    } finally {
      setUpdating(false);
    }
  }, [order]);

  /**
   * Carrier-picker confirm: build the plan from the chosen quote
   * (so the shipment row carries that exact carrier + cost) and run
   * it through executeOrderPlan. We keep the picker open while busy
   * so the user has visual continuity if execute throws.
   */
  const handlePickerConfirm = useCallback(
    async (quote: SingleOrderCarrierQuote) => {
      if (!order) return;
      setPickerBusy(true);
      try {
        const plan = buildPlanFromQuote(order, quote);
        if (!plan) {
          Alert.alert(
            'Cannot plan order',
            `${quote.carrier} did not return enough information to build a plan (no transit time).`,
          );
          return;
        }
        const exec = await executeOrderPlan(plan);
        if (!exec.shipment) {
          const msg = exec.errors[0]?.error || 'Shipment was not created';
          Alert.alert('Plan failed', msg);
          return;
        }
        setPickerQuotes(null);
        await refreshData();
        Alert.alert('Shipment created', `${exec.shipment.id} on ${exec.shipment.carrier}`);
      } catch (e: any) {
        Alert.alert('Plan failed', e.message || 'Could not create shipment');
      } finally {
        setPickerBusy(false);
      }
    },
    [order, refreshData],
  );

  const handlePickerCancel = useCallback(() => {
    if (pickerBusy) return; // ignore taps while a plan is in flight
    setPickerQuotes(null);
  }, [pickerBusy]);

  /**
   * QA bug #121: Delete the current order. Confirmation is mandatory
   * (even on a non-cancelled order this is destructive — it removes
   * the row, audit cascade aside). The service layer enforces the
   * status-gate before the round-trip, so a Cancelled order deletes
   * cleanly while a Tender-Accepted order surfaces the friendly
   * server-aligned reason.
   *
   * On success: pop back to the orders list and refresh DataContext
   * so the detail view doesn't try to render a now-gone row.
   */
  const handleDelete = useCallback(async () => {
    if (!order) return;
    Alert.alert(
      'Delete Order',
      `Permanently delete "${order.order_id || order.id}"? This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setUpdating(true);
            try {
              await deleteOrder(order);
              await refreshData();
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message || 'Could not delete order');
            } finally {
              setUpdating(false);
            }
          },
        },
      ],
    );
  }, [order, navigation, refreshData]);

  if (!order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>Order not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const status = order.status || 'Unplanned';
  const readyDate = (order.readyDate || order.ready_date || order.ready)
    ? new Date(order.readyDate || order.ready_date || order.ready).toLocaleDateString()
    : '--';
  const dueDate = (order.dueDate || order.due_date || order.due)
    ? new Date(order.dueDate || order.due_date || order.due).toLocaleDateString()
    : '--';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {order.order_id || order.id}
          </Text>
        </View>
        <StatusBadge status={status} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.infoCard}>
          <Text style={styles.sectionTitle}>Order Information</Text>

          <InfoRow label="Customer" value={order.customer || order.customer_name || '--'} />
          <InfoRow label="Origin" value={order.origin || order.origin_city || '--'} />
          <InfoRow label="Destination" value={order.destination || order.destination_city || '--'} />
          <InfoRow label="Ready Date" value={readyDate} />
          <InfoRow label="Due Date" value={dueDate} />
          <InfoRow
            label="Weight"
            value={
              (order.weight ?? order.total_weight) != null
                ? `${Number(order.weight ?? order.total_weight).toLocaleString()} lbs`
                : '--'
            }
          />
          <InfoRow
            label="Pieces"
            value={
              (order.pieces ?? order.total_pieces) != null
                ? `${Number(order.pieces ?? order.total_pieces).toLocaleString()}`
                : '--'
            }
          />
          <InfoRow label="Commodity" value={order.commodity || '--'} />
          <TouchableOpacity
            disabled={!(order.shipmentId || order.shipment_id)}
            activeOpacity={0.6}
            onPress={() => {
              const sid = order.shipmentId || order.shipment_id;
              if (sid) navigation.navigate('ShipmentDetail', { shipmentId: sid });
            }}
          >
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Shipment ID</Text>
              {(order.shipmentId || order.shipment_id) ? (
                <View style={styles.shipmentLink}>
                  <Text style={styles.shipmentLinkText} numberOfLines={1}>
                    {order.shipmentId || order.shipment_id}
                  </Text>
                  <Ionicons name="open-outline" size={14} color={colors.accent} />
                </View>
              ) : (
                <Text style={styles.infoValue}>--</Text>
              )}
            </View>
          </TouchableOpacity>
          {(order.preferredCarrier || order.preferred_carrier) ? (
            <InfoRow label="Preferred Carrier" value={order.preferredCarrier || order.preferred_carrier} />
          ) : null}
          {order.notes ? <InfoRow label="Notes" value={order.notes} /> : null}
        </Card>

        <Card style={styles.infoCard}>
          <Text style={styles.sectionTitle}>Order Lines</Text>
          {linesLoading ? (
            <ActivityIndicator color={colors.accent} style={styles.linesLoader} />
          ) : lines.length === 0 ? (
            <Text style={styles.emptyLines}>No line items</Text>
          ) : (
            lines.map((line, idx) => (
              <View
                key={line.id ?? idx}
                style={[styles.lineItem, idx < lines.length - 1 && styles.lineItemBorder]}
              >
                <View style={styles.lineItemHeader}>
                  <Text style={styles.lineItemName} numberOfLines={1}>
                    {line.item_name || line.description || `Line ${idx + 1}`}
                  </Text>
                  <Text style={styles.lineItemQty}>
                    {line.quantity != null ? `Qty: ${line.quantity}` : ''}
                  </Text>
                </View>
                {line.weight != null && (
                  <Text style={styles.lineItemMeta}>
                    Weight: {Number(line.weight).toLocaleString()} lbs
                  </Text>
                )}
              </View>
            ))
          )}
        </Card>

        {/* QA bugs #120 / #121 / #122: action gating now flows from
            services/orderActionRules so the screen never re-implements
            the status rules. Disabled buttons stay visible (familiar
            web parity) but cannot fire - no more accidental tendering
            of an unplanned order or planning of a cancelled one. The
            new Delete button rounds out the destructive-action set
            that the web has long had. */}
        <View style={styles.actions}>
          <ActionButton
            label="Edit"
            icon="create-outline"
            color={colors.accent}
            onPress={() => navigation.navigate('OrderForm', { orderId: order.id })}
            disabled={updating}
          />
          <ActionButton
            label="Copy"
            icon="copy-outline"
            color={colors.accent}
            onPress={handleCopy}
            disabled={updating}
          />
          <ActionButton
            label="Plan"
            icon="git-merge-outline"
            color={colors.purple}
            onPress={planThisOrder}
            disabled={updating || !canPlanOrder(order)}
          />
          <ActionButton
            label="Tender"
            icon="send-outline"
            color={colors.cyan}
            onPress={() => changeStatus('Tendered')}
            disabled={updating || !canTenderOrder(order)}
          />
          <ActionButton
            label="Cancel"
            icon="close-circle-outline"
            color={colors.red}
            onPress={() => changeStatus('Cancelled')}
            disabled={updating || !canCancelOrder(order)}
          />
          <ActionButton
            label="Delete"
            icon="trash-outline"
            color={colors.red}
            onPress={handleDelete}
            disabled={updating || !canDeleteOrder(order)}
          />
        </View>
      </ScrollView>

      {updating && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}

      <CarrierPickerModal
        visible={pickerQuotes !== null}
        quotes={pickerQuotes ?? []}
        orderLabel={order.order_id || order.id}
        busy={pickerBusy}
        onCancel={handlePickerCancel}
        onConfirm={handlePickerConfirm}
      />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  color,
  onPress,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { borderColor: color }, disabled && styles.actionBtnDisabled]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Ionicons name={icon} size={20} color={disabled ? colors.text3 : color} />
      <Text style={[styles.actionBtnLabel, { color: disabled ? colors.text3 : color }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  notFound: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text, marginBottom: spacing.md },
  backLink: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.accent },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { marginRight: spacing.md, padding: spacing.xs },
  headerCenter: { flex: 1, marginRight: spacing.sm },
  headerTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  infoCard: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text, marginBottom: spacing.md },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  infoLabel: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text2 },
  infoValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  shipmentLink: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, marginLeft: spacing.md },
  shipmentLinkText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
    textDecorationLine: 'underline',
    flexShrink: 1,
  },
  linesLoader: { marginVertical: spacing.lg },
  emptyLines: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  lineItem: { paddingVertical: spacing.md },
  lineItemBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  lineItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineItemName: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text, flex: 1, marginRight: spacing.sm },
  lineItemQty: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text2 },
  lineItemMeta: { fontSize: fontSize.sm, fontWeight: fontWeight.regular, color: colors.text3, marginTop: spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  actionBtn: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    backgroundColor: colors.bg2,
  },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnLabel: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
