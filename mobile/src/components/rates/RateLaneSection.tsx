/**
 * Rate edit form — Lane / Mode / Equipment / Match-Type section.
 *
 * Owns no state. Reads slices of the form via `form` and emits changes
 * via `onChange(key, value)` so EditRateScreen stays the single source
 * of truth for form state.
 *
 * Mirrors the equivalent block in
 * frontend/src/components/EditRateModal.jsx (lines 223-295).
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RateTextField from './RateTextField';
import RatePickerField from './RatePickerField';
import {
  MATCH_TYPE_OPTIONS,
  MODE_OPTIONS,
  SEED_EQUIPMENT,
  type RateFormState,
} from '../../services/rateService';
import { fontSize, fontWeight, spacing, colors } from '../../theme';

export interface RateLaneSectionProps {
  form: RateFormState;
  onChange: <K extends keyof RateFormState>(key: K, value: RateFormState[K]) => void;
  /** Equipment master rows from the DB; falls back to SEED_EQUIPMENT when empty. */
  equipmentTypes?: Array<{ name: string; max_weight?: number; status?: string }>;
}

export default function RateLaneSection({
  form,
  onChange,
  equipmentTypes,
}: RateLaneSectionProps) {
  const equipmentOptions = useMemo(() => {
    const source = equipmentTypes && equipmentTypes.length > 0 ? equipmentTypes : SEED_EQUIPMENT;
    const active = source.filter((eq: any) => (eq.status || 'Active') === 'Active');
    return active.map((eq: any) => ({
      value: eq.name,
      label: eq.max_weight
        ? `${eq.name} (${Number(eq.max_weight).toLocaleString()} lb max)`
        : eq.name,
    }));
  }, [equipmentTypes]);

  const modeOptions = useMemo(
    () => MODE_OPTIONS.map((m) => ({ value: m, label: m })),
    [],
  );

  const matchOptions = useMemo(
    () =>
      MATCH_TYPE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        hint: opt.hint,
      })),
    [],
  );

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Lane</Text>

      <RateTextField
        label="Lane ID"
        value={form.lane}
        onChangeText={(v) => onChange('lane', v)}
        placeholder="Auto-generated if empty"
        required
      />

      <RatePickerField
        label="Mode"
        value={form.mode}
        options={modeOptions}
        onChange={(v) => onChange('mode', v)}
        required
      />

      <RatePickerField
        label="Equipment"
        value={form.equipment}
        options={equipmentOptions}
        onChange={(v) => onChange('equipment', v)}
        placeholder="— Select Equipment —"
        hint="Trailer this rate was negotiated against — planner reads max_weight from the equipment master."
      />

      <RatePickerField
        label="Match Type"
        value={form.matchType}
        options={matchOptions}
        onChange={(v) => onChange('matchType', v as RateFormState['matchType'])}
        required
        hint={MATCH_TYPE_OPTIONS.find((o) => o.value === form.matchType)?.hint}
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
