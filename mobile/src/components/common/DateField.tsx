/**
 * DateField — labelled tappable field that opens a DatePickerModal.
 *
 * Visual twin of SelectField so the form composes uniformly. Owns the
 * modal lifecycle internally; the parent only sees the YYYY-MM-DD
 * string flowing through `value`/`onChange`.
 *
 * Pass `min`/`max` to keep due >= ready, etc — the underlying
 * DatePickerModal disables out-of-range cells natively, so callers
 * don't need a separate validator.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import DatePickerModal from './DatePickerModal';

export interface DateFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** YYYY-MM-DD lower bound (inclusive). */
  min?: string;
  /** YYYY-MM-DD upper bound (inclusive). */
  max?: string;
  /** Override modal title. */
  modalTitle?: string;
  disabled?: boolean;
}

export default function DateField({
  label,
  value,
  onChange,
  placeholder,
  min,
  max,
  modalTitle,
  disabled,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.input, disabled && styles.inputDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Ionicons
          name="calendar-outline"
          size={18}
          color={value ? colors.text2 : colors.text3}
        />
        <Text
          style={[
            styles.inputText,
            !value && styles.placeholder,
          ]}
          numberOfLines={1}
        >
          {value || placeholder || 'YYYY-MM-DD'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.text3} />
      </TouchableOpacity>

      <DatePickerModal
        visible={open}
        value={value}
        onChange={onChange}
        onClose={() => setOpen(false)}
        title={modalTitle || `Pick ${label.toLowerCase()}`}
        min={min}
        max={max}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { marginBottom: spacing.md },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    marginBottom: spacing.xs,
  },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  inputDisabled: { opacity: 0.5 },
  inputText: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
  },
  placeholder: {
    color: colors.text3,
  },
});
