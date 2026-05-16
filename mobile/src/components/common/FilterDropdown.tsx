/**
 * FilterDropdown — compact dropdown trigger for filter rows.
 *
 * Why a separate component (not SelectField):
 *   - SelectField (used on form screens) renders a labelled rectangular
 *     input that visually clashes with the chip-row layout the screens
 *     use for filters.
 *   - This trigger is a pill-shaped chip so it sits next to other
 *     filter pills / search bars without restructuring the screen
 *     header.
 *   - QA #317 / #319 / #320 / #326 — testers asked for the per-column
 *     filters (Class, Type, Status, Mode, Audit state) to read as
 *     dropdowns instead of horizontal button rows so the screens match
 *     the web sidebars more closely on small phones (the chip rows
 *     scrolled horizontally and the active option was often offscreen).
 *
 * API kept narrow on purpose:
 *   - `options` can be plain strings (each value === label) OR
 *     { value, label } pairs for cases where the visible label differs
 *     from the underlying filter key (e.g. AUDIT_FILTERS uses '' for
 *     "All").
 *   - `counts` is an optional value → number map. When provided, the
 *     trigger shows the current selection's count next to its label so
 *     users get the same at-a-glance count that the chip rows offered.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SelectModal from './SelectModal';
import type { SelectOption } from '../../services/optionsService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export type FilterDropdownOption =
  | string
  | { value: string; label: string };

export interface FilterDropdownProps {
  /** Label shown above the trigger (e.g. "Filter by Class"). Hidden when omitted. */
  label?: string;
  /** Currently-selected value. Matched against options. */
  value: string;
  onChange: (value: string) => void;
  options: FilterDropdownOption[];
  /** Optional value → count map; shown next to the selected label. */
  counts?: Record<string, number>;
  /** Modal title. Defaults to `label` or "Select". */
  modalTitle?: string;
  /** Disabled visual + tap. */
  disabled?: boolean;
}

function toSelectOption(o: FilterDropdownOption): SelectOption {
  if (typeof o === 'string') return { value: o, label: o };
  return { value: o.value, label: o.label };
}

export default function FilterDropdown({
  label,
  value,
  onChange,
  options,
  counts,
  modalTitle,
  disabled,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);

  const modalOptions = useMemo(
    () =>
      options.map((o) => {
        const opt = toSelectOption(o);
        const c = counts ? counts[opt.value] : undefined;
        // Surface the per-option count as a sublabel so the picker
        // list shows the same numbers the chip row used to show.
        return c != null ? { ...opt, sublabel: `${c}` } : opt;
      }),
    [options, counts],
  );

  const selected = modalOptions.find((o) => o.value === value) || modalOptions[0];
  const displayLabel = selected?.label || value;
  const displayCount = counts ? counts[value] : undefined;

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${displayLabel}` : `Filter: ${displayLabel}`}
        activeOpacity={0.7}
        disabled={disabled}
        onPress={() => !disabled && setOpen(true)}
        style={[styles.trigger, disabled && styles.triggerDisabled]}
      >
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {displayLabel}
        </Text>
        {displayCount != null && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{displayCount}</Text>
          </View>
        )}
        <Ionicons name="chevron-down" size={16} color={colors.text2} />
      </TouchableOpacity>

      <SelectModal
        visible={open}
        title={modalTitle || label || 'Select'}
        options={modalOptions}
        value={value}
        onSelect={(next) => onChange(next)}
        onClose={() => setOpen(false)}
        allowCustom={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.sm,
    letterSpacing: 0.3,
    // QA bug (2026-05-16): on Android the default `includeFontPadding`
    // (true) adds extra space inside the Text box, which combined with
    // tight paddingVertical on the filter rows clipped descenders /
    // pushed glyphs off-baseline so the label looked "distorted".
    // Disabling it gives the same predictable height as iOS.
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    // QA bug (2026-05-16): bump from spacing.sm (8) to spacing.md (12)
    // so the 14pt label has enough vertical headroom on Android even
    // before `includeFontPadding: false` kicks in. The previous
    // 8px-top/8px-bottom + minHeight:40 left the glyphs visibly cropped
    // top/bottom on some Android skins.
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    minHeight: 44,
  },
  triggerDisabled: { opacity: 0.5 },
  triggerLabel: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
    // QA bug (2026-05-16): same Android font-padding fix as `label`
    // above — keeps the selected value cleanly centred inside the pill
    // and stops descenders (g, y, p) from being clipped at the bottom
    // of the trigger on Android.
    includeFontPadding: false,
    textAlignVertical: 'center',
    lineHeight: fontSize.md * 1.3,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bg3,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.text2,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});
