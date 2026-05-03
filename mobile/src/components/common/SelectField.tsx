/**
 * SelectField — labelled tappable field that opens a SelectModal.
 *
 * Visually mirrors the FormInput row used elsewhere on OrderFormScreen
 * so dropdowns and free-text inputs can sit in the same form without
 * looking inconsistent. The modal lifecycle is owned here so callers
 * just pass options + value + onChange (mirrors the React Native
 * pickers pattern most users are familiar with).
 *
 * If `allowCustom` is true, users can type a value not in `options`;
 * useful for Customer (existing customers populate the list, but a
 * brand-new customer name still saves correctly).
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import SelectModal from './SelectModal';
import type { SelectOption } from '../../services/optionsService';

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Free-text fallback when query doesn't match an option. Default true. */
  allowCustom?: boolean;
  /** Override modal title. Defaults to `Select ${label}`. */
  modalTitle?: string;
  /** Disabled visual + tap. */
  disabled?: boolean;
}

export default function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  allowCustom = true,
  modalTitle,
  disabled,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);

  // Resolve the label of the currently-selected value when present in
  // options (so "warehouse name" can be shown above its address). Falls
  // back to the raw value, since custom-typed values won't be in the
  // option list.
  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label || value;
  const displaySublabel =
    selected && selected.sublabel && selected.label !== selected.sublabel
      ? selected.sublabel
      : null;

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.input, disabled && styles.inputDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <View style={styles.inputTextWrap}>
          {displayLabel ? (
            <>
              <Text style={styles.inputText} numberOfLines={1}>
                {displayLabel}
              </Text>
              {displaySublabel ? (
                <Text style={styles.inputSublabel} numberOfLines={1}>
                  {displaySublabel}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.placeholder} numberOfLines={1}>
              {placeholder || `Select ${label.toLowerCase()}…`}
            </Text>
          )}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.text3} />
      </TouchableOpacity>

      <SelectModal
        visible={open}
        title={modalTitle || `Select ${label}`}
        options={options}
        value={value}
        onSelect={onChange}
        onClose={() => setOpen(false)}
        allowCustom={allowCustom}
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
  inputTextWrap: { flex: 1 },
  inputText: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  inputSublabel: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  placeholder: {
    fontSize: fontSize.md,
    color: colors.text3,
  },
});
