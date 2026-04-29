/**
 * OrderFormScreen — single screen that handles both creating a new
 * order (Dashboard → Quick Actions → New Order) and editing an
 * existing one (OrderDetailScreen → Edit). Mirrors the
 * ItemFormScreen / LocationFormScreen pattern so the navigation
 * surface stays consistent.
 *
 * No business / persistence logic lives here — saving routes through
 * services/ordersService.ts (saveOrder), which validates and calls
 * the service-layer API endpoints. Per CLAUDE_RULES the screen is
 * thin: state + form layout + delegation.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Switch,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { saveOrder } from '../../services/ordersService';
import {
  EMPTY_ORDER,
  ORDER_STATUSES,
  SHIP_MODES,
  SERVICE_LEVELS,
} from '../../shared/constants/orderConstants';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import type { PlanningTabParamList } from '../../navigation/types';

type FormRoute = RouteProp<PlanningTabParamList, 'OrderForm'>;

export default function OrderFormScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<FormRoute>();
  const orderId = route.params?.orderId;
  const isEdit = !!orderId;

  const { data, refreshData } = useData();

  // When editing, hydrate from the camelCase order in DataContext.
  // When creating, start from the canonical EMPTY_ORDER so we never
  // ship undefined fields to the API.
  const existing = useMemo(
    () =>
      isEdit
        ? data.orders.find(
            (o: any) => String(o.id ?? o.order_id) === String(orderId),
          )
        : null,
    [data.orders, orderId, isEdit],
  );

  const [form, setForm] = useState<any>(() =>
    existing
      ? {
          ...EMPTY_ORDER,
          ...existing,
          // Form inputs are strings; coerce numerics so TextInput
          // doesn't choke on a number value.
          weight: existing.weight != null ? String(existing.weight) : '',
          pieces: existing.pieces != null ? String(existing.pieces) : '',
        }
      : { ...EMPTY_ORDER },
  );
  const [saving, setSaving] = useState(false);

  const updateField = (key: string, value: any) =>
    setForm((p: any) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await saveOrder(form, orderId || null);
      await refreshData();
      // After create: route the user to the new order's detail view
      // so they can plan / tender / copy. After edit: pop back to
      // wherever they came from.
      if (isEdit) {
        navigation.goBack();
      } else {
        navigation.replace('OrderDetail', { orderId: saved?.id || form.id });
      }
    } catch (e: any) {
      Alert.alert('Could not save order', e?.message || 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            disabled={saving}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isEdit ? 'Edit Order' : 'New Order'}
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Customer & Lane */}
          <Text style={styles.sectionTitle}>Customer & Lane</Text>
          <FormInput
            label="Customer"
            value={form.customer}
            onChangeText={(v: string) => updateField('customer', v)}
          />
          <FormInput
            label="Origin"
            value={form.origin}
            onChangeText={(v: string) => updateField('origin', v)}
            placeholder="City, ST ZIP"
          />
          <FormInput
            label="Destination"
            value={form.destination}
            onChangeText={(v: string) => updateField('destination', v)}
            placeholder="City, ST ZIP"
          />
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput
                label="Origin ZIP"
                value={form.originZip}
                onChangeText={(v: string) => updateField('originZip', v)}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.flex}>
              <FormInput
                label="Dest ZIP"
                value={form.destZip}
                onChangeText={(v: string) => updateField('destZip', v)}
                keyboardType="number-pad"
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput
                label="Ship-from Name"
                value={form.shipFromName}
                onChangeText={(v: string) => updateField('shipFromName', v)}
              />
            </View>
            <View style={styles.flex}>
              <FormInput
                label="Ship-to Name"
                value={form.shipToName}
                onChangeText={(v: string) => updateField('shipToName', v)}
              />
            </View>
          </View>

          {/* Freight */}
          <Text style={styles.sectionTitle}>Freight</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput
                label="Weight (lbs)"
                value={String(form.weight ?? '')}
                onChangeText={(v: string) => updateField('weight', v)}
                keyboardType="numeric"
              />
            </View>
            <View style={styles.flex}>
              <FormInput
                label="Pieces"
                value={String(form.pieces ?? '')}
                onChangeText={(v: string) => updateField('pieces', v)}
                keyboardType="numeric"
              />
            </View>
          </View>
          <FormInput
            label="Commodity"
            value={form.commodity}
            onChangeText={(v: string) => updateField('commodity', v)}
          />
          <Text style={styles.label}>Ship Mode</Text>
          <ChipRow
            options={SHIP_MODES}
            value={form.shipMode}
            onChange={(v) => updateField('shipMode', v)}
          />
          <Text style={styles.label}>Service Level</Text>
          <ChipRow
            options={SERVICE_LEVELS.map((s) => s || 'None')}
            value={form.serviceLevel || 'None'}
            onChange={(v) =>
              updateField('serviceLevel', v === 'None' ? '' : v)
            }
          />

          {/* Schedule */}
          <Text style={styles.sectionTitle}>Schedule</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput
                label="Ready Date"
                value={form.readyDate}
                onChangeText={(v: string) => updateField('readyDate', v)}
                placeholder="YYYY-MM-DD"
              />
            </View>
            <View style={styles.flex}>
              <FormInput
                label="Due Date"
                value={form.dueDate}
                onChangeText={(v: string) => updateField('dueDate', v)}
                placeholder="YYYY-MM-DD"
              />
            </View>
          </View>

          {/* References */}
          <Text style={styles.sectionTitle}>References</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput
                label="PO #"
                value={form.poNum}
                onChangeText={(v: string) => updateField('poNum', v)}
              />
            </View>
            <View style={styles.flex}>
              <FormInput
                label="Ref #"
                value={form.refNum}
                onChangeText={(v: string) => updateField('refNum', v)}
              />
            </View>
          </View>
          <FormInput
            label="Incoterms"
            value={form.incoterms}
            onChangeText={(v: string) => updateField('incoterms', v)}
            placeholder="e.g. FOB, DAP"
          />

          {/* Status (edit-only — new orders default to Unplanned) */}
          {isEdit && (
            <>
              <Text style={styles.sectionTitle}>Status</Text>
              <ChipRow
                options={ORDER_STATUSES}
                value={form.status}
                onChange={(v) => updateField('status', v)}
              />
            </>
          )}

          {/* Carrier preferences */}
          <Text style={styles.sectionTitle}>Carrier Preferences</Text>
          <FormInput
            label="Preferred Carrier"
            value={form.preferredCarrier}
            onChangeText={(v: string) => updateField('preferredCarrier', v)}
          />
          <FormInput
            label="Excluded Carrier"
            value={form.excludedCarrier}
            onChangeText={(v: string) => updateField('excludedCarrier', v)}
          />

          {/* Flags */}
          <Text style={styles.sectionTitle}>Flags</Text>
          <SwitchRow
            label="Hazmat"
            value={!!form.hazmat}
            onValueChange={(v: boolean) => updateField('hazmat', v)}
          />
          <SwitchRow
            label="Do Not Consolidate"
            value={!!form.noConsolidate}
            onValueChange={(v: boolean) => updateField('noConsolidate', v)}
          />
          <SwitchRow
            label="No Contract Rate"
            value={!!form.noContractRate}
            onValueChange={(v: boolean) => updateField('noContractRate', v)}
          />
          <SwitchRow
            label="Dedicated Equipment"
            value={!!form.dedicatedEquip}
            onValueChange={(v: boolean) => updateField('dedicatedEquip', v)}
          />

          {/* Notes */}
          <Text style={styles.sectionTitle}>Notes</Text>
          <FormInput
            label="Notes"
            value={form.notes}
            onChangeText={(v: string) => updateField('notes', v)}
            multiline
            numberOfLines={4}
            style={styles.notesInput}
          />

          <View style={{ height: spacing['5xl'] }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ───────── Reusable sub-components ───────── */

function FormInput({ label, value, onChangeText, style, ...props }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholderTextColor={colors.text3}
        {...props}
      />
    </View>
  );
}

function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
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

function ChipRow({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(opt)}
          >
            <Text
              style={[styles.chipText, active && styles.chipTextActive]}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/* ───────── Styles ───────── */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { marginRight: spacing.md, padding: spacing.xs },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    minWidth: 72,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  scroll: { padding: spacing.lg },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldWrap: { marginBottom: spacing.md },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
  },
  notesInput: { minHeight: 96, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.sm },
  chipScroll: { marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  chipTextActive: { color: colors.white, fontWeight: fontWeight.semibold },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  switchLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
});
