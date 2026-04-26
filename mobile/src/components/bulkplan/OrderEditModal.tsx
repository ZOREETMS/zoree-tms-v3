/**
 * OrderEditModal — edit a single order before bulk-planning.
 *
 * Mobile mirror of frontend/src/components/bulk-plan/OrderEditModal.jsx.
 * Trimmed to the most-edited fields (customer / lane / freight / dates /
 * notes) — line-item editing intentionally skipped. The web modal's line
 * editor is a separate component that hasn't been ported to mobile yet.
 *
 * Pure presentation + a save handler. Persistence is done via DbApi
 * inline because the order edit is the only place this is wired today;
 * if more places need it, lift into mobile/src/services/ordersService.ts.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
import { DbApi } from '../../lib/api';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const ORDER_STATUSES = [
  'Unplanned',
  'Planned',
  'Consolidated',
  'Tendered',
  'Delivered',
  'Cancelled',
];

const MODE_OPTIONS = ['', 'TL', 'LTL', 'Parcel', 'Intermodal', 'Air'];

export interface OrderEditModalProps {
  visible: boolean;
  order: any | null;
  onClose: () => void;
  /** Called after a successful save with the order id so callers can refresh. */
  onSaved?: (orderId: string) => void | Promise<void>;
}

interface FormState {
  customer: string;
  status: string;
  originCity: string;
  originState: string;
  originZip: string;
  destCity: string;
  destState: string;
  destZip: string;
  weight: string;
  pieces: string;
  shipMode: string;
  commodity: string;
  ready: string;
  due: string;
  notes: string;
}

function parseCity(str: string): { city: string; state: string; zip: string } {
  if (!str) return { city: '', state: '', zip: '' };
  let s = str;
  let zip = '';
  const m = s.match(/(\d{5})/);
  if (m) {
    zip = m[1];
    s = s.replace(m[1], '').replace(/,?\s*$/, '').trim();
  }
  const parts = s.split(',');
  return { city: (parts[0] || '').trim(), state: (parts[1] || '').trim(), zip };
}

function buildInitialForm(order: any | null): FormState {
  if (!order) {
    return {
      customer: '', status: 'Unplanned',
      originCity: '', originState: '', originZip: '',
      destCity: '', destState: '', destZip: '',
      weight: '', pieces: '', shipMode: '', commodity: '',
      ready: '', due: '', notes: '',
    };
  }
  const op = parseCity(order.origin || '');
  const dp = parseCity(order.dest || order.destination || '');
  return {
    customer: order.customer || '',
    status: order.status || 'Unplanned',
    originCity: op.city,
    originState: op.state,
    originZip: order.origin_zip || op.zip || '',
    destCity: dp.city,
    destState: dp.state,
    destZip: order.dest_zip || dp.zip || '',
    weight: order.weight != null ? String(order.weight) : '',
    pieces: order.pieces != null ? String(order.pieces) : '',
    shipMode: order.ship_mode || order.shipMode || '',
    commodity: order.commodity || '',
    ready: order.ready || order.pickup_date || order.ready_date || '',
    due: order.due || order.delivery_date || order.due_date || '',
    notes: order.notes || '',
  };
}

function buildPatch(f: FormState): Record<string, any> {
  const newOrigin = [f.originCity, f.originState?.toUpperCase()]
    .filter(Boolean)
    .join(', ') + (f.originZip ? ' ' + f.originZip : '');
  const newDest = [f.destCity, f.destState?.toUpperCase()]
    .filter(Boolean)
    .join(', ') + (f.destZip ? ' ' + f.destZip : '');

  const patch: Record<string, any> = {
    customer: f.customer || null,
    status: f.status || null,
    origin: newOrigin || null,
    dest: newDest || null,
    weight: Number(f.weight) || 0,
    pieces: Number(f.pieces) || 0,
    ship_mode: f.shipMode || null,
    commodity: f.commodity || null,
    ready: f.ready || null,
    due: f.due || null,
    notes: f.notes || null,
  };
  if (f.originZip) patch.origin_zip = f.originZip;
  if (f.destZip) patch.dest_zip = f.destZip;
  return patch;
}

