/**
 * Rate edit form — LTL / CzarLite section.
 *
 * Discount %, Discount $ (flat), and NMFC freight class. Mirrors the
 * web modal's UX.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RateTextField from './RateTextField';
import RatePickerField from './RatePickerField';
import {
  FREIGHT_CLASSES,
  type RateFormState,
} from '../../services/rateService';
import { fontSize, fontWeight, spacing, colors, borderRadius } from '../../theme';

export interface RateLtlSectionProps {
  form: RateFormState;
  onChange: <K extends keyof RateFormState>(key: K, value: RateFormState[K]) => void;
}

export default function RateLtlSection({ form, onChange }: RateLtlSectionProps) {
  const classOptions = useMemo(
    () => FREIGHT_CLASSES.map((c) => ({ value: c, label: `Class ${c}` })),
    [],
  );

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>📊 LTL / CzarLite Configuration</Text>

      <RateTextField
        label="Discount % off CzarLite Base"
        value={form.discount}
        onChangeText={(v) => onChange('discount', v)}
        placeholder="e.g. 10"
        keyboardType="decimal-pad"
        hint="% reduction off CzarLite base rate before FSC"
      />

      <RateTextField
        label="Discount $ Flat off Base"
        value={form.discountFlat}
        onChangeText={(v) => onChange('discountFlat', v)}
        placeholder="e.g. 50"
        keyboardType="decimal-pad"
        hint="Fixed $ deduction off base (applied before FSC)"
      />

      <RatePickerField
        label="NMFC Freight Class"
        value={form.czarliteClass}
        options={classOptions}
        onChange={(v) => onChange('czarliteClass', v)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(99,102,241,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.15)',
  },
  heading: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
});
