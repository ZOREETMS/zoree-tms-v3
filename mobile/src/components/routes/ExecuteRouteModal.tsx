/**
 * ExecuteRouteModal — bottom-sheet for executing a multi-stop route
 * template against a set of unplanned orders.
 *
 * Mobile mirror of frontend/src/components/multi-stop/ExecuteRouteModal.jsx.
 *
 * The heavy lifting (CBOL pair construction, pro-rata cost split, cascade
 * payload, mutation) all lives in services/routeService.ts and is shared
 * with web parity tests. This component is purely presentational + the
 * assignment state machine.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  autoAssignOrders,
  buildCbolPairs,
  buildRouteExecutionPlan,
  executeRoute,
  getCbolCost,
  type CbolPair,
} from '../../services/routeService';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

const fmt$ = (n: number) =>
  '$'
  + Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export interface ExecuteRouteModalProps {
  visible: boolean;
  /** Route template selected for execution. Must include `stops`. */
  route: any | null;
  /** All orders from DataContext — modal picks `Unplanned` ones itself. */
  orders: any[];
  onClose: () => void;
  onSuccess?: (masterId: string, childCount: number) => void | Promise<void>;
}

export default function ExecuteRouteModal({
  visible,
  route,
  orders,
  onClose,
  onSuccess,
}: ExecuteRouteModalProps) {
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [costOverrides, setCostOverrides] = useState<Record<string, string>>({});
  const [autoAssigned, setAutoAssigned] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');

  // Reset internal state every time the modal opens with a new route.
  useEffect(() => {
    if (!visible) return;
    setAssignments({});
    setCostOverrides({});
    setAutoAssigned(false);
    setError('');
  }, [visible, route?.id]);

  const stops: any[] = Array.isArray(route?.stops) ? route.stops : [];
  const pairs: CbolPair[] = useMemo(() => buildCbolPairs(stops), [stops]);
  const totalLegMiles = useMemo(
    () => pairs.reduce((s, p) => s + p.legMiles, 0),
    [pairs],
  );
  const totalRouteCost = parseFloat(String(route?.cost_override || 0)) || 0;

  const unplannedOrders = useMemo(
    () => (orders || []).filter((o: any) => o.status === 'Unplanned'),
    [orders],
  );

  // Auto-match orders → CBOLs once the modal is open and we have data.
  useEffect(() => {
    if (
      !visible
      || autoAssigned
      || pairs.length === 0
      || unplannedOrders.length === 0
    ) {
      return;
    }
    const next = autoAssignOrders(pairs, unplannedOrders);
    if (Object.keys(next).length > 0) {
      setAssignments(next);
    }
    setAutoAssigned(true);
  }, [visible, pairs, unplannedOrders, autoAssigned]);

  function getAssignmentFor(orderId: string): string | null {
    for (const [k, ids] of Object.entries(assignments)) {
      if (ids.includes(orderId)) return k;
    }
    return null;
  }

  function toggleOrder(cbolKey: string, orderId: string) {
    setAssignments((prev) => {
      // Strip the order from any other CBOL first (an order can only
      // ride on one CBOL).
      const next: Record<string, string[]> = {};
      for (const [k, ids] of Object.entries(prev)) {
        next[k] = ids.filter((id) => id !== orderId);
      }
      const current = prev[cbolKey] || [];
      if (current.includes(orderId)) return next;
      next[cbolKey] = [...(next[cbolKey] || []), orderId];
      return next;
    });
  }

  function cbolCostFor(pair: CbolPair): number {
    return getCbolCost(pair, totalLegMiles, totalRouteCost, costOverrides[pair.key]);
  }

  const totalAssigned = Object.values(assignments).flat().length;
  const filledCbols = pairs.filter((p) => (assignments[p.key] || []).length > 0).length;
  const totalAssignedCost = pairs.reduce((s, p) => s + cbolCostFor(p), 0);

  async function onExecute() {
    if (!route) return;
    if (totalAssigned === 0) {
      setError('Assign at least one order to a shipment.');
      return;
    }
    setError('');
    setExecuting(true);
    try {
      const plan = buildRouteExecutionPlan(
        route,
        unplannedOrders,
        assignments,
        costOverrides,
      );
      const result = await executeRoute(plan);
      if (onSuccess) await onSuccess(result.masterId, result.childCount);
      Alert.alert(
        'Route Executed',
        `Created MBOL ${result.masterId} with ${result.childCount} CBOL(s).`,
      );
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Execute failed.');
    } finally {
      setExecuting(false);
    }
  }

  if (!route) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.flex1}>
              <Text style={styles.eyebrow}>EXECUTE MULTI-STOP ROUTE</Text>
              <Text style={styles.title} numberOfLines={1}>
                {route.name || route.id}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            {error ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color={colors.red} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Route summary */}
            <View style={styles.summary}>
              <SummaryItem label="Carrier" value={route.carrier || '—'} />
              <SummaryItem label="Mode" value={route.mode || 'TL'} />
              <SummaryItem
                label="Total Miles"
                value={
                  (route.total_miles || totalLegMiles)
                    ? `${(route.total_miles || totalLegMiles).toLocaleString()} mi`
                    : '—'
                }
              />
              <SummaryItem
                label="MBOL Cost"
                value={fmt$(totalRouteCost)}
                tint={colors.green}
              />
            </View>

            <Text style={styles.sectionTitle}>Shipment Structure</Text>
            <Text style={styles.sectionSub}>
              MBOL (master) + {pairs.length} CBOL(s) — cost split pro-rata by leg miles
            </Text>

            {pairs.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="git-branch-outline" size={28} color={colors.text3} />
                <Text style={styles.emptyText}>
                  This route has no valid pickup → delivery pairs. Edit the route to
                  add stops.
                </Text>
              </View>
            ) : (
              pairs.map((pair) => (
                <CbolCard
                  key={pair.key}
                  pair={pair}
                  cbolCost={cbolCostFor(pair)}
                  totalLegMiles={totalLegMiles}
                  totalRouteCost={totalRouteCost}
                  assignedIds={assignments[pair.key] || []}
                  costOverride={costOverrides[pair.key] ?? ''}
                  onCostOverrideChange={(value) =>
                    setCostOverrides((prev) => ({ ...prev, [pair.key]: value }))
                  }
                  unplannedOrders={unplannedOrders}
                  getAssignmentFor={getAssignmentFor}
                  onToggleOrder={toggleOrder}
                />
              ))
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerSummary} numberOfLines={1}>
              {totalAssigned} order(s) · {filledCbols} CBOL(s) ·{' '}
              {fmt$(totalAssignedCost)}
            </Text>
            <View style={styles.footerActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary]}
                onPress={onClose}
                disabled={executing}
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  (executing || totalAssigned === 0) && styles.btnDisabled,
                ]}
                onPress={onExecute}
                disabled={executing || totalAssigned === 0}
              >
                {executing ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Execute Route</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── Sub-components ────────────────────────────────────────────────── */

function SummaryItem({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint?: string;
}) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.summaryValue, tint ? { color: tint } : null]}>
        {value}
      </Text>
    </View>
  );
}

