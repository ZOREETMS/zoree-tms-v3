import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TextInput, Switch, TouchableOpacity,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { saveLocation } from '../../shared/services/locationService';
import { EMPTY_LOCATION, LOCATION_TYPES } from '../../shared/constants/locationConstants';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

type FormRoute = RouteProp<{ LocationForm: { locationId?: string } }, 'LocationForm'>;

export default function LocationFormScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<FormRoute>();
  const locationId = route.params?.locationId;
  const isEdit = !!locationId;

  const { data, refreshData } = useData();

  const existing = useMemo(
    () => (isEdit ? data.locations.find((l) => l.id === locationId) : null),
    [data.locations, locationId, isEdit],
  );

  const [form, setForm] = useState<any>(existing ? { ...existing } : { ...EMPTY_LOCATION });
  const [saving, setSaving] = useState(false);

  const updateField = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!form.name?.trim()) return Alert.alert('Validation', 'Location name is required');
    setSaving(true);
    try {
      const id = form.id || `LOC-${Date.now().toString(36).toUpperCase()}`;
      await saveLocation({ ...form, id }, isEdit ? locationId : null);
      await refreshData();
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? 'Edit Location' : 'New Location'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Basic Info */}
          <Text style={styles.sectionTitle}>Basic Information</Text>
          <FormInput label="Name" value={form.name} onChangeText={(v: string) => updateField('name', v)} />
          <Text style={styles.label}>Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typePicker}>
            {LOCATION_TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, form.type === t && styles.typeChipActive]}
                onPress={() => updateField('type', t)}
              >
                <Text style={[styles.typeChipText, form.type === t && styles.typeChipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <FormInput label="Customer" value={form.customer} onChangeText={(v: string) => updateField('customer', v)} />

          {/* Address */}
          <Text style={styles.sectionTitle}>Address</Text>
          <FormInput label="Street Address" value={form.address} onChangeText={(v: string) => updateField('address', v)} />
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput label="City" value={form.city} onChangeText={(v: string) => updateField('city', v)} />
            </View>
            <View style={{ width: 80 }}>
              <FormInput label="State" value={form.state} onChangeText={(v: string) => updateField('state', v)} maxLength={2} autoCapitalize="characters" />
            </View>
            <View style={{ width: 100 }}>
              <FormInput label="ZIP" value={form.zip} onChangeText={(v: string) => updateField('zip', v)} keyboardType="numeric" />
            </View>
          </View>

          {/* Contact */}
          <Text style={styles.sectionTitle}>Contact</Text>
          <FormInput label="Contact Name" value={form.contact_name} onChangeText={(v: string) => updateField('contact_name', v)} />
          <FormInput label="Phone" value={form.contact_phone} onChangeText={(v: string) => updateField('contact_phone', v)} keyboardType="phone-pad" />
          <FormInput label="Email" value={form.contact_email} onChangeText={(v: string) => updateField('contact_email', v)} keyboardType="email-address" autoCapitalize="none" />

          {/* Operations */}
          <Text style={styles.sectionTitle}>Operations</Text>
          <FormInput label="Hours" value={form.hours} onChangeText={(v: string) => updateField('hours', v)} placeholder="MON-FRI 06:00-18:00" />
          <FormInput label="Dock Doors" value={String(form.dock_doors || '')} onChangeText={(v: string) => updateField('dock_doors', v)} keyboardType="numeric" />

          {/* Capabilities */}
          <Text style={styles.sectionTitle}>Capabilities</Text>
          <SwitchRow label="Appointment Required" value={!!form.appt} onValueChange={(v: boolean) => updateField('appt', v)} />
          <SwitchRow label="Hazmat Certified" value={!!form.hazmat} onValueChange={(v: boolean) => updateField('hazmat', v)} />
          <SwitchRow label="Liftgate" value={form.liftgate === 'Yes'} onValueChange={(v: boolean) => updateField('liftgate', v ? 'Yes' : 'No')} />
          <SwitchRow label="Residential" value={!!form.resi} onValueChange={(v: boolean) => updateField('resi', v)} />
          <SwitchRow label="Inside Delivery" value={!!form.inside_delivery} onValueChange={(v: boolean) => updateField('inside_delivery', v)} />
          <SwitchRow label="TWIC Required" value={!!form.twic} onValueChange={(v: boolean) => updateField('twic', v)} />

          {/* Notes */}
          <Text style={styles.sectionTitle}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={form.notes}
            onChangeText={(v) => updateField('notes', v)}
            placeholder="Additional notes..."
            placeholderTextColor={colors.text3}
            multiline
            numberOfLines={3}
          />

          <View style={{ height: spacing['5xl'] }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ── Reusable form components ── */

function FormInput({ label, value, onChangeText, ...props }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value || ''}
        onChangeText={onChangeText}
        placeholderTextColor={colors.text3}
        {...props}
      />
    </View>
  );
}

function SwitchRow({ label, value, onValueChange }: any) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: `${colors.accent}80` }}
        thumbColor={value ? colors.accent : colors.bg2}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { marginRight: spacing.md, padding: spacing.xs },
  headerTitle: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  saveBtn: {
    backgroundColor: colors.accent, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  scroll: { padding: spacing.lg },
  sectionTitle: {
    fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text,
    marginTop: spacing.xl, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  fieldWrap: { marginBottom: spacing.md },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text2, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.border,
    borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    fontSize: fontSize.md, color: colors.text,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.sm },
  typePicker: { marginBottom: spacing.md },
  typeChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, backgroundColor: colors.bg2,
    borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm,
  },
  typeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  typeChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text2 },
  typeChipTextActive: { color: colors.white, fontWeight: fontWeight.semibold },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  switchLabel: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
});
