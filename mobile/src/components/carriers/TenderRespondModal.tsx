/**
 * TenderRespondModal — slide-up sheet for responding to a tender
 * (accept with PRO + pickup date, or reject with a reason).
 *
 * Mobile mirror of frontend/src/components/carrier-portal/TenderRespondModal.jsx.
 * Persistence + payload shape live in mobile/src/services/carrierPortalService.ts.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  extractTenderDefaults,
  saveTenderResponse,
  type TenderResponse,
} from '../../services/carrierPortalService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const REJECT_REASONS = [
  'Capacity',
  'Lane / Route',
  'Equipment',
  'Rate',
  'Hours of Service',
  'Other',
] as const;

export interface TenderRespondModalProps {
  visible: boolean;
  shipment: any | null;
  /** Linked orders for the accept-cascade. */
  orders?: any[];
  onClose: () => void;
  onResponded?: (response: TenderResponse) => void | Promise<void>;
}

type Mode = 'accept' | 'reject';

export default function TenderRespondModal({
  visible,
  shipment,
  orders,
  onClose,
  onResponded,
}: TenderRespondModalProps) {
  const [mode, setMode] = useState<Mode>('accept');
  const [proNumber, setProNumber] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [dockDoor, setDockDoor] = useState('');
  const [dockLoadStart, setDockLoadStart] = useState('');
  const [dockLoadEnd, setDockLoadEnd] = useState('');
  const [rejectReason, setRejectReason] = useState<string>('Capacity');
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset whenever modal re-opens for a new shipment. Pre-populate
  // every accept-screen field from the shipment so the carrier can
  // confirm or adjust the planner's commitments in one place.
  useEffect(() => {
    if (visible) {
      const defaults = extractTenderDefaults(shipment);
      setMode('accept');
      setProNumber('');
      setPickupDate(defaults.pickupDate);
      setDeliveryDate(defaults.deliveryDate);
      setDockDoor(defaults.dockDoor);
      setDockLoadStart(defaults.dockLoadStart);
      setDockLoadEnd(defaults.dockLoadEnd);
      setRejectReason('Capacity');
      setRejectNote('');
    }
  }, [visible, shipment]);

  if (!shipment) return null;

  async function handleSubmit() {
    if (!shipment) return;
    setBusy(true);
    try {
      const payload =
        mode === 'accept'
          ? {
              action: 'accept' as const,
              proNumber: proNumber.trim() || undefined,
              carrierPickupDate:   pickupDate    || undefined,
              carrierDeliveryDate: deliveryDate  || undefined,
              dockDoor:            dockDoor.trim()      || undefined,
              dockLoadStart:       dockLoadStart.trim() || undefined,
              dockLoadEnd:         dockLoadEnd.trim()   || undefined,
            }
          : {
              action: 'reject' as const,
              rejectReason,
              rejectNote: rejectNote.trim() || undefined,
            };
      const out = await saveTenderResponse(shipment, payload, { orders });
      if (onResponded) await onResponded(out);
      onClose();
    } catch (e: any) {
      Alert.alert('Submit failed', e?.message || 'Could not save response');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => !busy && onClose()}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerLabel}>Respond to tender</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>{shipment.id}</Text>
            </View>
            <TouchableOpacity
              onPress={() => !busy && onClose()}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              disabled={busy}
            >
              <Ionicons name="close" size={24} color={colors.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {/* Mode toggle */}
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[
                  styles.modeBtn,
                  mode === 'accept' && styles.modeBtnAccept,
                  busy && styles.disabled,
                ]}
                onPress={() => !busy && setMode('accept')}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color={mode === 'accept' ? colors.green : colors.text3}
                />
                <Text style={[
                  styles.modeText,
                  mode === 'accept' && { color: colors.green },
                ]}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeBtn,
                  mode === 'reject' && styles.modeBtnReject,
                  busy && styles.disabled,
                ]}
                onPress={() => !busy && setMode('reject')}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={mode === 'reject' ? colors.red : colors.text3}
                />
                <Text style={[
                  styles.modeText,
                  mode === 'reject' && { color: colors.red },
                ]}>Reject</Text>
              </TouchableOpacity>
            </View>

            {/* Shipment summary */}
            <View style={styles.summary}>
              <SummaryRow label="Lane" value={`${shipment.origin || '?'} → ${shipment.dest || '?'}`} />
              <SummaryRow label="Mode" value={shipment.mode || '--'} />
              <SummaryRow
                label="Weight"
                value={shipment.weight ? `${Number(shipment.weight).toLocaleString()} lb` : '--'}
              />
              <SummaryRow label="Pickup (planned)" value={shipment.pickup_date || shipment.pickupDate || '--'} />
              <SummaryRow label="Delivery (planned)" value={shipment.delivery_date || shipment.deliveryDate || '--'} />
            </View>

            {mode === 'accept' ? (
              <>
                <SectionLabel label="Carrier Confirmation" />
                <Field
                  label="PRO Number"
                  value={proNumber}
                  onChange={setProNumber}
                  placeholder="e.g. PRO-123456"
                />
                <Field
                  label="Pickup Date"
                  value={pickupDate}
                  onChange={setPickupDate}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                  hint="Pre-filled from the shipment — adjust if different."
                />
                <Field
                  label="Delivery Date"
                  value={deliveryDate}
                  onChange={setDeliveryDate}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                  hint="Pre-filled from the shipment — adjust if different."
                />

                <SectionLabel label="Dock Assignment" />
                <Field
                  label="Dock Assigned"
                  value={dockDoor}
                  onChange={setDockDoor}
                  placeholder="e.g. Door 1"
                  hint="Pre-filled from the shipment — adjust if different."
                />
                <Field
                  label="Dock Loading Start"
                  value={dockLoadStart}
                  onChange={setDockLoadStart}
                  placeholder="YYYY-MM-DD HH:mm"
                  hint="Origin loading window start."
                />
                <Field
                  label="Dock Loading End"
                  value={dockLoadEnd}
                  onChange={setDockLoadEnd}
                  placeholder="YYYY-MM-DD HH:mm"
                  hint="Origin loading window end."
                />

                {orders && orders.length > 0 ? (
                  <Text style={styles.cascadeHint}>
                    On accept, {orders.length} linked order{orders.length === 1 ? '' : 's'} will move to “Tender Accepted” and the OMS will be updated with these values.
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <SectionLabel label="Rejection Reason" />
                <View style={styles.chipRowWrap}>
                  {REJECT_REASONS.map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.chip, rejectReason === r && styles.chipActive]}
                      onPress={() => setRejectReason(r)}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.chipText,
                        rejectReason === r && styles.chipTextActive,
                      ]}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Field
                  label="Note (optional)"
                  value={rejectNote}
                  onChange={setRejectNote}
                  placeholder="Anything the planner should know"
                  multiline
                />
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => !busy && onClose()}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.btn,
                mode === 'accept' ? styles.btnAccept : styles.btnReject,
                busy && styles.btnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={busy}
              activeOpacity={0.7}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons
                    name={mode === 'accept' ? 'checkmark' : 'close'}
                    size={18}
                    color={colors.white}
                  />
                  <Text style={styles.btnPrimaryText}>
                    {mode === 'accept' ? 'Accept Tender' : 'Reject Tender'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        style={[styles.input, multiline && styles.textarea]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType={keyboardType || 'default'}
        multiline={!!multiline}
        numberOfLines={multiline ? 3 : 1}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '92%',
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
  headerLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: 2,
  },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  modeBtnAccept: { borderColor: colors.green, backgroundColor: colors.greenDim },
  modeBtnReject: { borderColor: colors.red, backgroundColor: colors.redDim },
  modeText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  disabled: { opacity: 0.6 },
  summary: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs,
    gap: spacing.md,
  },
  summaryLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    flex: 1,
  },
  summaryValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 2,
    textAlign: 'right',
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.bg2,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  fieldHint: { fontSize: fontSize.xs, color: colors.text3, marginTop: spacing.xs },
  cascadeHint: {
    fontSize: fontSize.xs,
    color: colors.text2,
    backgroundColor: colors.accentGlow,
    padding: spacing.sm,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
  },
  chipRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  chipActive: { borderColor: colors.red, backgroundColor: colors.redDim },
  chipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  chipTextActive: { color: colors.red },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg2,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btnGhostText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  btnAccept: { backgroundColor: colors.green },
  btnReject: { backgroundColor: colors.red },
  btnDisabled: { opacity: 0.7 },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
});
