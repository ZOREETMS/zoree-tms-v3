import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TextInput, Switch, TouchableOpacity,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { saveItem } from '../../shared/services/itemService';
import { EMPTY_ITEM, ITEM_CLASSES, FREIGHT_CLASSES, PKG_TYPES } from '../../shared/constants/itemConstants';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

type FormRoute = RouteProp<{ ItemForm: { itemId?: string } }, 'ItemForm'>;

export default function ItemFormScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<FormRoute>();
  const itemId = route.params?.itemId;
  const isEdit = !!itemId;

  const { data, refreshData } = useData();
  const existing = useMemo(
    () => (isEdit ? data.items.find((i: any) => String(i.id) === String(itemId)) : null),
    [data.items, itemId, isEdit],
  );

  const [form, setForm] = useState<any>(existing ? { ...existing } : { ...EMPTY_ITEM });
  const [saving, setSaving] = useState(false);

  const updateField = (key: string, value: any) => setForm((p: any) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    if (!form.id?.trim() && !isEdit) return Alert.alert('Validation', 'Item ID is required');
    if (!(form.description || form.desc)?.trim()) return Alert.alert('Validation', 'Description is required');
    setSaving(true);
    try {
      await saveItem(form, isEdit ? itemId : null);
      await refreshData();
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEdit ? 'Edit Item' : 'New Item'}</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
            {saving ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Basic Info */}
          <Text style={styles.sectionTitle}>Basic Information</Text>
          <FormInput label="Item ID" value={form.id} onChangeText={(v: string) => updateField('id', v)} editable={!isEdit} autoCapitalize="characters" />
          <FormInput label="Description" value={form.description || form.desc} onChangeText={(v: string) => updateField('description', v)} />
          <FormInput label="Customer" value={form.customer} onChangeText={(v: string) => updateField('customer', v)} autoCapitalize="characters" />

          {/* Classification */}
          <Text style={styles.sectionTitle}>Classification</Text>
          <Text style={styles.label}>Item Class</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {ITEM_CLASSES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, (form.item_class || form.class) === c && styles.chipActive]}
                onPress={() => updateField('item_class', c)}
              >
                <Text style={[styles.chipText, (form.item_class || form.class) === c && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <FormInput label="NMFC Code" value={form.nmfc} onChangeText={(v: string) => updateField('nmfc', v)} />
          <Text style={styles.label}>Freight Class</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {FREIGHT_CLASSES.map((fc) => (
              <TouchableOpacity
                key={fc}
                style={[styles.chip, (form.freight_class || form.fclass) === fc && styles.chipActive]}
                onPress={() => updateField('freight_class', fc)}
              >
                <Text style={[styles.chipText, (form.freight_class || form.fclass) === fc && styles.chipTextActive]}>{fc}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.label}>Packaging</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {PKG_TYPES.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.chip, form.pkg === p && styles.chipActive]}
                onPress={() => updateField('pkg', p)}
              >
                <Text style={[styles.chipText, form.pkg === p && styles.chipTextActive]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Physical Properties */}
          <Text style={styles.sectionTitle}>Physical Properties</Text>
          <View style={styles.row}>
            <View style={styles.flex}><FormInput label="Weight (lbs)" value={String(form.weight_unit || '')} onChangeText={(v: string) => updateField('weight_unit', v)} keyboardType="numeric" /></View>
            <View style={styles.flex}><FormInput label="Value ($)" value={String(form.value_unit || '')} onChangeText={(v: string) => updateField('value_unit', v)} keyboardType="numeric" /></View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex}><FormInput label="Length" value={String(form.len || '')} onChangeText={(v: string) => updateField('len', v)} keyboardType="numeric" /></View>
            <View style={styles.flex}><FormInput label="Width" value={String(form.wid || '')} onChangeText={(v: string) => updateField('wid', v)} keyboardType="numeric" /></View>
            <View style={styles.flex}><FormInput label="Height" value={String(form.hgt || '')} onChangeText={(v: string) => updateField('hgt', v)} keyboardType="numeric" /></View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex}><FormInput label="Units/Pallet" value={String(form.units_per_pallet || '')} onChangeText={(v: string) => updateField('units_per_pallet', v)} keyboardType="numeric" /></View>
            <View style={styles.flex}><FormInput label="Stack Height" value={String(form.stack || '')} onChangeText={(v: string) => updateField('stack', v)} keyboardType="numeric" /></View>
          </View>

          {/* Special Handling */}
          <Text style={styles.sectionTitle}>Special Handling</Text>
          <SwitchRow label="Hazmat" value={!!form.hazmat} onValueChange={(v: boolean) => updateField('hazmat', v)} />
          {form.hazmat && (
            <View style={styles.row}>
              <View style={styles.flex}><FormInput label="UN Number" value={form.un} onChangeText={(v: string) => updateField('un', v)} /></View>
              <View style={styles.flex}><FormInput label="Haz Class" value={form.haz_class} onChangeText={(v: string) => updateField('haz_class', v)} /></View>
            </View>
          )}
          <SwitchRow label="Fragile" value={!!form.fragile} onValueChange={(v: boolean) => updateField('fragile', v)} />
          <SwitchRow label="Temperature Controlled" value={!!form.temp_ctrl} onValueChange={(v: boolean) => updateField('temp_ctrl', v)} />
          <SwitchRow label="Top Load Only" value={!!form.top_load} onValueChange={(v: boolean) => updateField('top_load', v)} />

          <View style={{ height: spacing['5xl'] }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function FormInput({ label, value, onChangeText, ...props }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={[styles.input, !props.editable && props.editable === false && styles.inputDisabled]} value={value || ''} onChangeText={onChangeText} placeholderTextColor={colors.text3} {...props} />
    </View>
  );
}

function SwitchRow({ label, value, onValueChange }: any) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: `${colors.accent}80` }} thumbColor={value ? colors.accent : colors.bg2} />
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
  saveBtn: { backgroundColor: colors.accent, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
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
  inputDisabled: { backgroundColor: colors.bg3, color: colors.text3 },
  row: { flexDirection: 'row', gap: spacing.sm },
  chipScroll: { marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: borderRadius.full, backgroundColor: colors.bg2,
    borderWidth: 1, borderColor: colors.border, marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text2 },
  chipTextActive: { color: colors.white, fontWeight: fontWeight.semibold },
  switchRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  switchLabel: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text },
});
