/**
 * OrderEditModal — edit a single order before bulk-planning.
 *
 * Mobile mirror of frontend/src/components/bulk-plan/OrderEditModal.jsx.
 * Trimmed to the most-edited fields (customer / lane / freight / dates /
 * notes) — line-item editing intentionally skipped. The web modal's line
 * editor is a separate component that hasn't been ported to mobile yet.
 *
 * History (QA bug #92, "DB update failed (400)"):
 *   - Previously this saved via `DbApi.patch('orders', id, patch)` →
 *     /api/db/orders/:id → raw PostgREST update. That path sends the
 *     body straight to Supabase, so a status value like 'Consolidated'
 *     (which our local list contained but the DB constraint
 *     `chk_orders_status_controlled` does NOT) bounced as a 400 with
 *     no useful context. It also bypassed REQ-02 change-history.
 *   - Now we call `OrdersApi.update`, which routes through the
 *     service-layer endpoint (PATCH /api/orders/:id). That endpoint
 *     normalises camelCase + snake_case via `apiOrderToDbPatch` and
 *     records per-field history diffs server-side.
 *   - We also import the canonical ORDER_STATUSES list from
 *     shared/constants so we can never re-introduce a status value
 *     the DB doesn't accept.
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
import { OrdersApi } from '../../lib/api';
import { ORDER_STATUSES, SHIP_MODES } from '../../shared/constants/orderConstants';
import { useData } from '../../state/DataContext';
import { customerOptions, locationOptions } from '../../services/optionsService';
import SelectField from '../common/SelectField';
import DateField from '../common/DateField';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

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
  origin: string;
  originZip: string;
  destination: string;
  destZip: string;
  weight: string;
  pieces: string;
  shipMode: string;
  commodity: string;
  readyDate: string;
  dueDate: string;
  notes: string;
}

/**
 * Hydrate the form from whichever shape the order arrived in.
 *
 * Bulk-plan rows go through GET /api/orders → dbToOrderApi (camelCase
 * keys: `destination`, `originZip`, `readyDate`, etc), but historic
 * call sites — and the OMS push path — sometimes hand us the
 * snake_case row directly. Read both, prefer camelCase, fall back to
 * snake_case so we don't render a half-blank modal on legacy callers.
 */
function buildInitialForm(order: any | null): FormState {
  if (!order) {
    return {
      customer: '',
      status: 'Unplanned',
      origin: '',
      originZip: '',
      destination: '',
      destZip: '',
      weight: '',
      pieces: '',
      shipMode: '',
      commodity: '',
      readyDate: '',
      dueDate: '',
      notes: '',
    };
  }
  return {
    customer: order.customer || '',
    status: order.status || 'Unplanned',
    origin: order.origin || '',
    originZip: order.originZip || order.origin_zip || '',
    destination: order.destination || order.dest || '',
    destZip: order.destZip || order.dest_zip || '',
    weight: order.weight != null ? String(order.weight) : '',
    pieces: order.pieces != null ? String(order.pieces) : '',
    shipMode: order.shipMode || order.ship_mode || '',
    commodity: order.commodity || '',
    readyDate: order.readyDate || order.ready || '',
    dueDate: order.dueDate || order.due || '',
    notes: order.notes || '',
  };
}

/**
 * Convert form state → camelCase patch payload accepted by
 * OrdersApi.update. We keep this as a pure function so the test suite
 * can assert the shape without mocking network calls.
 *
 * Numbers coerce to 0 on empty/non-numeric input so the orders.weight
 * NOT NULL column is never sent NaN.
 */
function buildPatch(f: FormState): Record<string, any> {
  return {
    customer: f.customer || null,
    status: f.status || null,
    origin: f.origin || null,
    destination: f.destination || null,
    originZip: f.originZip || null,
    destZip: f.destZip || null,
    weight: Number(f.weight) || 0,
    pieces: parseInt(f.pieces, 10) || 0,
    shipMode: f.shipMode || null,
    commodity: f.commodity || null,
    readyDate: f.readyDate || null,
    dueDate: f.dueDate || null,
    notes: f.notes || null,
  };
}

export default function OrderEditModal({
  visible,
  order,
  onClose,
  onSaved,
}: OrderEditModalProps) {
  const { data } = useData();
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

  // Dropdown sources are the same as OrderFormScreen's, so pickers
  // behave the same way regardless of which entry point the user took
  // to edit an order.
  const customers = useMemo(() => customerOptions(data.orders), [data.orders]);
  const locations = useMemo(() => locationOptions(data.locations), [data.locations]);

  async function handleSave() {
    if (!orderId) return;
    setBusy(true);
    try {
      const patch = buildPatch(form);
      // OrdersApi.update → PATCH /api/orders/:id (service-layer
      // endpoint). This does NOT include 'Consolidated' as a valid
      // status (it's not in chk_orders_status_controlled), and the
      // server records change-history field diffs (REQ-02).
      await OrdersApi.update(orderId, patch);
      if (onSaved) await onSaved(orderId);
      onClose();
    } catch (e: any) {
      const raw = String(e?.message || 'Could not save order');
      const isNetwork = /Network request failed|Failed to fetch|TypeError: Network/i.test(raw);
      Alert.alert(
        isNetwork ? 'Cannot reach server' : 'Save failed',
        isNetwork
          ? 'The app could not reach the TMS API. Check your Wi-Fi, then verify the API base URL in Settings.'
          : raw,
      );
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
            <SelectField
              label="Customer"
              value={form.customer}
              onChange={(v) => set('customer', v)}
              options={customers}
              placeholder="Select or type a customer"
              modalTitle="Select Customer"
            />

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
            <SelectField
              label="Origin"
              value={form.origin}
              onChange={(v) => set('origin', v)}
              options={locations}
              placeholder="City, ST ZIP"
              modalTitle="Select Origin"
            />
            <Field
              label="Origin ZIP"
              value={form.originZip}
              onChange={(v) => set('originZip', v.replace(/[^0-9]/g, ''))}
              placeholder="60601"
              maxLength={5}
              keyboardType="numeric"
            />
            <SelectField
              label="Destination"
              value={form.destination}
              onChange={(v) => set('destination', v)}
              options={locations}
              placeholder="City, ST ZIP"
              modalTitle="Select Destination"
            />
            <Field
              label="Destination ZIP"
              value={form.destZip}
              onChange={(v) => set('destZip', v.replace(/[^0-9]/g, ''))}
              placeholder="75201"
              maxLength={5}
              keyboardType="numeric"
            />

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
              {SHIP_MODES.map((m) => (
                <Chip
                  key={m || 'none'}
                  label={m || 'None'}
                  active={form.shipMode === m}
                  onPress={() => set('shipMode', m)}
                />
              ))}
            </View>
            <Field
              label="Commodity"
              value={form.commodity}
              onChange={(v) => set('commodity', v)}
            />

            <SectionLabel label="Dates" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <DateField
                  label="Ready Date"
                  value={form.readyDate}
                  onChange={(v) => set('readyDate', v)}
                  modalTitle="Pick Ready Date"
                />
              </View>
              <View style={styles.flex1}>
                <DateField
                  label="Due Date"
                  value={form.dueDate}
                  onChange={(v) => set('dueDate', v)}
                  modalTitle="Pick Due Date"
                  min={form.readyDate || undefined}
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
