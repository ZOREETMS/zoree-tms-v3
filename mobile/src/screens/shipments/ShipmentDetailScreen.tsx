import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';

import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import ShipmentActionFooter from '../../components/shipments/ShipmentActionFooter';
import ChangeCarrierModal from '../../components/shipments/ChangeCarrierModal';
import { useData } from '../../state/DataContext';
// Mobile parity (2026-05-11): the Shipment Detail screen now exposes the
// full web action footer (Tender / Withdraw / Change Carrier / Dock /
// Invoice / Documents / Contact Carrier / Send to WMS). Each handler
// is owned by the service layer so the screen stays a dumb renderer
// (CLAUDE_RULES §1 / §3 / §4). The previous single "Send Tender Email"
// button has been replaced by the new ShipmentActionFooter component.
import {
  tenderShipment,
  withdrawTender as withdrawTenderAction,
  acceptTender as acceptTenderAction,
  rejectTender as rejectTenderAction,
  fetchChangeCarrierQuotes,
  confirmChangeCarrier as confirmChangeCarrierAction,
  createInvoiceFromShipment,
  type CarrierQuote,
} from '../../services/shipmentActionsService';
// effectiveShipmentStatus mirrors the web's gate logic so the footer
// shows the same buttons for the same status (e.g. promotes a Tendered
// shipment with an accept-in-notes response to "Tender Accepted").
import { effectiveShipmentStatus } from '../../services/carrierPortalService';
// QA #181: `updateShipmentStatus` is intentionally NOT imported here.
// The mobile detail screen no longer exposes a manual status flip —
// status changes must flow through events (tender accept/reject, BOL
// capture, delivery confirmation) so the audit trail stays intact.
// The service export still exists for event-driven callers.
import {
  copyShipment,
  deleteShipmentById,
} from '../../services/shipmentService';
// QA bug #128 — shipment Detail must show the full-precision cost (e.g.
// "$6,961.00") so it matches the web TMS view of the same shipment.
// Previously used the K/M-abbreviating `formatCurrency`.
import { formatCurrencyFull } from '../../shared/utils/formatters';
// QA bug #168 — full field-parity with the web Shipment Details modal.
// Derivation + async loaders live in the service; this screen is a
// dumb renderer (CLAUDE_RULES §1, §3, §4).
import {
  buildShipmentDetailViewModel,
  derivePhaseTimestamps,
  formatTimelineTs,
  loadShipmentHistoryBundle,
  loadShipmentLines,
  type ShipmentDetailViewModel,
  type ShipmentHistoryRow,
  type ShipmentLineRow,
  type TimelinePhase,
} from '../../services/shipmentDetailService';
// QA (2026-05-16): the shipment Change History card now reuses the shared
// HistoryList renderer (already in use on the mobile OrderDetail screen) so
// timestamps, user attribution, and field-change descriptions render
// correctly. Previously the card read raw column names off the camelCase
// shape and rendered everything as "—".
import HistoryList from '../../components/history/HistoryList';
import type { OrderHistoryEntry } from '../../services/orderHistoryService';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';
import type { PlanningTabParamList } from '../../navigation/types';

type DetailRoute = RouteProp<PlanningTabParamList, 'ShipmentDetail'>;

