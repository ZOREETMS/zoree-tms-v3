/**
 * Single-purpose labeled text input used by every rate-form section.
 *
 * Stateless on purpose — owns nothing but its label/value/onChange.
 * The EditRateScreen holds the canonical form state and feeds slices
 * into each section, which feeds slices into this field.
 */

import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface RateTextFieldProps {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
  editable?: boolean;
}

export default function RateTextField({
  label,
  value,
  onChangeText,
  placeholder,
  required,
  hint,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  maxLength,
  editable = true,
}: RateTextFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label.toUpperCase()}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        editable={editable}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  label: {
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
  inputDisabled: {
    backgroundColor: colors.bg,
    color: colors.text3,
  },
  hint: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    marginTop: spacing.xs,
  },
});
