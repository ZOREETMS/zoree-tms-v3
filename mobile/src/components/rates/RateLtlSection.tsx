/**
 * Rate edit form — LTL / CzarLite section.
 *
 * Discount %, Discount $ (flat), NMFC freight class, and LTL min/max
 * weight breaks. Weight-break inputs are only enabled when the rate's
 * mode is LTL — mirrors the web modal's UX (lines 405-448).
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RateTextField from './RateTextField';
import RatePickerField from './RatePickerField';
import {
  FREIGHT_CLASSES,
  isLtlMode,
  type RateFormState,
} from '../../services/rateService';
import { fontSize, fontWeight, spacing, colors, borderRadius } from '../../theme';

export interface RateLtlSectionProps {
  form: RateFormState;
  onChange: <K extends keyof RateFormState>(key: K, value: RateFormState[K]) => void;
}

export default function RateLtlSection({ form, onChange }: RateLtlSectionProps) {
  const ltl = isLtlMode(form.mode);

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

      {ltl ? (
        <View style={styles.row}>
          <View style={styles.flex1}>
            <RateTextField
              label="Min Weight (lbs)"
              value={form.czarliteMinWt}
              onChangeText={(v) => onChange('czarliteMinWt', v.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              placeholder="500"
            />
          </View>
          <View style={styles.flex1}>
            <RateTextField
              label="Max Weight (lbs)"
              value={form.czarliteMaxWt}
              onChangeText={(v) => onChange('czarliteMaxWt', v.replace(/[^0-9]/g, ''))}
              keyboardType="numeric"
              placeholder="9999"
            />
          </View>
        </View>
      ) : (
        <Text style={styles.disabledHint}>
          Weight breaks apply to LTL rates only — switch Mode to LTL to configure.
        </Text>
      )}
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
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
  },
  disabledHint: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    fontStyle: 'italic',
  },
});
