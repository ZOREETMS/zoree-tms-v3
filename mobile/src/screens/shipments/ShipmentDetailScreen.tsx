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
import { useData } from '../../state/DataContext';
import { TenderApi } from '../../lib/api';
import {
  copyShipment,
  deleteShipmentById,
  updateShipmentStatus,
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
  loadShipmentHistory,
  loadShipmentLines,
  type ShipmentDetailViewModel,
  type ShipmentHistoryRow,
  type ShipmentLineRow,
  type TimelinePhase,
} from '../../services/shipmentDetailService';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';
import type { PlanningTabParamList } from '../../navigation/types';

type DetailRoute = RouteProp<PlanningTabParamList, 'ShipmentDetail'>;

/**
 * QA bug #63 fix: align mobile's status flow with the canonical enum
 * the API enforces. The previous list contained "Picked Up", which
 * the server rejected with a 400.
 *
 * Note (2026-05-05): the QA report on #63 has been deferred pending
 * a decision on whether 'Picked Up' should become a first-class
 * shipment status. The shipment-lifecycle design doc currently
 * treats it as order-only, with the timeline event mapping directly
 * to 'In Transit' (see api/services/shipmentEvents.js EVENT_MAP).
 */
const STATUS_FLOW = ['Planned', 'Tendered', 'Confirmed', 'In Transit', 'Delivered'] as const;

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
  const navigation = useNavigation();
  const route = useRoute<DetailRoute>();
  const { shipmentId } = route.params;
  const { data, refreshData } = useData() as any;

  const [tenderLoading, setTenderLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [lines, setLines] = useState<ShipmentLineRow[]>([]);
  const [linesLoading, setLinesLoading] = useState(true);
  const [historyRows, setHistoryRows] = useState<ShipmentHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

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
    loadShipmentHistory(String(id))
      .then((rows) => { if (!cancelled) { setHistoryRows(rows); setHistoryLoading(false); } })
      .catch(() => { if (!cancelled) { setHistoryRows([]); setHistoryLoading(false); } });
    return () => { cancelled = true; };
  }, [shipment]);

  const handleTender = useCallback(async () => {
    if (!shipment || !vm) return;
    setTenderLoading(true);
    try {
      await TenderApi.sendEmail({
        shipmentId: String(vm.id),
        carrierName: vm.carrier,
        origin: vm.origin,
        // QA bug #55: include `dest` (the actual DB column) in the
        // fallback chain. View model already resolves it.
        destination: vm.destination,
        pickupDate: vm.pickupDate || '',
        deliveryDate: vm.deliveryDate || '',
      });
      Alert.alert('Tender Sent', `Tender email sent for shipment ${vm.id}.`);
    } catch (err: any) {
      Alert.alert('Tender Failed', err.message || 'Could not send tender email.');
    } finally {
      setTenderLoading(false);
    }
  }, [shipment, vm]);

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

  /**
   * QA bug #63 fix: previously this only mutated local state - the
   * API was never called. Now we patch through /api/shipments/:id/status
   * (which validates against the canonical enum + cascades to linked
   * orders via shipmentEvents) and refresh the data layer.
   */
  const handleStatusUpdate = useCallback(
    async (newStatus: string) => {
      if (!shipment || mutating) return;
      const key = String(
        shipment.id || shipment.shipment_id || shipment.shipmentId || '',
      );
      if (!key) return;
      setMutating(true);
      try {
        await updateShipmentStatus(key, newStatus);
        if (refreshData) await refreshData();
      } catch (e: any) {
        Alert.alert('Status update failed', e?.message || 'Could not update status');
      } finally {
        setMutating(false);
      }
    },
    [shipment, mutating, refreshData],
  );

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

  const currentStatusIndex = STATUS_FLOW.indexOf(vm.status as any);
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

        {/* Notes (optional) */}
        {vm.notes ? (
          <Card style={styles.infoCard}>
            <SectionHeader>Notes</SectionHeader>
            <Text style={styles.notesText}>{vm.notes}</Text>
          </Card>
        ) : null}

        <TouchableOpacity
          style={styles.tenderButton}
          activeOpacity={0.8}
          onPress={handleTender}
          disabled={tenderLoading}>
          {tenderLoading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="send-outline" size={18} color={colors.white} />
              <Text style={styles.tenderButtonText}>Send Tender Email</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Update Status</Text>
        <View style={styles.statusButtonsRow}>
          {STATUS_FLOW.map((s, i) => {
            const isCurrent = s === vm.status;
            const isPast = i < currentStatusIndex;
            return (
              <TouchableOpacity
                key={s}
                style={[
                  styles.statusButton,
                  isCurrent && styles.statusButtonCurrent,
                  isPast && styles.statusButtonPast,
                ]}
                activeOpacity={0.7}
                disabled={isCurrent || mutating}
                onPress={() => handleStatusUpdate(s)}>
                <Text
                  style={[
                    styles.statusButtonLabel,
                    isCurrent && styles.statusButtonLabelCurrent,
                    isPast && styles.statusButtonLabelPast,
                  ]}
                  numberOfLines={1}>
                  {s}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
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
  tenderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  tenderButtonText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.white },
  statusButtonsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  statusButtonCurrent: { backgroundColor: colors.accent, borderColor: colors.accent },
  statusButtonPast: { backgroundColor: colors.bg3, borderColor: colors.border2 },
  statusButtonLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text2 },
  statusButtonLabelCurrent: { color: colors.white, fontWeight: fontWeight.semibold },
  statusButtonLabelPast: { color: colors.text3 },
});
