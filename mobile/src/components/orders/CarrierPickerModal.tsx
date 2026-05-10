/**
 * CarrierPickerModal — bottom-sheet for choosing a carrier when
 * planning a single order from OrderDetailScreen.
 *
 * Why this component exists
 * ─────────────────────────
 * Before this, OrderDetailScreen's "Plan" button silently picked the
 * cheapest carrier (`ratePlanForOrder` → `bestQuote`) and showed the
 * winner in an Alert. Users couldn't see — let alone choose — the
 * other carriers that returned a quote on the same lane. This sheet
 * fixes that UX gap by surfacing every viable carrier from
 * `rateAllCarriersForOrder` so the user can compare cost, transit,
 * and dates side-by-side before creating the shipment.
 *
 * Pure presentation: no API calls, no rating logic, no shipment writes.
 * Quotes come in from the screen; the chosen `SingleOrderCarrierQuote`
 * goes back via `onConfirm`. Plan-build + execute happens in the
 * service layer (planSingleOrderService) — see CLAUDE_RULES Rule 6.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import type { SingleOrderCarrierQuote } from '../../services/planSingleOrderService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface CarrierPickerModalProps {
  visible: boolean;
  /** All viable carrier quotes for the order (already filtered + sorted server-side). */
  quotes: SingleOrderCarrierQuote[];
  /** Display label like "ORD-2026-991550" — surfaced in the header for context. */
  orderLabel?: string;
  /** Disable the Confirm button + dim the sheet while the parent is executing. */
  busy?: boolean;
  onCancel: () => void;
  /** Fires with the chosen quote — parent calls buildPlanFromQuote + executeOrderPlan. */
  onConfirm: (quote: SingleOrderCarrierQuote) => void;
}

const fmt$ = (n: number) =>
  '$'
  + Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default function CarrierPickerModal({
  visible,
  quotes,
  orderLabel,
  busy,
  onCancel,
  onConfirm,
}: CarrierPickerModalProps) {
  // QA #180: respect the device's bottom safe-area inset (home
  // indicator on iOS, gesture bar on Android) so the Confirm /
  // Cancel buttons in the footer don't get clipped by the system UI.
  // Falls back to spacing.lg when there is no inset reported.
  const insets = useSafeAreaInsets();
  const footerBottomPad = Math.max(insets.bottom, spacing.lg);

  // Pre-select the recommended quote (or the first one) so a single
  // tap on Confirm matches what the legacy "auto-pick cheapest" flow
  // would have done. Reset whenever the sheet reopens with new data.
  const [selectedIdx, setSelectedIdx] = useState<number>(0);

  useEffect(() => {
    if (!visible) return;
    const recommendedIdx = quotes.findIndex((q) => q.recommended);
    setSelectedIdx(recommendedIdx >= 0 ? recommendedIdx : 0);
  }, [visible, quotes]);

  const selected = quotes[selectedIdx];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Choose a carrier</Text>
              {orderLabel ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {orderLabel} · {quotes.length} option{quotes.length === 1 ? '' : 's'}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={onCancel}
              style={styles.closeBtn}
              disabled={busy}
              accessibilityLabel="Close carrier picker"
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {quotes.map((q, idx) => {
              const isSelected = idx === selectedIdx;
              return (
                <TouchableOpacity
                  key={`${q.carrier}-${q.mode}-${idx}`}
                  activeOpacity={0.7}
                  disabled={busy}
                  onPress={() => setSelectedIdx(idx)}
                  style={[styles.row, isSelected && styles.rowSelected]}
                >
                  <View style={styles.rowLeft}>
                    <Ionicons
                      name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={isSelected ? colors.accent : colors.text3}
                    />
                  </View>
                  <View style={styles.rowBody}>
                    <View style={styles.rowTitleLine}>
                      <Text style={styles.carrierName} numberOfLines={1}>
                        {q.carrier}
                      </Text>
                      {q.recommended ? (
                        <Badge label="Recommended" tone="accent" />
                      ) : null}
                      {q.preferred ? (
                        <Badge label="Preferred" tone="purple" />
                      ) : null}
                    </View>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {q.mode} · {q.serviceLevel}
                      {q.transitDays != null ? ` · ${q.transitDays}d transit` : ''}
                    </Text>
                    {q.pickupDate && q.deliveryDate ? (
                      <Text style={styles.rowDates} numberOfLines={1}>
                        Pickup {q.pickupDate} → Delivery {q.deliveryDate}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.rowRight}>
                    <Text style={styles.cost}>{fmt$(q.totalCost)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: footerBottomPad }]}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={onCancel}
              disabled={busy}
            >
              <Text style={styles.btnGhostLabel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, (busy || !selected) && styles.btnDisabled]}
              onPress={() => selected && onConfirm(selected)}
              disabled={busy || !selected}
            >
              <Text style={styles.btnPrimaryLabel}>
                {busy ? 'Creating…' : 'Create shipment'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Badge({ label, tone }: { label: string; tone: 'accent' | 'purple' }) {
  const bg = tone === 'accent' ? colors.accent : colors.purple;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={styles.badgeLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '85%',
    // QA #180: bottom padding is owned by `footer` so it can be
    // safe-area-aware via useSafeAreaInsets. Keep this 0 to avoid
    // doubling the inset.
    paddingBottom: 0,
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
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  headerSubtitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    marginTop: 2,
  },
  closeBtn: { padding: spacing.xs, marginLeft: spacing.sm },
  scrollContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  rowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.bg,
  },
  rowLeft: { marginRight: spacing.sm },
  rowBody: { flex: 1 },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  carrierName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginRight: spacing.xs,
  },
  rowMeta: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: 2,
  },
  rowDates: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    marginTop: 2,
  },
  rowRight: { marginLeft: spacing.sm, alignItems: 'flex-end' },
  cost: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  badgeLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: '#fff',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostLabel: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryLabel: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: '#fff' },
  btnDisabled: { opacity: 0.5 },
});