// QA #181: STATUS_FLOW used to drive a row of "Update Status" buttons
// at the bottom of this screen. Those buttons let the user flip
// shipment status without firing the corresponding events, which
// broke the audit trail and the order-side cascade. The buttons —
// and STATUS_FLOW itself — were removed. Status displays come from
// `vm.status` (set by upstream events); the timeline still renders
// from change_history rows, so the visible state is unchanged.

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatWeight(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Number(value).toLocaleString()} lbs`;
}

function dashIfEmpty(value: string | null | undefined): string {
  if (value == null) return '—';
  const s = String(value).trim();
  return s.length ? s : '—';
}

/* ── Field row renderers ─────────────────────────────────────────── */

function FieldCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={styles.fieldCell}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.fieldGrid}>{children}</View>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

/* ── Timeline rung ─────────────────────────────────────────────────── */

interface TimelineEvent {
  phase: TimelinePhase;
  label: string;
  done: boolean;
  time: string;
}

function buildTimelineEvents(
  vm: ShipmentDetailViewModel,
  historyRows: ShipmentHistoryRow[],
  shipment: any,
): TimelineEvent[] {
  const phases = derivePhaseTimestamps(historyRows);

  const phaseLine = (
    phase: TimelinePhase,
    fallbackTsRaw: string | null | undefined,
    doneFallback: string,
  ): string => {
    const fromHistory = formatTimelineTs(phases[phase]);
    if (fromHistory) return fromHistory;
    const fromRow = formatTimelineTs(fallbackTsRaw);
    return fromRow || doneFallback;
  };

  const status = vm.status;
  const isTendered = status !== 'Planned' && status !== 'Tender Rejected';
  const isTenderAccepted = ['Confirmed', 'Tender Accepted', 'In Transit', 'Delivered'].includes(status);
  const isPickedUp = ['In Transit', 'Delivered', 'Exception'].includes(status);
  const isInTransit = ['In Transit', 'Delivered'].includes(status);
  const isDelivered = status === 'Delivered';

  return [
    { phase: 'created',   label: 'Shipment Created & Rate Confirmed', done: true,         time: phaseLine('created', shipment?.created_at, 'Confirmed') },
    { phase: 'tendered',  label: 'Tendered to Carrier',               done: isTendered,    time: isTendered       ? phaseLine('tendered', shipment?.tendered_at, 'Confirmed') : 'Pending' },
    { phase: 'accepted',  label: 'Tender Accepted',                   done: isTenderAccepted, time: isTenderAccepted ? phaseLine('accepted', null, 'Confirmed')              : 'Pending' },
    { phase: 'pickedUp',  label: 'Picked Up',                         done: isPickedUp,    time: isPickedUp       ? phaseLine('pickedUp', shipment?.shipped_at, 'Confirmed') : 'Pending' },
    { phase: 'inTransit', label: 'In Transit',                        done: isInTransit,   time: isInTransit      ? phaseLine('inTransit', shipment?.shipped_at, 'En route') : 'Pending' },
    { phase: 'delivered', label: 'Delivered',                         done: isDelivered,   time: isDelivered      ? phaseLine('delivered', shipment?.delivered_at, 'Confirmed') : 'Pending' },
  ];
}

/* ── Screen ────────────────────────────────────────────────────────── */

export default function ShipmentDetailScreen() {
  // Cross-tab navigation (Dock schedule / Documents / Messaging / Finance)
  // requires reaching the root drawer navigator. `useNavigation<any>()`
  // matches how the Dashboard quick-action buttons do it — typing the
  // cross-tab routes properly would need a CompositeNavigationProp chain
  // for every drawer, which we've avoided elsewhere.
  const navigation = useNavigation<any>();
  const route = useRoute<DetailRoute>();
  const { shipmentId } = route.params;
  const { data, refreshData } = useData() as any;

  const [mutating, setMutating] = useState(false);
  const [lines, setLines] = useState<ShipmentLineRow[]>([]);
  const [linesLoading, setLinesLoading] = useState(true);
  const [historyRows, setHistoryRows] = useState<ShipmentHistoryRow[]>([]);
  const [historyEntries, setHistoryEntries] = useState<OrderHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Tracks which footer button (if any) currently owns the spinner.
  // Used so the user sees feedback on the *button they tapped* rather
  // than a generic top-of-screen loader; matches the web's per-action
  // disabled state.
  const [busyAction, setBusyAction] = useState<
    | 'tender'
    | 'withdraw'
    | 'accept'
    | 'reject'
    | 'changeCarrier'
    | 'invoice'
    | 'dock'
    | 'documents'
    | 'contact'
    | 'wms'
    | null
  >(null);

  // Change-carrier modal state. Quotes / loading / saving are derived
  // here rather than in the modal so the same fetch result is reused
  // across re-opens within the session.
  const [changeCarrierOpen, setChangeCarrierOpen] = useState(false);
  const [carrierQuotes, setCarrierQuotes] = useState<CarrierQuote[]>([]);
  const [carrierQuotesLoading, setCarrierQuotesLoading] = useState(false);
  const [carrierChangeSaving, setCarrierChangeSaving] = useState(false);

  const shipment = useMemo(
    () =>
      data.shipments.find(
        (s: any) =>
          String(s.id || s.shipment_id || s.shipmentId) === String(shipmentId),
      ),
    [data.shipments, shipmentId],
  );

  const vm = useMemo<ShipmentDetailViewModel | null>(() => {
    if (!shipment) return null;
    return buildShipmentDetailViewModel(shipment, data.rates || [], data.orders || []);
  }, [shipment, data.rates, data.orders]);

  // QA bug #168: load line items + history on mount and whenever the
  // shipment id changes. Both are best-effort — failures soft-fall to
  // empty arrays so the screen still renders.
  useEffect(() => {
    if (!shipment) return;
    let cancelled = false;
    setLinesLoading(true);
    loadShipmentLines(shipment, data.orders || [])
      .then((rows) => { if (!cancelled) { setLines(rows); setLinesLoading(false); } })
      .catch(() => { if (!cancelled) { setLines([]); setLinesLoading(false); } });
    return () => { cancelled = true; };
  }, [shipment, data.orders]);

  useEffect(() => {
    const id = shipment?.id || shipment?.shipment_id;
    if (!id) return;
    let cancelled = false;
    setHistoryLoading(true);
    // One API call → both the timeline-derivation shape AND the bucketed
    // entries shape the HistoryList renderer consumes.
    loadShipmentHistoryBundle(String(id))
      .then((bundle) => {
        if (cancelled) return;
        setHistoryRows(bundle.rows);
        setHistoryEntries(bundle.entries);
        setHistoryLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setHistoryRows([]);
        setHistoryEntries([]);
        setHistoryLoading(false);
      });
    return () => { cancelled = true; };
  }, [shipment]);

  /* ── Footer action handlers ───────────────────────────────────────
   *
   * Every handler delegates the actual work to the service layer
   * (services/shipmentActionsService) and limits this screen to:
   *   - flipping the per-button busy flag,
   *   - surfacing the result Alert,
   *   - kicking off a refresh so the timeline / status badge reflects
   *     the new state without a manual pull-to-refresh.
   */

  const handleTender = useCallback(async () => {
    if (!shipment || !vm) return;
    setBusyAction('tender');
    try {
      const result = await tenderShipment({
        vm,
        shipment,
        carriers: data.carriers || [],
      });
      if (refreshData) await refreshData();
      Alert.alert(result.ok ? 'Tender Sent' : 'Tender', result.message);
    } finally {
      setBusyAction(null);
    }
  }, [shipment, vm, data.carriers, refreshData]);

  const handleWithdraw = useCallback(() => {
    if (!shipment) return;
    Alert.alert(
      'Withdraw Tender',
      `Withdraw tender for ${shipment.id || shipment.shipment_id}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'destructive',
          onPress: async () => {
            setBusyAction('withdraw');
            try {
              const result = await withdrawTenderAction({
                shipment,
                shipments: data.shipments || [],
              });
              if (refreshData) await refreshData();
              Alert.alert(
                result.ok ? 'Tender Withdrawn' : 'Withdraw Failed',
                result.message,
              );
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
    );
  }, [shipment, data.shipments, refreshData]);

  // QA 240 (2026-05-12): Accept / Reject the active tender. Both
  // delegate to the service layer; the parent screen only flips the
  // busy flag, surfaces the result, and triggers a refresh.
  const handleAccept = useCallback(() => {
    if (!shipment) return;
    Alert.alert(
      'Accept Tender',
      `Accept the tender for ${shipment.id || shipment.shipment_id}? The shipment will move to "Tender Accepted".`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept',
          onPress: async () => {
            setBusyAction('accept');
            try {
              // Pass shipments + orders so the in-TMS accept can run the
              // MBOL->CBOL order cascade and the OMS oms_orders mirror
              // (oms_orders stage -> 6) without a refetch. Required to
              // flip the OMS warehouse modals off "Awaiting TMS Plan"
              // - see shipmentActionsService.acceptTender for the full
              // three-step rationale.
              const result = await acceptTenderAction({
                shipment,
                shipments: data.shipments || [],
                orders:    data.orders    || [],
              });
              if (refreshData) await refreshData();
              Alert.alert(result.ok ? 'Tender Accepted' : 'Accept Failed', result.message);
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
    );
  }, [shipment, data.shipments, data.orders, refreshData]);

  const handleReject = useCallback(() => {
    if (!shipment) return;
    Alert.alert(
      'Reject Tender',
      `Reject the tender for ${shipment.id || shipment.shipment_id}? The shipment will move to "Tender Rejected" and the carrier will need to be re-tendered or changed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setBusyAction('reject');
            try {
              const result = await rejectTenderAction({ shipment });
              if (refreshData) await refreshData();
              Alert.alert(result.ok ? 'Tender Rejected' : 'Reject Failed', result.message);
            } finally {
              setBusyAction(null);
            }
          },
        },
      ],
    );
  }, [shipment, refreshData]);

  const handleOpenChangeCarrier = useCallback(async () => {
    if (!shipment) return;
    setChangeCarrierOpen(true);
    setCarrierQuotesLoading(true);
    try {
      const quotes = await fetchChangeCarrierQuotes(shipment);
      setCarrierQuotes(quotes);
    } finally {
      setCarrierQuotesLoading(false);
    }
  }, [shipment]);

  const handleConfirmChangeCarrier = useCallback(
    async (quote: CarrierQuote) => {
      if (!shipment) return;
      setCarrierChangeSaving(true);
      try {
        const result = await confirmChangeCarrierAction({ shipment, quote });
        if (refreshData) await refreshData();
        setChangeCarrierOpen(false);
        Alert.alert(
          result.ok ? 'Carrier Changed' : 'Change Failed',
          result.message,
        );
      } finally {
        setCarrierChangeSaving(false);
      }
    },
    [shipment, refreshData],
  );

  const handleInvoice = useCallback(async () => {
    if (!shipment) return;
    const id = shipment.id || shipment.shipment_id;
    setBusyAction('invoice');
    try {
      const result = await createInvoiceFromShipment(String(id));
      // Web parity: the web sends the planner to /freight-invoices?invoice=
      // after a successful one-click invoice create. Mobile currently
      // registers the list screen (`FreightInvoices`) but not a detail
      // route, so the "View Invoices" action lands on the list — the
      // newly-created invoice surfaces at the top because the list is
      // sorted by recency. When InvoiceDetailScreen lands, swap the
      // navigate target to { screen: 'InvoiceDetail', params: {...} }.
      Alert.alert(
        result.ok ? 'Invoice Created' : 'Invoice',
        result.message,
        result.ok
          ? [
              { text: 'Stay', style: 'cancel' },
              {
                text: 'View Invoices',
                onPress: () =>
                  navigation.navigate('FinanceTab', {
                    screen: 'FreightInvoices',
                  }),
              },
            ]
          : undefined,
      );
    } finally {
      setBusyAction(null);
    }
  }, [shipment, navigation]);

  const handleDockSchedule = useCallback(() => {
    navigation.navigate('ExecutionTab', { screen: 'DockScheduling' });
  }, [navigation]);

  const handleDocuments = useCallback(() => {
    // Web passes ?shipmentId=… in the URL so the Documents page can
    // pre-filter. Mobile's DocumentsScreen does not currently support
    // a `shipmentId` route param (see navigation/types DocumentsTabParamList),
    // so we land on the unfiltered list. Adding a param + filter is a
    // separate follow-up — wired the navigation now so the button at
    // least lands the user on the right screen.
    navigation.navigate('DocumentsTab', { screen: 'Documents' });
  }, [navigation]);

  const handleContactCarrier = useCallback(() => {
    navigation.navigate('IntegrationTab', { screen: 'MessagingHub' });
  }, [navigation]);

  const handleSendToWms = useCallback(() => {
    // Web parity: REQ-18 routes Send-to-WMS through the messaging surface
    // (the carrier-portal acknowledgement path posts the WMS push event
    // there). Mobile follows the same target until a dedicated WMS
    // outbox screen exists.
    navigation.navigate('IntegrationTab', { screen: 'MessagingHub' });
  }, [navigation]);

  /**
   * QA bug #100 fix: previously the copy succeeded silently and the
   * user was bounced back to the list with no feedback, leading them
   * to retry-tap and create accidental duplicates. We now hold on the
   * detail screen until the user dismisses a success Alert that
   * surfaces the new shipment id, then navigate back. The new id is
   * read from copyShipment's return value (the freshly-built row),
   * with a defensive fallback if the service ever changes its shape.
   */
  const handleCopy = useCallback(() => {
    if (!shipment) return;
    Alert.alert(
      'Copy Shipment',
      `Create a copy of "${shipment.id || shipment.shipment_id}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: async () => {
            setMutating(true);
            try {
              const created = await copyShipment(shipment);
              if (refreshData) await refreshData();
              const newId =
                created?.id ||
                created?.shipment_id ||
                created?.shipmentId ||
                '';
              Alert.alert(
                'Shipment copied',
                newId
                  ? `Shipment copied successfully\n${newId}`
                  : 'Shipment copied successfully.',
                [{ text: 'OK', onPress: () => navigation.goBack() }],
                { cancelable: false },
              );
            } catch (e: any) {
              Alert.alert('Copy failed', e?.message || 'Could not copy shipment');
            } finally {
              setMutating(false);
            }
          },
        },
      ],
    );
  }, [shipment, refreshData, navigation]);

  const handleDelete = useCallback(() => {
    if (!shipment) return;
    const id = shipment.id || shipment.shipment_id || shipment.shipmentId;
    Alert.alert(
      'Delete Shipment',
      `Permanently delete "${id}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setMutating(true);
            try {
              await deleteShipmentById(String(id));
              if (refreshData) await refreshData();
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message || 'Could not delete shipment');
            } finally {
              setMutating(false);
            }
          },
        },
      ],
    );
  }, [shipment, refreshData, navigation]);

  // QA #181: `handleStatusUpdate` was removed alongside the manual
  // status-button row. Re-introduce only via an event-driven path
  // (tender accept, delivery confirmation, etc.) — never as a free-
  // form button on this screen.

  if (!shipment || !vm) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>Shipment not found.</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const equipmentLabel = vm.equipmentSource === 'rate' ? 'Equipment (from rate)' : 'Equipment';
  const discountLabel = vm.discount.hasDiscount
    ? `Discount (${vm.discount.pct}%${vm.discount.flat ? ` + $${vm.discount.flat}` : ''})`
    : 'Discount';
  const fscLabel = vm.fscPct ? `Fuel Surcharge (${vm.fscPct})` : 'Fuel Surcharge';
  const baseLabel = vm.cost.baseIsDerived ? 'Base / Linehaul (derived)' : 'Base / Linehaul';
  const accessorialsValue = vm.cost.accessorials > 0
    ? formatCurrencyFull(vm.cost.accessorials)
    : '$0 (none billed)';
  const discountValue = vm.discount.hasDiscount
    ? `− ${formatCurrencyFull(vm.discount.amount)}`
    : 'No discount applied';

  const timelineEvents = buildTimelineEvents(vm, historyRows, shipment);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {vm.id}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleCopy}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={mutating}
            style={mutating ? { opacity: 0.4 } : undefined}
          >
            <Ionicons
              name="copy-outline"
              size={22}
              color={mutating ? colors.text3 : colors.text2}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={mutating}
            style={mutating ? { opacity: 0.4 } : undefined}
          >
            <Ionicons
              name="trash-outline"
              size={22}
              color={mutating ? colors.text3 : colors.red}
            />
          </TouchableOpacity>
          <StatusBadge status={vm.status} />
        </View>
      </View>
      {mutating ? (
        <View style={styles.headerSpinner}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* Route / addresses */}
        <Card style={styles.infoCard}>
          <Text style={styles.cardLabel}>Route</Text>
          <View style={styles.routeRow}>
            <View style={styles.routePoint}>
              <Ionicons name="location-outline" size={18} color={colors.accent} />
              <View style={styles.routeInfo}>
                <Text style={styles.routeLabel}>
                  {vm.shipFromName ? vm.shipFromName : 'Origin'}
                </Text>
                <Text style={styles.routeValue}>{vm.origin}</Text>
              </View>
            </View>
            <Ionicons
              name="arrow-forward"
              size={18}
              color={colors.text3}
              style={styles.routeArrow}
            />
            <View style={styles.routePoint}>
              <Ionicons name="location-outline" size={18} color={colors.green} />
              <View style={styles.routeInfo}>
                <Text style={styles.routeLabel}>
                  {vm.shipToName ? vm.shipToName : 'Destination'}
                </Text>
                <Text style={styles.routeValue}>{vm.destination}</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Core shipment fields — mirrors the web modal's 3-column grid. */}
        <Card style={styles.infoCard}>
          <FieldGrid>
            <FieldCell label="Status"   value={vm.status} />
            <FieldCell label="Carrier"  value={vm.carrier} />
            <FieldCell label="Mode"     value={dashIfEmpty(vm.mode)} />
            <FieldCell label={equipmentLabel} value={vm.equipment} />
            <FieldCell label="Weight"   value={formatWeight(vm.weight)} />
            <FieldCell label="Pieces"   value={vm.pieces != null ? Number(vm.pieces).toLocaleString() : '—'} />
            <FieldCell label="Commodity" value={dashIfEmpty(vm.commodity)} />
            <FieldCell
              label="Rate ID"
              value={
                vm.rateId
                  ? <Text style={styles.linkValue}>{vm.rateId}</Text>
                  : '—'
              }
            />
            <FieldCell label="Service Level" value={dashIfEmpty(vm.serviceLevel)} />
          </FieldGrid>
        </Card>

        {/* Cost breakdown */}
        <Card style={styles.infoCard}>
          <SectionHeader>Cost Breakdown</SectionHeader>
          <FieldGrid>
            <FieldCell label={baseLabel}       value={formatCurrencyFull(vm.cost.base)} />
            <FieldCell label={discountLabel}   value={discountValue} />
            <FieldCell label={fscLabel}        value={formatCurrencyFull(vm.cost.fuel)} />
            <FieldCell label="Accessorials"    value={accessorialsValue} />
            <FieldCell
              label="Est. Cost (Total)"
              value={
                <Text style={styles.costValue}>
                  {formatCurrencyFull(vm.cost.total)}
                </Text>
              }
            />
          </FieldGrid>
        </Card>

        {/* Schedule + IDs */}
        <Card style={styles.infoCard}>
          <SectionHeader>Schedule</SectionHeader>
          <FieldGrid>
            <FieldCell label="Pickup Date"   value={formatDate(vm.pickupDate)} />
            <FieldCell label="Delivery Date" value={formatDate(vm.deliveryDate)} />
            <FieldCell label="Transit Days"  value={vm.transitDays} />
            <FieldCell label="PRO Number"    value={dashIfEmpty(vm.proNumber)} />
            <FieldCell label="BOL / Carrier Ref" value={dashIfEmpty(vm.bolNumber)} />
            <FieldCell label="Seal Number"   value={dashIfEmpty(vm.sealNumber)} />
          </FieldGrid>
        </Card>

        {/* Dock / loading window */}
        <Card style={styles.infoCard}>
          <SectionHeader>Dock & Loading</SectionHeader>
          <FieldGrid>
            <FieldCell label="Dock Door"     value={dashIfEmpty(vm.dockDoor)} />
            <FieldCell label="Dock Time"     value={dashIfEmpty(vm.dockTime)} />
            <FieldCell label="Loading Start" value={formatDateTime(vm.loadingStart)} />
            <FieldCell label="Loading End"   value={formatDateTime(vm.loadingEnd)} />
          </FieldGrid>
        </Card>

        {/* Linked Orders / Releases.
            Web parity (frontend/src/pages/ShipmentsPage.jsx — the
            "Consolidated Orders (N)" / "Associated Order" block):
            shipments roll up one or more order releases, and the
            planner needs to see which orders are on a shipment and
            drill into them. `vm.linkedOrders` is already populated by
            buildShipmentDetailViewModel → findLinkedOrders (prefers
            shipment.order_ids, falls back to o.shipment_id === ship.id),
            so this card is purely render — CLAUDE_RULES §1/§3/§4
            (services-first; dumb renderer). Tap navigates to the
            OrderDetail screen registered on PlanningTabs. */}
        {vm.linkedOrders && vm.linkedOrders.length > 0 ? (
          <Card style={styles.infoCard}>
            <SectionHeader>
              {vm.linkedOrders.length > 1
                ? `Consolidated Orders (${vm.linkedOrders.length})`
                : 'Associated Order'}
            </SectionHeader>
            {vm.linkedOrders.map((o: any, idx: number) => {
              const orderId = String(o.id || o.order_id || '');
              const originCity = String(o.origin || '').split(',')[0];
              const destCity = String(o.dest || o.destination || '').split(',')[0];
              const wt = Number(o.weight || 0);
              const isLast = idx === vm.linkedOrders.length - 1;
              return (
                <TouchableOpacity
                  key={orderId || `linked-${idx}`}
                  activeOpacity={0.7}
                  onPress={() =>
                    navigation.navigate('OrderDetail', { orderId })
                  }
                  style={[
                    styles.linkedOrderRow,
                    isLast ? styles.linkedOrderRowLast : null,
                  ]}>
                  <View style={styles.linkedOrderTop}>
                    <Text style={styles.linkedOrderId} numberOfLines={1}>
                      {orderId || '—'}
                    </Text>
                    <Text style={styles.linkedOrderWeight}>
                      {wt.toLocaleString()} lbs
                    </Text>
                  </View>
                  <Text style={styles.linkedOrderMeta} numberOfLines={1}>
                    {dashIfEmpty(o.customer)}
                    {o.commodity ? ` · ${o.commodity}` : ''}
                  </Text>
                  <Text style={styles.linkedOrderRoute} numberOfLines={1}>
                    {originCity || '—'} → {destCity || '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </Card>
        ) : null}

        {/* Line Items */}
        <Card style={styles.infoCard}>
          <SectionHeader>Line Items</SectionHeader>
          {linesLoading ? (
            <Text style={styles.placeholderText}>Loading…</Text>
          ) : lines.length === 0 ? (
            <Text style={styles.placeholderText}>No line items</Text>
          ) : (
            <View style={styles.linesTable}>
              <View style={[styles.lineRow, styles.lineHeaderRow]}>
                <Text style={[styles.lineCol, styles.lineColOrder, styles.lineHeaderText]}>Order</Text>
                <Text style={[styles.lineCol, styles.lineColItem,  styles.lineHeaderText]}>Item</Text>
                <Text style={[styles.lineCol, styles.lineColDesc,  styles.lineHeaderText]}>Description</Text>
                <Text style={[styles.lineCol, styles.lineColNum,   styles.lineHeaderText, styles.alignRight]}>Qty</Text>
                <Text style={[styles.lineCol, styles.lineColNum,   styles.lineHeaderText, styles.alignRight]}>Wt</Text>
              </View>
              {lines.map((l, idx) => (
                <View key={`${l.order_id}-${l.item_id}-${idx}`} style={styles.lineRow}>
                  <Text style={[styles.lineCol, styles.lineColOrder, styles.lineMono]} numberOfLines={1}>{l.order_id || '—'}</Text>
                  <Text style={[styles.lineCol, styles.lineColItem,  styles.lineMono]} numberOfLines={1}>{l.item_id || '—'}</Text>
                  <Text style={[styles.lineCol, styles.lineColDesc]} numberOfLines={2}>{l.description || '—'}</Text>
                  <Text style={[styles.lineCol, styles.lineColNum, styles.alignRight]}>{l.qty || 0}</Text>
                  <Text style={[styles.lineCol, styles.lineColNum, styles.alignRight]}>{l.totalWeight || 0}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Shipment Timeline */}
        <Card style={styles.infoCard}>
          <SectionHeader>Shipment Timeline</SectionHeader>
          {historyLoading ? (
            <Text style={styles.placeholderText}>Loading…</Text>
          ) : (
            <View style={styles.timeline}>
              {timelineEvents.map((evt) => (
                <View key={evt.phase} style={styles.timelineRow}>
                  <View
                    style={[
                      styles.timelineDot,
                      evt.done ? styles.timelineDotDone : styles.timelineDotPending,
                    ]}
                  />
                  <View style={styles.timelineBody}>
                    <Text
                      style={[
                        styles.timelineLabel,
                        evt.done ? styles.timelineLabelDone : styles.timelineLabelPending,
                      ]}
                    >
                      {evt.label}
                    </Text>
                    <Text style={styles.timelineTime}>{evt.time}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* QA 238 (2026-05-12): "Shipment Change History section is missing
            on mobile". The Timeline section above shows high-level phase
            transitions; this section shows the per-field audit trail.
            QA (2026-05-16): switched from a hand-rolled renderer that read
            raw column names off the camelCase shape (so old/new values and
            timestamps came back undefined → rendered as "—" / blank) to
            the shared HistoryList component. HistoryList consumes the
            bucketed OrderHistoryEntry[] (same shape the OrderDetail
            History tab uses) so an edit of N fields in the same second
            collapses to one "N fields changed" entry with proper
            FIELD_LABELS — matching web. */}
        <Card style={styles.infoCard}>
          <SectionHeader>Change History</SectionHeader>
          <HistoryList
            entries={historyEntries.slice(0, 50)}
            loading={historyLoading}
            emptyLabel="No change history"
          />
          {!historyLoading && historyEntries.length > 50 ? (
            <Text style={{ fontSize: 10, color: colors.text3, marginTop: 6 }}>
              Showing the 50 most recent of {historyEntries.length} changes.
            </Text>
          ) : null}
        </Card>

        {/* Notes (optional) */}
        {vm.notes ? (
          <Card style={styles.infoCard}>
            <SectionHeader>Notes</SectionHeader>
            <Text style={styles.notesText}>{vm.notes}</Text>
          </Card>
        ) : null}

        {/* Action footer — mirrors the web Shipment Details modal.
            Visibility of each button is driven off `effectiveShipmentStatus`
            (which promotes Tendered+accept-in-notes to "Tender Accepted")
            so mobile and web show identical CTAs for the same row. */}
        <ShipmentActionFooter
          status={effectiveShipmentStatus(shipment)}
          busy={busyAction !== null}
          busyAction={busyAction}
          onTender={handleTender}
          onWithdraw={handleWithdraw}
          onAccept={handleAccept}
          onReject={handleReject}
          onChangeCarrier={handleOpenChangeCarrier}
          onDockSchedule={handleDockSchedule}
          onInvoice={handleInvoice}
          onDocuments={handleDocuments}
          onContactCarrier={handleContactCarrier}
          onSendToWms={handleSendToWms}
        />

        {/* QA #181: manual "Update Status" buttons removed. Status
            transitions now flow exclusively through events (tender
            accept/reject, BOL capture, delivery confirmation) so the
            change_history audit and the order-side cascade remain
            authoritative. The footer's Tender to Carrier button is the
            valid trigger for moving Planned → Tendered. */}
      </ScrollView>

      {/* Change Carrier bottom-sheet modal. Quotes are fetched on open
          via the actions service; persistence runs through the audited
          /api/shipments/:id/change-carrier endpoint so connected web
          tabs refresh via SHIPMENT_UPDATED. */}
      <ChangeCarrierModal
        visible={changeCarrierOpen}
        loading={carrierQuotesLoading}
        saving={carrierChangeSaving}
        shipmentId={vm.id}
        origin={vm.origin}
        destination={vm.destination}
        weight={Number(vm.weight || 0)}
        currentCarrier={vm.carrier && vm.carrier !== '—' ? vm.carrier : ''}
        currentCost={Number(shipment.total_cost || 0)}
        quotes={carrierQuotes}
        onClose={() => setChangeCarrierOpen(false)}
        onConfirm={handleConfirmChangeCarrier}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing['3xl'] },
  notFoundText: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text, marginBottom: spacing.md },
  backLink: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.accent },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg2,
  },
  headerTitle: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerSpinner: {
    paddingVertical: spacing.xs,
    alignItems: 'center',
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing['5xl'] },
  infoCard: { marginBottom: spacing.md },
  cardLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  routePoint: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  routeInfo: { marginLeft: spacing.sm, flex: 1 },
  routeLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.regular, color: colors.text3 },
  routeValue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  routeArrow: { marginHorizontal: spacing.sm },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.xs,
  },
  fieldCell: {
    width: '50%',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  linkValue: { color: colors.accent, fontWeight: fontWeight.semibold },
  costValue: { color: colors.green, fontWeight: fontWeight.bold, fontSize: fontSize.md },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  placeholderText: {
    fontSize: fontSize.sm,
    color: colors.text3,
    fontStyle: 'italic',
  },
  linesTable: { marginTop: spacing.xs },
  lineRow: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineHeaderRow: { backgroundColor: colors.bg3 },
  lineCol: {
    fontSize: fontSize.xs,
    color: colors.text2,
    paddingHorizontal: spacing.xs,
  },
  lineColOrder: { flex: 1.4 },
  lineColItem:  { flex: 1.0 },
  lineColDesc:  { flex: 2.0 },
  lineColNum:   { flex: 0.8 },
  lineHeaderText: {
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    textTransform: 'uppercase',
  },
  lineMono: { fontFamily: 'monospace' as any, color: colors.accent },
  alignRight: { textAlign: 'right' },
  timeline: { marginTop: spacing.xs },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    marginRight: spacing.sm,
  },
  timelineDotDone: { backgroundColor: colors.green },
  timelineDotPending: { backgroundColor: colors.border2 },
  timelineBody: { flex: 1 },
  timelineLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  timelineLabelDone: { color: colors.text },
  timelineLabelPending: { color: colors.text3 },
  timelineTime: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 1,
  },
  notesText: {
    fontSize: fontSize.sm,
    color: colors.text2,
    lineHeight: 20,
  },
  // Linked Orders / Releases card — rows mirror the web's per-order
  // strip (id · customer · commodity · origin → dest · weight). The
  // whole row is the tap target so reaching the order detail doesn't
  // require pinpointing the id. The trailing-row variant drops its
  // border so the card doesn't end on a double rule.
  linkedOrderRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  linkedOrderRowLast: {
    borderBottomWidth: 0,
  },
  linkedOrderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  linkedOrderId: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
    fontFamily: 'monospace' as any,
    flex: 1,
    marginRight: spacing.sm,
  },
  linkedOrderWeight: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    fontFamily: 'monospace' as any,
  },
  linkedOrderMeta: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginBottom: 2,
  },
  linkedOrderRoute: {
    fontSize: fontSize.xs,
    color: colors.text3,
  },
  // Mobile parity (2026-05-11): tenderButton / tenderButtonText were
  // removed alongside the single "Send Tender Email" CTA. The new
  // ShipmentActionFooter component owns its own styling so the screen
  // stays a thin renderer. QA #181 note still applies: any future
  // status-flip UI must run through events, not direct buttons here.
});
