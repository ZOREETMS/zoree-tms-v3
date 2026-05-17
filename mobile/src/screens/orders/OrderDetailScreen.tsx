import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
// QA #182: presentation helpers + view-model builder live in the
// service layer so this screen stays a dumb renderer (CLAUDE_RULES
// §1, §3, §4, §6). Adds Ship From, Ship To, Ship Mode, Service Level,
// Incoterms on the order, and Qty / Unit Wt / Total Wt per line so
// mobile reaches field-parity with the web OrderDetailModal.
import {
  buildOrderDetailViewModel,
  buildOrderLineViewModels,
  dashIfBlank,
  formatInt,
  formatLbs,
  type OrderLineViewModel,
} from '../../services/orderDetailService';
import CarrierPickerModal from '../../components/orders/CarrierPickerModal';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
// REQ-02 Phase 1 (mobile parity, 2026-05-10): bring the order History
// tab to mobile. The service does data-shaping; HistoryList does pure
// presentation; this screen orchestrates the load. Web mirror lives in
// frontend/src/services/historyService.js + the OrderDetailModal
// History tab — keep field labels and bucketing in lockstep.
import HistoryList from '../../components/history/HistoryList';
import {
  loadOrderHistory,
  type OrderHistoryEntry,
} from '../../services/orderHistoryService';
// Web↔mobile order sync (2026-05-10): derives a tick from data.orders
// so we refetch lines + history when the realtime channel reports the
// order has changed on the server. Without this, an order edited on
// web only refreshed the header (which reads from data.orders directly)
// and left the per-line table + change-history list stale until the
// user pull-to-refreshed the screen.
import { useOrderDetailLiveSync } from '../../hooks/useOrderDetailLiveSync';
// 2026-05-16: order header now goes through a fresh /api/orders/:id/full
// fetch on mount + every live-sync tick. Closes the bug where dates
// edited on web stayed stale on the mobile detail screen when Supabase
// Realtime was suspended or never connected (no anon key in build) —
// the History tab loaded fresh on open, but the header read from
// DataContext.data.orders which only refreshes via realtime / app
// foreground. Migration 045 (orders/shipments BEFORE UPDATE trigger)
// ensures syncTick now increments correctly on every server write, so
// realtime-driven re-fetches and this fallback both stay current.
import { useFreshOrderHeader } from '../../hooks/useFreshOrderHeader';
// REQ-OFFLINE Phase 5 (2026-05-10): route order status changes
// through the offline-aware façade. When the device is online this
// is a thin pass-through to OrdersApi.update (so the server-side
// cascade + audit still fire — QA bugs #58/#61 unchanged). When
// offline, the action is queued and the user gets an immediate
// "Queued for sync" Alert instead of a network-error toast.
// Plan/Tender stay online-only — server orchestration too complex
// to queue safely in the MVP.
import { updateOrderStatus } from '../../services/offline/offlineOrderActions';
import { useOffline } from '../../state/OfflineContext';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import type { PlanningTabParamList } from '../../navigation/types';

type DetailRoute = RouteProp<PlanningTabParamList, 'OrderDetail'>;

