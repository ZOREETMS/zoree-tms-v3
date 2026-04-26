/**
 * Single-purpose labeled picker. Tap to open a modal sheet with the
 * available options; tap an option to commit. Avoids the
 * platform-specific behavior of @react-native-picker/picker so the
 * mobile rate form looks identical on iOS and Android.
 *
 * Generic over the option value type so callers can use string unions
 * (mode, status, match-type, etc.) without losing TypeScript fidelity.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface RatePickerOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

export interface RatePickerFieldProps<T extends string = string> {
  label: string;
  value: T | '';
  options: ReadonlyArray<RatePickerOption<T>>;
  onChange: (next: T) => void;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}

export default function RatePickerField<T extends string = string>({
  label,
  value,
  options,
  onChange,
  required,
  placeholder = '— Select —',
  hint,
  disabled,
}: RatePickerFieldProps<T>) {
  const [open, setOpen] = useState(false);

  const currentLabel = useMemo(() => {
    const match = options.find((o) => o.value === value);
    return match?.label || placeholder;
  }, [options, value, placeholder]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label.toUpperCase()}
        {required ? ' *' : ''}
      </Text>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => !disabled && setOpen(true)}
        style={[styles.trigger, disabled && styles.triggerDisabled]}
      >
        <Text
          style={[styles.triggerText, !value && styles.triggerPlaceholder]}
          numberOfLines={1}
        >
          {currentLabel}
        </Text>
        <Ionicons
          name="chevron-down"
          size={18}
          color={disabled ? colors.text3 : colors.text2}
        />
      </TouchableOpacity>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>{label.toUpperCase()}</Text>
            <FlatList
              data={options as ReadonlyArray<RatePickerOption<T>>}
              keyExtractor={(item) => String(item.value)}
              renderItem={({ item }) => {
                const selected = item.value === value;
                return (
                  <TouchableOpacity
                    style={[styles.optionRow, selected && styles.optionRowSelected]}
                    activeOpacity={0.7}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.optionTextWrap}>
                      <Text
                        style={[styles.optionLabel, selected && styles.optionLabelSelected]}
                      >
                        {item.label}
                      </Text>
                      {item.hint ? (
                        <Text style={styles.optionHint}>{item.hint}</Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark" size={20} color={colors.accent} />
                    ) : null}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        </TouchableOpacity>
      </Modal>
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
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg2,
    minHeight: 42,
  },
  triggerDisabled: {
    opacity: 0.6,
  },
  triggerText: {
    fontSize: fontSize.md,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  triggerPlaceholder: {
    color: colors.text3,
  },
  hint: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    marginTop: spacing.xs,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    maxHeight: '70%',
  },
  sheetTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text2,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionRowSelected: {
    backgroundColor: colors.accentGlow,
  },
  optionTextWrap: {
    flex: 1,
  },
  optionLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  optionLabelSelected: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  optionHint: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
  },
});
