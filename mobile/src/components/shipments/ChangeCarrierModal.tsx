/**
 * mobile/src/components/shipments/ChangeCarrierModal.tsx
 *
 * Bottom-sheet modal for the Change Carrier flow on the Shipment
 * Detail screen. Mirrors the web Change Carrier modal:
 *
 *   - On open: fetch ranked carrier quotes for the shipment's lane
 *     (cheapest first).
 *   - User radio-selects an alternate quote.
 *   - Confirm writes the change through the audited
 *     /api/shipments/:id/change-carrier endpoint (handled by
 *     services/shipmentActionsService.confirmChangeCarrier — the
 *     fetch + persistence are NOT done here; the parent screen owns
 *     the orchestration so the modal stays a dumb renderer).
 *
 * The modal is purely presentational: it accepts `quotes`, `loading`,
 * `saving`, `currentCarrier`, and fires `onConfirm(quote)` /
 * `onClose()`.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';
import type { CarrierQuote } from '../../services/shipmentActionsService';

export interface ChangeCarrierModalProps {
  visible: boolean;
  loading: boolean;
  saving: boolean;
  shipmentId: string;
  origin: string;
  destination: string;
  weight: number;
  currentCarrier: string;
  currentCost: number;
  quotes: CarrierQuote[];
  onClose: () => void;
  onConfirm: (quote: CarrierQuote) => void;
}

function formatUSD(n: number | undefined): string {
  const v = Number(n || 0);
  return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const ChangeCarrierModal: React.FC<ChangeCarrierModalProps> = ({
  visible,
  loading,
  saving,
  shipmentId,
  origin,
  destination,
  weight,
  currentCarrier,
  currentCost,
  quotes,
  onClose,
  onConfirm,
}) => {
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Reset selection whenever a new quote list arrives so the index
  // never points outside the array bounds.
  const safeQuotes = useMemo(() => quotes || [], [quotes]);

  const selectedQuote =
    safeQuotes.length > 0 && selectedIdx < safeQuotes.length
      ? safeQuotes[selectedIdx]
      : null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Change Carrier — {shipmentId}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              disabled={saving}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={22} color={colors.text2} />
            </TouchableOpacity>
          </View>

          <View style={styles.subheader}>
            <Text style={styles.subheaderText} numberOfLines={2}>
              {(origin || '').split(',')[0]} → {(destination || '').split(',')[0]}
              {' · '}
              {Number(weight || 0).toLocaleString()} lbs
            </Text>
            <Text style={styles.subheaderText}>
              Current: <Text style={styles.bold}>{currentCarrier || 'None'}</Text>
              {'  ·  '}
              {formatUSD(currentCost)}
            </Text>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {loading ? (
              <View style={styles.placeholder}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.placeholderText}>Fetching carrier rates…</Text>
              </View>
            ) : safeQuotes.length === 0 ? (
              <View style={styles.placeholder}>
                <Text style={styles.placeholderText}>
                  No carrier quotes available for this lane.
                </Text>
              </View>
            ) : (
              safeQuotes.map((q, i) => {
                const isSelected = i === selectedIdx;
                const isCurrent = q.carrier === currentCarrier;
                return (
                  <TouchableOpacity
                    key={`${q.carrier}-${i}`}
                    onPress={() => setSelectedIdx(i)}
                    activeOpacity={0.8}
                    style={[
                      styles.quoteRow,
                      isSelected && styles.quoteRowSelected,
                      !isSelected && isCurrent && styles.quoteRowCurrent,
                    ]}
                  >
                    <View style={styles.radio}>
                      {isSelected ? (
                        <Ionicons
                          name="radio-button-on"
                          size={18}
                          color={colors.accent}
                        />
                      ) : (
                        <Ionicons
                          name="radio-button-off"
                          size={18}
                          color={colors.text3}
                        />
                      )}
                    </View>
                    <View style={styles.quoteBody}>
                      <View style={styles.quoteTitleRow}>
                        <Text
                          style={[
                            styles.quoteCarrier,
                            isSelected && styles.quoteCarrierBold,
                          ]}
                          numberOfLines={1}
                        >
                          {q.carrier}
                        </Text>
                        {q.mode ? (
                          <View
                            style={[
                              styles.modeBadge,
                              q.mode === 'LTL'
                                ? styles.modeBadgeLtl
                                : styles.modeBadgeTl,
                            ]}
                          >
                            <Text style={styles.modeBadgeText}>{q.mode}</Text>
                          </View>
                        ) : null}
                        {isCurrent ? (
                          <View style={styles.currentBadge}>
                            <Text style={styles.currentBadgeText}>CURRENT</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.quoteMetaRow}>
                        <Text style={styles.quoteMeta}>
                          {q.transitDays ? `${q.transitDays}D` : '—'}
                        </Text>
                        {q.miles ? (
                          <Text style={styles.quoteMeta}>
                            {Number(q.miles).toLocaleString()} mi
                          </Text>
                        ) : null}
                        <Text style={styles.quoteMeta}>
                          Fuel: {formatUSD(q.fscCharge)}
                        </Text>
                      </View>
                    </View>
                    <Text
                      style={[
                        styles.quoteTotal,
                        isSelected && styles.quoteTotalSelected,
                      ]}
                    >
                      {formatUSD(q.totalCharge)}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={onClose}
              disabled={saving}
              activeOpacity={0.8}
              style={[styles.footerBtn, styles.cancelBtn, saving && styles.btnDisabled]}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => selectedQuote && onConfirm(selectedQuote)}
              disabled={saving || !selectedQuote}
              activeOpacity={0.8}
              style={[
                styles.footerBtn,
                styles.confirmBtn,
                (saving || !selectedQuote) && styles.btnDisabled,
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.confirmLabel}>Confirm Change</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg2,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginRight: spacing.md,
  },
  subheader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  subheaderText: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
  },
  bold: {
    fontWeight: fontWeight.bold,
    color: colors.text2,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: spacing.lg,
  },
  placeholder: {
    alignItems: 'center',
    paddingVertical: spacing['3xl'],
    gap: spacing.sm,
  },
  placeholderText: {
    fontSize: fontSize.sm,
    color: colors.text3,
  },
  quoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.xs,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    gap: spacing.sm,
  },
  quoteRowSelected: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: colors.accentGlow,
  },
  quoteRowCurrent: {
    backgroundColor: 'rgba(59,130,246,0.04)',
  },
  radio: {
    width: 22,
    alignItems: 'center',
  },
  quoteBody: {
    flex: 1,
    minWidth: 0,
  },
  quoteTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  quoteCarrier: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  quoteCarrierBold: {
    fontWeight: fontWeight.bold,
  },
  modeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
  },
  modeBadgeLtl: {
    backgroundColor: 'rgba(8,145,178,0.12)',
  },
  modeBadgeTl: {
    backgroundColor: colors.greenDim,
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  currentBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(59,130,246,0.1)',
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: '#3B82F6',
  },
  quoteMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: 3,
  },
  quoteMeta: {
    fontSize: 11,
    color: colors.text3,
  },
  quoteTotal: {
    fontSize: fontSize.md,
    color: colors.text2,
    fontWeight: fontWeight.semibold,
  },
  quoteTotalSelected: {
    color: colors.green,
    fontWeight: fontWeight.bold,
  },
  footer: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg2,
  },
  footerBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.md,
    minHeight: 44,
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.border2,
    backgroundColor: colors.bg2,
  },
  confirmBtn: {
    backgroundColor: colors.green,
  },
  cancelLabel: {
    color: colors.text2,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.md,
  },
  confirmLabel: {
    color: colors.white,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.md,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});

export default ChangeCarrierModal;