export default function OrderDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<DetailRoute>();
  const { orderId } = route.params;

  const { data, refreshData } = useData();
  // REQ-OFFLINE Phase 5: action buttons that require server
  // orchestration (Plan, Tender) are disabled when offline. Plain
  // status flips + Delete still work — they enqueue and replay on
  // reconnect via offlineOrderActions.
  const { isOnline } = useOffline();

  const [lines, setLines] = useState<any[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  // QA 241 (2026-05-12): monotonic counter so late responses can be
  // discarded. Declared as useRef so increments don't trigger renders.
  const lineFetchRef = useRef({ current: 0 });
  const [updating, setUpdating] = useState(false);
  // REQ-02 Phase 1 (mobile parity): change-history rows for this
  // order. `historyTick` is bumped after any local mutation so the
  // History section re-fetches without us having to thread a callback
  // through every action handler.
  const [history, setHistory] = useState<OrderHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  // Carrier-picker state. `pickerQuotes` is the rated list shown in
  // the modal; `pickerBusy` blocks the Confirm button while we run
  // buildPlanFromQuote + executeOrderPlan. We deliberately keep these
  // as plain useState rather than a reducer — the modal is short-lived
  // and the four transitions (open / pick / busy / close) are simple.
  const [pickerQuotes, setPickerQuotes] = useState<SingleOrderCarrierQuote[] | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);

  // Cached row from DataContext — fast, but may be stale if Realtime
  // didn't fire (no anon key in this build, socket suspended, etc.).
  // We keep it as the fallback render source so the screen never
  // blanks while a fresh fetch is in flight.
  const cachedOrder = useMemo(
    () => data.orders.find((o) => (o.id ?? o.order_id)?.toString() === orderId),
    [data.orders, orderId],
  );

  // Web↔mobile sync tick. Increments when the live data.orders entry
  // for this order changes (after Supabase Realtime fires refreshData)
  // OR when the app returns from background. Adding it to the deps
  // below keeps lines + history aligned with whatever the web just
  // wrote, so the user no longer has to pull-to-refresh.
  const syncTick = useOrderDetailLiveSync(orderId);

  // 2026-05-16 bug fix: pull the canonical order row from the server on
  // mount and every syncTick increment. `order` prefers the fresh row;
  // falls back to `cachedOrder` while the fetch races. This is what
  // closes the "dates edited on web don't show in app" symptom —
  // History was already fetched fresh per-open, but the header had no
  // equivalent path and silently kept rendering whatever data.orders
  // happened to contain. See hooks/useFreshOrderHeader for rationale.
  const { order } = useFreshOrderHeader(orderId, cachedOrder, syncTick);

  // QA 241 (2026-05-12): "Lane items sometimes empty after planning".
  // The `alive` flag alone wasn't enough — when syncTick increments
  // mid-fetch (e.g. a planning batch fires several postgres_changes
  // updates), a slower earlier request could still resolve AFTER the
  // newer one and overwrite the fresh rows with stale ones. Use a
  // monotonically-increasing request id so we only accept the result
  // of the most recently issued fetch.
  useEffect(() => {
    if (!orderId || orderId === 'new') return;
    let alive = true;
    const myReq = ++lineFetchRef.current.current;
    setLinesLoading(true);
    OrdersApi.lines(orderId)
      .then((res: any) => {
        if (!alive || lineFetchRef.current.current !== myReq) return;
        setLines(Array.isArray(res) ? res : []);
      })
      .catch(() => {
        if (!alive || lineFetchRef.current.current !== myReq) return;
        setLines([]);
      })
      .finally(() => {
        if (!alive || lineFetchRef.current.current !== myReq) return;
        setLinesLoading(false);
      });
    return () => { alive = false; };
    // syncTick re-runs this effect whenever the parent order's
    // updated_at changes server-side, so a web-side line edit appears
    // in the per-line table without manual refresh.
  }, [orderId, syncTick]);

  // REQ-02 Phase 1: load change-history for this order. Soft-fails to
  // empty list — the service swallows network errors so the rest of
  // the screen renders unaffected. Re-runs when historyTick bumps OR
  // when syncTick increments (web-side edit observed via realtime).
  useEffect(() => {
    if (!orderId || orderId === 'new') {
      setHistory([]);
      return;
    }
    let alive = true;
    setHistoryLoading(true);
    loadOrderHistory(orderId, 200)
      .then((rows) => { if (alive) setHistory(rows); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [orderId, historyTick, syncTick]);

  // After any mutation (status change, copy, delete, plan) the parent
  // refreshes DataContext; we also bump the local tick so the History
  // section reloads. Wrapped so each handler can call this without
  // duplicating the setter call.
  const bumpHistory = useCallback(() => {
    setHistoryTick((t) => t + 1);
  }, []);

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
                // REQ-OFFLINE Phase 5: route through the offline-aware
                // façade. Online → identical to the pre-Phase-5
                // behaviour (PATCH /api/orders/:id with cascade +
                // audit). Offline → enqueued; replays on reconnect.
                const result = await updateOrderStatus(
                  String(id),
                  newStatus,
                  order,
                );
                await refreshData();
                bumpHistory();
                if (result.status === 'queued') {
                  Alert.alert(
                    'Queued for sync',
                    `Status change saved locally and will apply when you're back online.`,
                  );
                }
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
        bumpHistory();
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

  // QA #182: every field below is resolved by the service layer so
  // both API casings (camelCase from dbToOrder, snake_case from the
  // inline /api routes) render identically.
  const vm = buildOrderDetailViewModel(order);
  const lineVms = buildOrderLineViewModels(lines);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {vm.orderId}
          </Text>
        </View>
        <StatusBadge status={vm.status} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Card style={styles.infoCard}>
          <Text style={styles.sectionTitle}>Order Information</Text>

          <InfoRow label="Customer" value={vm.customer} />
          <InfoRow label="Origin" value={vm.origin} />
          <InfoRow label="Destination" value={vm.destination} />
          {/* QA #182: surface ship-from/to names + mode + service
              level + incoterms only when present, so unset fields
              don't push noise into the card. Renders match the
              web OrderDetailModal labels. */}
          {vm.shipFromName ? (
            <InfoRow label="Ship From" value={vm.shipFromName} />
          ) : null}
          {vm.shipToName ? (
            <InfoRow label="Ship To" value={vm.shipToName} />
          ) : null}
          {vm.shipMode ? (
            <InfoRow label="Mode" value={vm.shipMode} />
          ) : null}
          {vm.serviceLevel ? (
            <InfoRow label="Service Level" value={vm.serviceLevel} />
          ) : null}
          {vm.incoterms ? (
            <InfoRow label="Incoterms" value={vm.incoterms} />
          ) : null}
          <InfoRow label="Ready Date" value={vm.readyDate} />
          <InfoRow label="Due Date" value={vm.dueDate} />
          <InfoRow label="Weight" value={formatLbs(vm.weightLbs)} />
          <InfoRow label="Pieces" value={formatInt(vm.pieces)} />
          <InfoRow label="Commodity" value={dashIfBlank(vm.commodity)} />
          <TouchableOpacity
            disabled={!vm.shipmentId}
            activeOpacity={0.6}
            onPress={() => {
              if (vm.shipmentId) navigation.navigate('ShipmentDetail', { shipmentId: vm.shipmentId });
            }}
          >
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Shipment ID</Text>
              {vm.shipmentId ? (
                <View style={styles.shipmentLink}>
                  <Text style={styles.shipmentLinkText} numberOfLines={1}>
                    {vm.shipmentId}
                  </Text>
                  <Ionicons name="open-outline" size={14} color={colors.accent} />
                </View>
              ) : (
                <Text style={styles.infoValue}>--</Text>
              )}
            </View>
          </TouchableOpacity>
          {vm.preferredCarrier ? (
            <InfoRow label="Preferred Carrier" value={vm.preferredCarrier} />
          ) : null}
          {vm.notes ? <InfoRow label="Notes" value={vm.notes} /> : null}
        </Card>

        <Card style={styles.infoCard}>
          <Text style={styles.sectionTitle}>Order Lines</Text>
          {linesLoading ? (
            <ActivityIndicator color={colors.accent} style={styles.linesLoader} />
          ) : lineVms.length === 0 ? (
            <Text style={styles.emptyLines}>No line items</Text>
          ) : (
            lineVms.map((line, idx) => (
              <OrderLineRow
                key={line.key}
                line={line}
                isLast={idx === lineVms.length - 1}
              />
            ))
          )}
        </Card>

        {/* REQ-02 Phase 1 (mobile parity, 2026-05-10): change-history
            section. Mirrors the web OrderDetailModal History tab —
            same field labels, same per-second bucketing for "N fields
            changed" — so an order edited on web shows the same trail
            on mobile. Loader is non-blocking; the rest of the screen
            renders even if /api/orders/:id/history is unavailable. */}
        <Card style={styles.infoCard}>
          <Text style={styles.sectionTitle}>History</Text>
          <HistoryList
            entries={history}
            loading={historyLoading && history.length === 0}
            emptyLabel="No changes recorded yet."
          />
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
            // REQ-OFFLINE Phase 5: planning is server-orchestrated
            // (rates → quotes → shipment creation → cascade). Too
            // complex to queue safely; require connectivity.
            disabled={updating || !canPlanOrder(order) || !isOnline}
          />
          <ActionButton
            label="Tender"
            icon="send-outline"
            color={colors.cyan}
            onPress={() => changeStatus('Tendered')}
            // REQ-OFFLINE Phase 5: tendering hits carrier-portal APIs
            // and email sends — also server-orchestrated. Require
            // connectivity. (Plain status edits like Cancel still
            // queue via offlineOrderActions.)
            disabled={updating || !canTenderOrder(order) || !isOnline}
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

/**
 * QA #182: per-line row showing Qty, Unit Wt, and Total Wt — the same
 * three values the web's OrderLinesEditor exposes. Single-purpose
 * presentation component (CLAUDE_RULES §2). Display values come from
 * the view-model formatter so empty/zero rendering is consistent
 * across the screen.
 */
function OrderLineRow({ line, isLast }: { line: OrderLineViewModel; isLast: boolean }) {
  return (
    <View style={[styles.lineItem, !isLast && styles.lineItemBorder]}>
      <View style={styles.lineItemHeader}>
        <Text style={styles.lineItemName} numberOfLines={1}>
          {line.itemId ? `${line.itemId} — ${line.description}` : line.description}
        </Text>
        <Text style={styles.lineItemLineNum}>
          {line.lineNum != null ? `#${line.lineNum}` : ''}
        </Text>
      </View>
      <View style={styles.lineMetricsRow}>
        <LineMetric label="Qty" value={formatInt(line.qty)} />
        <LineMetric label="Unit Wt" value={formatLbs(line.unitWeightLbs)} />
        <LineMetric label="Total Wt" value={formatLbs(line.totalWeightLbs)} />
      </View>
    </View>
  );
}

function LineMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.lineMetric}>
      <Text style={styles.lineMetricLabel}>{label}</Text>
      <Text style={styles.lineMetricValue} numberOfLines={1}>
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
  lineItemLineNum: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text3 },
  // QA #182: three-up metrics row mirrors the web order-lines table
  // columns (Qty / Unit Wt / Total Wt). Each cell is a fixed third so
  // values align across rows when a line has very long descriptions.
  lineMetricsRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  lineMetric: {
    flex: 1,
  },
  lineMetricLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  lineMetricValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
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
