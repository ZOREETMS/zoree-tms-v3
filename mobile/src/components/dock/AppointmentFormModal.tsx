/**
 * AppointmentFormModal — slide-up sheet for creating or editing a
 * dock appointment.
 *
 * Mobile mirror of frontend/src/components/dock-scheduling/AppointmentEditModal.jsx.
 * Form state and persistence live in mobile/src/services/dockSchedulingService.ts.
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
  APPT_STATUSES,
  APPT_TYPES,
  DOCK_DOORS,
  DOCK_HOURS,
  DURATION_OPTIONS,
  buildAppointmentFormFromRow,
  buildBlankAppointment,
  deleteAppointment,
  saveAppointment,
  type AppointmentFormState,
} from '../../services/dockSchedulingService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface AppointmentFormModalProps {
  visible: boolean;
  appointment?: any | null;
  defaultDate?: string;
  onClose: () => void;
  onSaved?: (saved: any) => void | Promise<void>;
}

export default function AppointmentFormModal({
  visible,
  appointment,
  defaultDate,
  onClose,
  onSaved,
}: AppointmentFormModalProps) {
  const isEdit = !!(appointment && appointment.id);

  const [form, setForm] = useState<AppointmentFormState>(() =>
    isEdit ? buildAppointmentFormFromRow(appointment) : buildBlankAppointment(),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && !busy) {
      const seed = isEdit
        ? buildAppointmentFormFromRow(appointment)
        : buildBlankAppointment();
      // Honour caller-supplied default date when creating.
      if (!isEdit && defaultDate) seed.date = defaultDate;
      setForm(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, appointment, defaultDate]);

  const set = <K extends keyof AppointmentFormState>(
    key: K,
    value: AppointmentFormState[K],
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit() {
    setBusy(true);
    try {
      const saved = await saveAppointment(form);
      if (onSaved) await onSaved(saved);
      onClose();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save appointment');
    } finally {
      setBusy(false);
    }
  }

  function handleDelete() {
    if (!isEdit || !form.id) return;
    Alert.alert(
      'Delete Appointment',
      `Delete ${form.id}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteAppointment(form.id);
              if (onSaved) await onSaved({ deleted: true, id: form.id });
              onClose();
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message || 'Could not delete appointment');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
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
              <Text style={styles.headerLabel}>{isEdit ? 'Edit' : 'New'}</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {isEdit ? form.id : 'Dock Appointment'}
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
            <Text style={styles.fieldLabel}>TYPE</Text>
            <View style={styles.chipRow}>
              {APPT_TYPES.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  active={form.type === t}
                  onPress={() => set('type', t)}
                />
              ))}
            </View>

            <Text style={styles.fieldLabel}>DOOR</Text>
            <View style={styles.chipRowWrap}>
              {DOCK_DOORS.map((d) => (
                <Chip
                  key={d}
                  label={d}
                  active={form.door === d}
                  onPress={() => set('door', d)}
                />
              ))}
            </View>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Date"
                  value={form.date}
                  onChange={(v) => set('date', v)}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                  required
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>START TIME</Text>
            <View style={styles.chipRowWrap}>
              {DOCK_HOURS.map((h) => (
                <Chip
                  key={h}
                  label={h}
                  active={form.start === h}
                  onPress={() => set('start', h)}
                />
              ))}
            </View>

            <Text style={styles.fieldLabel}>DURATION</Text>
            <View style={styles.chipRowWrap}>
              {DURATION_OPTIONS.map((opt) => (
                <Chip
                  key={String(opt.value)}
                  label={opt.label}
                  active={String(form.duration) === String(opt.value)}
                  onPress={() => set('duration', String(opt.value))}
                />
              ))}
            </View>

            <Field
              label="Carrier"
              value={form.carrier}
              onChange={(v) => set('carrier', v)}
              placeholder="e.g. JB Hunt"
            />
            <Field
              label="Shipment Ref"
              value={form.shipmentId}
              onChange={(v) => set('shipmentId', v)}
              placeholder="SHP-2026-1234"
            />

            <Text style={styles.fieldLabel}>STATUS</Text>
            <View style={styles.chipRowWrap}>
              {APPT_STATUSES.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={form.status === s}
                  onPress={() => set('status', s)}
                />
              ))}
            </View>

            <Field
              label="Notes"
              value={form.notes}
              onChange={(v) => set('notes', v)}
              placeholder="Special instructions, contact name, etc."
              multiline
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
            {isEdit ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnDanger, busy && styles.btnDisabled]}
                onPress={handleDelete}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={18} color={colors.red} />
                <Text style={styles.btnDangerText}>Delete</Text>
              </TouchableOpacity>
            ) : null}
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
                  <Ionicons name="save-outline" size={18} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>{isEdit ? 'Save' : 'Create'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label.toUpperCase()}
        {required ? ' *' : ''}
      </Text>
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
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
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
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentGlow },
  chipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  chipTextActive: { color: colors.accent },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
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
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  btnDanger: { borderWidth: 1, borderColor: colors.redDim, backgroundColor: 'transparent' },
  btnDangerText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.red },
  btnDisabled: { opacity: 0.7 },
});
