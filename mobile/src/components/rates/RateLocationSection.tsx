/**
 * Rate edit form — Origin and Destination section.
 *
 * Each address has city / state / zip / country fields. Owns no state.
 * Mirrors EditRateModal.jsx lines 297-316 with mobile-friendly stacking
 * (web uses a 2fr/1fr/1fr/1fr CSS grid; we use a row that wraps).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import RateTextField from './RateTextField';
import { type RateFormState } from '../../services/rateService';
import { fontSize, fontWeight, spacing, colors } from '../../theme';

export interface RateLocationSectionProps {
  form: RateFormState;
  onChange: <K extends keyof RateFormState>(key: K, value: RateFormState[K]) => void;
}

export default function RateLocationSection({ form, onChange }: RateLocationSectionProps) {
  return (
    <View style={styles.section}>
      <AddressBlock
        title="Origin"
        cityKey="originCity"
        stateKey="originState"
        zipKey="originZip"
        countryKey="originCountry"
        cityPlaceholder="City (e.g. Chicago)"
        form={form}
        onChange={onChange}
      />
      <AddressBlock
        title="Destination"
        cityKey="destCity"
        stateKey="destState"
        zipKey="destZip"
        countryKey="destCountry"
        cityPlaceholder="City (e.g. Dallas)"
        form={form}
        onChange={onChange}
      />
    </View>
  );
}

interface AddressBlockProps {
  title: string;
  cityKey: keyof RateFormState;
  stateKey: keyof RateFormState;
  zipKey: keyof RateFormState;
  countryKey: keyof RateFormState;
  cityPlaceholder: string;
  form: RateFormState;
  onChange: <K extends keyof RateFormState>(key: K, value: RateFormState[K]) => void;
}

function AddressBlock({
  title,
  cityKey,
  stateKey,
  zipKey,
  countryKey,
  cityPlaceholder,
  form,
  onChange,
}: AddressBlockProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.sectionTitle}>{title} *</Text>
      <RateTextField
        label="City"
        value={String(form[cityKey] || '')}
        onChangeText={(v) => onChange(cityKey, v as any)}
        placeholder={cityPlaceholder}
        required
      />
      <View style={styles.row}>
        <View style={styles.flex1}>
          <RateTextField
            label="State"
            value={String(form[stateKey] || '')}
            onChangeText={(v) => onChange(stateKey, v.toUpperCase() as any)}
            placeholder="ST"
            maxLength={2}
            autoCapitalize="characters"
          />
        </View>
        <View style={styles.flex1}>
          <RateTextField
            label="ZIP"
            value={String(form[zipKey] || '')}
            onChangeText={(v) => onChange(zipKey, v as any)}
            placeholder="ZIP (opt)"
            maxLength={5}
            keyboardType="numeric"
          />
        </View>
        <View style={styles.flex1}>
          <RateTextField
            label="Country"
            value={String(form[countryKey] || '')}
            onChangeText={(v) => onChange(countryKey, v.toUpperCase() as any)}
            placeholder="USA"
            maxLength={3}
            autoCapitalize="characters"
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
  block: {
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
