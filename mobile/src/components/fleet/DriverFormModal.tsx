/**
 * DriverFormModal — slide-up sheet for creating or editing a driver.
 *
 * Mobile mirror of frontend/src/components/fleet/DriverModal.jsx.
 * Form state and persistence live in mobile/src/services/fleetService.ts.
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
  CDL_CLASSES,
  DRIVER_ENDORSEMENTS,
  DRIVER_STATUSES,
  buildBlankDriver,
  buildDriverFormFromRow,
  saveDriver,
  type DriverFormState,
} from '../../services/fleetService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface DriverFormModalProps {
  visible: boolean;
  driver?: any | null;
  onClose: () => void;
  onSaved?: (driver: any) => void | Promise<void>;
}

export default function DriverFormModal({
  visible,
  driver,
  onClose,
  onSaved,
}: DriverFormModalProps) {
  const isEdit = !!(driver && driver.id);

  const [form, setForm] = useState<DriverFormState>(() =>
    isEdit ? buildDriverFormFromRow(driver) : buildBlankDriver(),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && !busy) {
      setForm(isEdit ? buildDriverFormFromRow(driver) : buildBlankDriver());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, driver]);

  const set = <K extends keyof DriverFormState>(key: K, value: DriverFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleEndorsement = (e: string) =>
    setForm((prev) => {
      const has = prev.endorsements.includes(e);
      return {
        ...prev,
        endorsements: has
          ? prev.endorsements.filter((x) => x !== e)
          : [...prev.endorsements, e],
      };
    });

  async function handleSubmit() {
    setBusy(true);
    try {
      const saved = await saveDriver(form, !isEdit);
      if (onSaved) await onSaved(saved);
      onClose();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save driver');
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
              <Text style={styles.headerLabel}>{isEdit ? 'Edit' : 'New'}</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {form.name || form.id || 'Driver'}
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
            <SectionLabel label="Identity" />
            <Field
              label="Driver ID"
              value={form.id}
              onChange={(v) => set('id', v)}
              editable={!isEdit}
              hint={isEdit ? 'Cannot change once created.' : undefined}
            />
            <Field label="Full Name" value={form.name} onChange={(v) => set('name', v)} />

            <SectionLabel label="License" />
            <Field
              label="CDL Number"
              value={form.cdl}
              onChange={(v) => set('cdl', v)}
              placeholder="CDL-IL-1234567"
            />
            <Text style={styles.fieldLabel}>CLASS</Text>
            <View style={styles.chipRow}>
              {CDL_CLASSES.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={form.cdlClass === c}
                  onPress={() => set('cdlClass', c)}
                />
              ))}
            </View>

            <Text style={styles.fieldLabel}>ENDORSEMENTS</Text>
            <View style={styles.chipRowWrap}>
              {DRIVER_ENDORSEMENTS.map((e) => (
                <Chip
                  key={e}
                  label={e}
                  active={form.endorsements.includes(e)}
                  onPress={() => toggleEndorsement(e)}
                />
              ))}
            </View>

            <SectionLabel label="Assignment" />
            <Field
              label="Assigned Vehicle"
              value={form.vehicle}
              onChange={(v) => set('vehicle', v)}
              placeholder="TRK-101"
            />
            <Field
              label="Current Location"
              value={form.location}
              onChange={(v) => set('location', v)}
              placeholder="Chicago, IL"
            />
            <Text style={styles.fieldLabel}>STATUS</Text>
            <View style={styles.chipRow}>
              {DRIVER_STATUSES.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={form.status === s}
                  onPress={() => set('status', s)}
                />
              ))}
            </View>
            <Field
              label="HOS Today (hours)"
              value={form.hosToday}
              onChange={(v) => set('hosToday', v.replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
            />

            <SectionLabel label="Contact" />
            <Field label="Phone" value={form.phone} onChange={(v) => set('phone', v)} />
            <Field label="Email" value={form.email} onChange={(v) => set('email', v)} />
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
                  <Ionicons name="save-outline" size={18} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>{isEdit ? 'Save Changes' : 'Create Driver'}</Text>
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  editable = true,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  editable?: boolean;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        editable={editable}
        keyboardType={keyboardType || 'default'}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
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
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
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
  inputDisabled: { backgroundColor: colors.bg, color: colors.text3 },
  hint: { fontSize: fontSize.xs, color: colors.text3, marginTop: spacing.xs },
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
  btnPrimary: { backgroundColor: colors.accent },
  btnDisabled: { opacity: 0.7 },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
});
