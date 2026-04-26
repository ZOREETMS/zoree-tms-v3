/**
 * Rate edit form — Carrier / Status / Rate / Unit / FSC / Effective /
 * Expiration section.
 *
 * Mirrors EditRateModal.jsx lines 318-375.
 *
 * Carrier dropdown: when the caller provides a carrier list we show a
 * picker; otherwise we fall back to a free-text input so brand-new
 * carriers can be entered ad-hoc (matches web behaviour).
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RateTextField from './RateTextField';
import RatePickerField from './RatePickerField';
import {
  STATUS_OPTIONS,
  UNIT_OPTIONS,
  type RateFormState,
} from '../../services/rateService';
import { fontSize, fontWeight, spacing, colors } from '../../theme';

export interface RatePricingSectionProps {
  form: RateFormState;
  onChange: <K extends keyof RateFormState>(key: K, value: RateFormState[K]) => void;
  carriers?: Array<{ name?: string } | string>;
}

export default function RatePricingSection({
  form,
  onChange,
  carriers,
}: RatePricingSectionProps) {
  const carrierOptions = useMemo(() => {
    if (!carriers || carriers.length === 0) return [];
    const names = carriers
      .map((c) => (typeof c === 'string' ? c : c?.name || ''))
      .filter(Boolean);
    // Preserve any current value not in the list, web does the same.
    if (form.carrier && !names.includes(form.carrier)) names.push(form.carrier);
    return names.map((n) => ({ value: n, label: n }));
  }, [carriers, form.carrier]);

  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map((s) => ({ value: s, label: s })),
    [],
  );

  const unitOptions = useMemo(
    () => UNIT_OPTIONS.map((u) => ({ value: u.value, label: u.label })),
    [],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Pricing</Text>

      {carrierOptions.length > 0 ? (
        <RatePickerField
          label="Carrier"
          value={form.carrier}
          options={carrierOptions}
          onChange={(v) => onChange('carrier', v)}
          required
          placeholder="— Select Carrier —"
        />
      ) : (
        <RateTextField
          label="Carrier"
          value={form.carrier}
          onChangeText={(v) => onChange('carrier', v)}
          placeholder="e.g. Werner Enterprises"
          required
        />
      )}

      <RatePickerField
        label="Status"
        value={form.status}
        options={statusOptions}
        onChange={(v) => onChange('status', v)}
      />

      <RateTextField
        label="Rate"
        value={form.rate}
        onChangeText={(v) => onChange('rate', v)}
        placeholder="e.g. 2.50"
        required
        keyboardType="decimal-pad"
      />

      <RatePickerField
        label="Rate Unit"
        value={form.unit}
        options={unitOptions}
        onChange={(v) => onChange('unit', v)}
      />

      <RateTextField
        label="FSC %"
        value={form.fsc}
        onChangeText={(v) => onChange('fsc', v)}
        placeholder="e.g. 18.5"
        keyboardType="decimal-pad"
      />

      <View style={styles.row}>
        <View style={styles.flex1}>
          <RateTextField
            label="Effective Date"
            value={form.eff}
            onChangeText={(v) => onChange('eff', v)}
            placeholder="YYYY-MM-DD"
            keyboardType="numeric"
          />
        </View>
        <View style={styles.flex1}>
          <RateTextField
            label="Expiration Date"
            value={form.exp}
            onChangeText={(v) => onChange('exp', v)}
            placeholder="YYYY-MM-DD"
            keyboardType="numeric"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
  },
});
