/**
 * EquipmentFormModal — slide-up sheet for creating or editing an
 * equipment master row (trailer types).
 *
 * Mobile mirror of frontend/src/components/equipment/EquipmentModal.jsx.
 * Form state and persistence live in mobile/src/services/equipmentService.ts.
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
  EQUIPMENT_STATUSES,
  buildBlankEquipment,
  buildEquipmentFormFromRow,
  saveEquipment,
  type EquipmentFormState,
} from '../../services/equipmentService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface EquipmentFormModalProps {
  visible: boolean;
  equipment?: any | null;
  onClose: () => void;
  onSaved?: (saved: any) => void | Promise<void>;
}

export default function EquipmentFormModal({
  visible,
  equipment,
  onClose,
  onSaved,
}: EquipmentFormModalProps) {
  const isEdit = !!(equipment && equipment.id);

  const [form, setForm] = useState<EquipmentFormState>(() =>
    isEdit ? buildEquipmentFormFromRow(equipment) : buildBlankEquipment(),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && !busy) {
      setForm(isEdit ? buildEquipmentFormFromRow(equipment) : buildBlankEquipment());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, equipment]);

  const set = <K extends keyof EquipmentFormState>(key: K, value: EquipmentFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit() {
    setBusy(true);
    try {
      const saved = await saveEquipment(form);
      if (onSaved) await onSaved(saved);
      onClose();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save equipment');
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
                {form.name || 'Equipment'}
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
            <View style={styles.row}>
              <View style={[styles.flex1, { flex: 2 }]}>
                <Field
                  label="Name"
                  value={form.name}
                  onChange={(v) => set('name', v)}
                  placeholder="Dry Van 53ft"
                  required
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Code"
                  value={form.code}
                  onChange={(v) => set('code', v.toUpperCase())}
                  placeholder="DV53"
                  maxLength={10}
                />
              </View>
            </View>
            <Field
              label="Description"
              value={form.description}
              onChange={(v) => set('description', v)}
              placeholder="Brief description"
            />

            <Text style={styles.fieldLabel}>STATUS</Text>
            <View style={styles.chipRow}>
              {EQUIPMENT_STATUSES.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={form.status === s}
                  onPress={() => set('status', s)}
                />
              ))}
            </View>

            <SectionLabel label="Capacity" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Max Weight (lbs)"
                  value={form.max_weight}
                  onChange={(v) => set('max_weight', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="45000"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Max Volume (cu ft)"
                  value={form.max_volume}
                  onChange={(v) => set('max_volume', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="3800"
                />
              </View>
            </View>

            <SectionLabel label="Dimensions (ft)" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Length"
                  value={form.length}
                  onChange={(v) => set('length', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="53"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Width"
                  value={form.width}
                  onChange={(v) => set('width', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="8.5"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Height"
                  value={form.height}
                  onChange={(v) => set('height', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="9"
                />
              </View>
            </View>

            <SectionLabel label="Flags" />
            <FlagToggle
              label="Temp Controlled"
              hint="Refrigerated / temperature-sensitive"
              active={form.temp_controlled}
              onPress={() => set('temp_controlled', !form.temp_controlled)}
              tint={colors.cyan}
            />
            <FlagToggle
              label="Hazmat Certified"
              hint="Approved for hazardous materials"
              active={form.hazmat_certified}
              onPress={() => set('hazmat_certified', !form.hazmat_certified)}
              tint={colors.yellow}
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
                  <Ionicons name="save-outline" size={18} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>{isEdit ? 'Save Changes' : 'Create Equipment'}</Text>
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
  required,
  maxLength,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label.toUpperCase()}
        {required ? ' *' : ''}
      </Text>
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
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function FlagToggle({
  label,
  hint,
  active,
  onPress,
  tint,
}: {
  label: string;
  hint: string;
  active: boolean;
  onPress: () => void;
  tint: string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.flag,
        active && { borderColor: tint, backgroundColor: tint + '14' },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.flagBox, active && { backgroundColor: tint, borderColor: tint }]}>
        {active ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.flagLabel, active && { color: tint }]}>
          {label.toUpperCase()}
        </Text>
        <Text style={styles.flagHint}>{hint}</Text>
      </View>
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
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
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
  flag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    marginBottom: spacing.sm,
  },
  flagBox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flagLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: 0.5,
  },
  flagHint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
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