interface CbolCardProps {
  pair: CbolPair;
  cbolCost: number;
  totalLegMiles: number;
  totalRouteCost: number;
  assignedIds: string[];
  costOverride: string;
  onCostOverrideChange: (value: string) => void;
  unplannedOrders: any[];
  getAssignmentFor: (orderId: string) => string | null;
  onToggleOrder: (cbolKey: string, orderId: string) => void;
}

function CbolCard({
  pair,
  cbolCost,
  totalLegMiles,
  totalRouteCost,
  assignedIds,
  costOverride,
  onCostOverrideChange,
  unplannedOrders,
  getAssignmentFor,
  onToggleOrder,
}: CbolCardProps) {
  const pickupLabel = pair.pickup.city && pair.pickup.state
    ? `${pair.pickup.city}, ${pair.pickup.state}`
    : pair.pickup.location || `Stop ${pair.stopFrom}`;
  const delivLabel = pair.delivery.city && pair.delivery.state
    ? `${pair.delivery.city}, ${pair.delivery.state}`
    : pair.delivery.location || `Stop ${pair.stopTo}`;
  const pctOfTotal = totalRouteCost > 0
    ? Math.round((cbolCost / totalRouteCost) * 100)
    : 0;
  const isOverride = costOverride !== '' && costOverride !== undefined;

  return (
    <View style={styles.cbolCard}>
      <View style={styles.cbolHeader}>
        <View style={styles.cbolHeaderLeft}>
          <View style={styles.cbolBadge}>
            <Text style={styles.cbolBadgeText}>CBOL</Text>
          </View>
          <Text style={styles.cbolKey}>.{pair.stopFrom}.{pair.stopTo}</Text>
        </View>
        <Text style={styles.cbolMiles}>
          {pair.legMiles.toLocaleString()} mi · {pctOfTotal}%
        </Text>
      </View>

      <Text style={styles.cbolLane} numberOfLines={2}>
        {pickupLabel}  →  {delivLabel}
      </Text>

      {/* Cost row with override */}
      <View style={styles.cbolCostRow}>
        <Text style={styles.cbolCostLabel}>COST</Text>
        <Text style={styles.cbolCostValue}>{fmt$(cbolCost)}</Text>
        <Text style={styles.cbolCostHint}>
          {isOverride
            ? '(manual)'
            : `(${pair.legMiles}/${totalLegMiles} mi)`}
        </Text>
        <TextInput
          value={costOverride}
          onChangeText={onCostOverrideChange}
          placeholder="Override"
          placeholderTextColor={colors.text3}
          keyboardType="decimal-pad"
          style={styles.cbolCostInput}
        />
      </View>

      {/* Order assignment */}
      <Text style={styles.assignTitle}>
        Assign Orders ({assignedIds.length})
      </Text>
      {unplannedOrders.length === 0 ? (
        <Text style={styles.noOrders}>No unplanned orders</Text>
      ) : (
        unplannedOrders.map((order: any) => {
          const currentAssignment = getAssignmentFor(order.id);
          const isAssigned = currentAssignment === pair.key;
          const assignedElsewhere = !!currentAssignment && currentAssignment !== pair.key;

          return (
            <TouchableOpacity
              key={order.id}
              style={[
                styles.orderRow,
                isAssigned && styles.orderRowAssigned,
                assignedElsewhere && styles.orderRowDimmed,
              ]}
              onPress={() => onToggleOrder(pair.key, order.id)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isAssigned ? 'checkbox' : 'square-outline'}
                size={18}
                color={isAssigned ? colors.accent : colors.text3}
              />
              <Text style={styles.orderId} numberOfLines={1}>{order.id}</Text>
              <Text style={styles.orderCustomer} numberOfLines={1}>
                {order.customer || '—'}
              </Text>
              <Text style={styles.orderWeight}>
                {(parseFloat(order.weight) || 0).toLocaleString()} lbs
              </Text>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  flex1: { flex: 1 },
  eyebrow: {
    fontSize: 10,
    color: colors.text3,
    letterSpacing: 1,
    fontWeight: fontWeight.semibold,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: 2,
  },
  body: { flex: 1 },
  bodyContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: borderRadius.md,
  },
  errorText: { color: colors.red, fontSize: fontSize.sm, flex: 1 },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  summaryItem: { flex: 1, minWidth: '40%' },
  summaryLabel: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionSub: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.text3,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  cbolCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.bg2,
  },
  cbolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  cbolHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cbolBadge: {
    backgroundColor: 'rgba(37,99,235,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  cbolBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  cbolKey: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  cbolMiles: { fontSize: fontSize.xs, color: colors.text3 },
  cbolLane: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginBottom: spacing.sm,
  },
  cbolCostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: borderRadius.sm,
    marginBottom: spacing.sm,
  },
  cbolCostLabel: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
  },
  cbolCostValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.green,
  },
  cbolCostHint: {
    fontSize: 10,
    color: colors.text3,
    flex: 1,
  },
  cbolCostInput: {
    width: 84,
    height: 30,
    paddingHorizontal: 8,
    fontSize: fontSize.xs,
    color: colors.text,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    textAlign: 'center',
  },
  assignTitle: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  noOrders: {
    fontSize: fontSize.xs,
    color: colors.text3,
    fontStyle: 'italic',
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  orderRowAssigned: { backgroundColor: 'rgba(37,99,235,0.06)' },
  orderRowDimmed: { opacity: 0.4 },
  orderId: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
    minWidth: 90,
  },
  orderCustomer: {
    fontSize: fontSize.xs,
    color: colors.text2,
    flex: 1,
  },
  orderWeight: { fontSize: fontSize.xs, color: colors.text3 },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg2,
    gap: spacing.sm,
  },
  footerSummary: {
    fontSize: fontSize.xs,
    color: colors.text3,
  },
  footerActions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
  btnSecondary: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  btnDisabled: { opacity: 0.5 },
});
