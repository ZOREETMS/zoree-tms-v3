/**
 * Rate edit form — Service Level / Transit Days / Miles section.
 *
 * Mirrors EditRateModal.jsx lines 377-403.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RateTextField from './RateTextField';
import RatePickerField from './RatePickerField';
import {
  SERVICE_LEVEL_OPTIONS,
  type RateFormState,
} from '../../services/rateService';
import { fontSize, fontWeight, spacing, colors } from '../../theme';

export interface RateLogisticsSectionProps {
  form: RateFormState;
  onChange: <K extends keyof RateFormState>(key: K, value: RateFormState[K]) => void;
}

export default function RateLogisticsSection({
  form,
  onChange,
}: RateLogisticsSectionProps) {
  const slOptions = useMemo(
    () => SERVICE_LEVEL_OPTIONS.map((s) => ({ value: s, label: s })),
    [],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Logistics</Text>

      <RatePickerField
        label="Service Level"
        value={form.serviceLevel}
        options={slOptions}
        onChange={(v) => onChange('serviceLevel', v)}
        placeholder="— Select —"
      />

      <RateTextField
        label="Transit Days"
        value={form.transitDays}
        onChangeText={(v) => onChange('transitDays', v.replace(/[^0-9]/g, ''))}
        placeholder="e.g. 3"
        keyboardType="numeric"
        hint="Business days, carrier-committed"
      />

      <RateTextField
        label="Distance (miles)"
        value={form.miles}
        onChangeText={(v) => onChange('miles', v.replace(/[^0-9]/g, ''))}
        placeholder="Manual or from PC*MILER"
        keyboardType="numeric"
        hint="Editable — PC*MILER fills during rating"
      />
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
});