export default function OrderEditModal({
  visible,
  order,
  onClose,
  onSaved,
}: OrderEditModalProps) {
  const [form, setForm] = useState<FormState>(() => buildInitialForm(order));
  const [busy, setBusy] = useState(false);

  // Re-seed when the order swaps. We avoid resetting while busy so a
  // tap on Save doesn't lose the in-flight edit.
  useEffect(() => {
    if (!busy) setForm(buildInitialForm(order));
  }, [order, busy]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const orderId = useMemo(
    () => (order ? order.id ?? order.order_id ?? '' : ''),
    [order],
  );

  async function handleSave() {
    if (!orderId) return;
    setBusy(true);
    try {
      const patch = buildPatch(form);
      await DbApi.patch('orders', orderId, patch);
      if (onSaved) await onSaved(orderId);
      onClose();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save order');
    } finally {
      setBusy(false);
    }
  }

  if (!order) return null;

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
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerLabel}>Order Details</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {orderId}
              </Text>
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
            <SectionLabel label="Order Identity" />
            <Field label="Customer" value={form.customer} onChange={(v) => set('customer', v)} />

            <Text style={styles.fieldLabel}>STATUS</Text>
            <View style={styles.chipRow}>
              {ORDER_STATUSES.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={form.status === s}
                  onPress={() => set('status', s)}
                />
              ))}
            </View>

            <SectionLabel label="Lane" />
            <Field label="Origin City" value={form.originCity} onChange={(v) => set('originCity', v)} />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="State"
                  value={form.originState}
                  onChange={(v) => set('originState', v.toUpperCase())}
                  placeholder="IL"
                  maxLength={2}
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="ZIP"
                  value={form.originZip}
                  onChange={(v) => set('originZip', v)}
                  placeholder="60601"
                  maxLength={5}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <Field label="Dest City" value={form.destCity} onChange={(v) => set('destCity', v)} />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="State"
                  value={form.destState}
                  onChange={(v) => set('destState', v.toUpperCase())}
                  placeholder="TX"
                  maxLength={2}
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="ZIP"
                  value={form.destZip}
                  onChange={(v) => set('destZip', v)}
                  placeholder="75201"
                  maxLength={5}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <SectionLabel label="Freight" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Weight (lbs)"
                  value={form.weight}
                  onChange={(v) => set('weight', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Pieces"
                  value={form.pieces}
                  onChange={(v) => set('pieces', v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                />
              </View>
            </View>
            <Text style={styles.fieldLabel}>MODE</Text>
            <View style={styles.chipRow}>
              {MODE_OPTIONS.map((m) => (
                <Chip
                  key={m || 'auto'}
                  label={m || 'Auto'}
                  active={form.shipMode === m}
                  onPress={() => set('shipMode', m)}
                />
              ))}
            </View>
            <Field label="Commodity" value={form.commodity} onChange={(v) => set('commodity', v)} />

            <SectionLabel label="Dates" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Ready Date"
                  value={form.ready}
                  onChange={(v) => set('ready', v)}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Due Date"
                  value={form.due}
                  onChange={(v) => set('due', v)}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <SectionLabel label="Notes" />
            <TextInput
              style={[styles.input, styles.textarea]}
              value={form.notes}
              onChangeText={(v) => set('notes', v)}
              multiline
              numberOfLines={3}
              placeholder="Special instructions, references..."
              placeholderTextColor={colors.text3}
            />
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
              style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
              onPress={handleSave}
              disabled={busy}
              activeOpacity={0.7}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.btnPrimaryText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── Sub-components ── */

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        maxLength={maxLength}
        keyboardType={keyboardType || 'default'}
      />
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
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
  headerTextWrap: { flex: 1 },
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
  body: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    letterSpacing: 0.5,
  },
  field: {
    marginBottom: spacing.md,
  },
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
  textarea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex1: { flex: 1 },
  chipRow: {
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
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  chipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  chipTextActive: {
    color: colors.accent,
  },
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
  btnGhost: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
});
