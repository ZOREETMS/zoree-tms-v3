/**
 * NewShipmentModal — slide-up sheet for creating a manual shipment.
 *
 * Mobile mirror of frontend/src/components/shipments/NewShipmentModal.jsx.
 * Trimmed to the same fields the web modal exposes (ship-from / ship-to /
 * mode / carrier / equipment / freight / dates / service level / notes)
 * but uses plain city / state / zip text inputs instead of the web's
 * LocationFieldsEditor — that component pulls in TMS-search and a
 * heavier UI tree we haven't ported yet.
 *
 * Pure presentation. Persistence and validation live in shipmentService.
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
import {
  buildBlankShipment,
  createShipment,
  validateShipmentForm,
  type ShipmentFormState,
} from '../../services/shipmentService';
import { SEED_EQUIPMENT } from '../../services/rateService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const MODES = ['LTL', 'TL'] as const;
const SERVICE_LEVELS = ['Standard', 'Expedited', 'Economy', 'White Glove', 'Time-Critical'] as const;

export interface NewShipmentModalProps {
  visible: boolean;
  onClose: () => void;
  /** Carrier list for the carrier picker. Accepts {name} objects or plain strings. */
  carriers?: Array<{ name?: string } | string>;
  /** Equipment master rows; falls back to SEED_EQUIPMENT when empty. */
  equipmentTypes?: Array<{ name: string; max_weight?: number; status?: string }>;
  /** Called after a successful create with the new row so callers can refresh. */
  onCreated?: (shipment: any) => void | Promise<void>;
}

export default function NewShipmentModal({
  visible,
  onClose,
  carriers,
  equipmentTypes,
  onCreated,
}: NewShipmentModalProps) {
  const [form, setForm] = useState<ShipmentFormState>(() => buildBlankShipment());
  const [busy, setBusy] = useState(false);

  // Reset form whenever the modal is re-opened so a stale draft from
  // a cancelled session doesn't bleed into the next create.
  useEffect(() => {
    if (visible) setForm(buildBlankShipment());
  }, [visible]);

  const set = <K extends keyof ShipmentFormState>(key: K, value: ShipmentFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const carrierNames = useMemo(() => {
    if (!carriers) return [] as string[];
    return carriers
      .map((c) => (typeof c === 'string' ? c : c?.name || ''))
      .filter(Boolean);
  }, [carriers]);

  const equipmentNames = useMemo(() => {
    const source = equipmentTypes && equipmentTypes.length > 0 ? equipmentTypes : SEED_EQUIPMENT;
    return source
      .filter((eq: any) => (eq.status || 'Active') === 'Active')
      .map((eq: any) => eq.name);
  }, [equipmentTypes]);

  async function handleSubmit() {
    const v = validateShipmentForm(form);
    if (!v.ok) {
      Alert.alert('Cannot create shipment', v.error || 'Please fix the form.');
      return;
    }
    setBusy(true);
    try {
      const created = await createShipment(form);
      if (onCreated) await onCreated(created);
      onClose();
    } catch (e: any) {
      Alert.alert('Create failed', e?.message || 'Could not create shipment');
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
              <Text style={styles.headerLabel}>New</Text>
              <Text style={styles.headerTitle}>Manual Shipment</Text>
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
            <SectionLabel label="Ship From" />
            <Field
              label="Location Name"
              value={form.shipFromName}
              onChange={(v) => set('shipFromName', v)}
              placeholder="e.g. Dallas DC"
            />
            <Field
              label="City"
              value={form.originCity}
              onChange={(v) => set('originCity', v)}
              placeholder="Chicago"
            />
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

            <SectionLabel label="Ship To" />
            <Field
              label="Location Name"
              value={form.shipToName}
              onChange={(v) => set('shipToName', v)}
              placeholder="e.g. Chicago Warehouse"
            />
            <Field
              label="City"
              value={form.destCity}
              onChange={(v) => set('destCity', v)}
              placeholder="Dallas"
            />
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

            <SectionLabel label="Mode & Carrier" />
            <Text style={styles.fieldLabel}>MODE</Text>
            <View style={styles.chipRow}>
              {MODES.map((m) => (
                <Chip
                  key={m}
                  label={m}
                  active={form.mode === m}
                  onPress={() => set('mode', m)}
                />
              ))}
            </View>

            {carrierNames.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>CARRIER</Text>
                <View style={styles.chipRowWrap}>
                  {carrierNames.map((n) => (
                    <Chip
                      key={n}
                      label={n}
                      active={form.carrier === n}
                      onPress={() => set('carrier', n)}
                    />
                  ))}
                </View>
              </>
            ) : (
              <Field
                label="Carrier"
                value={form.carrier}
                onChange={(v) => set('carrier', v)}
                placeholder="e.g. Werner Enterprises"
              />
            )}

            {equipmentNames.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>EQUIPMENT</Text>
                <View style={styles.chipRowWrap}>
                  {equipmentNames.map((n) => (
                    <Chip
                      key={n}
                      label={n}
                      active={form.equipment === n}
                      onPress={() => set('equipment', n)}
                    />
                  ))}
                </View>
              </>
            ) : null}

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
              <View style={styles.flex1}>
                <Field
                  label="Cost ($)"
                  value={form.total_cost}
                  onChange={(v) => set('total_cost', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <SectionLabel label="Dates" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Pickup Date"
                  value={form.pickup_date}
                  onChange={(v) => set('pickup_date', v)}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Delivery Date"
                  value={form.delivery_date}
                  onChange={(v) => set('delivery_date', v)}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <SectionLabel label="Service Level" />
            <View style={styles.chipRowWrap}>
              {SERVICE_LEVELS.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={form.service_level === s}
                  onPress={() => set('service_level', s)}
                />
              ))}
            </View>

            <SectionLabel label="Notes" />
            <TextInput
              style={[styles.input, styles.textarea]}
              value={form.notes}
              onChangeText={(v) => set('notes', v)}
              multiline
              numberOfLines={3}
              placeholder="Any additional notes"
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
              onPress={handleSubmit}
              disabled={busy}
              activeOpacity={0.7}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="add" size={18} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>Create Shipment</Text>
                </>
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

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
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
  textarea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
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
