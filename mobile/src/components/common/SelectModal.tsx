/**
 * SelectModal — bottom-sheet picker with a search bar.
 *
 * Generic over `{ value, label, sublabel }` options so it can drive
 * customer / location / carrier pickers without duplicating UI. Keeps
 * the form screen thin (CLAUDE_RULES — no large inline blocks).
 *
 * No new dependencies: pure RN Modal + FlatList. Search is client-side
 * (case-insensitive substring on label + sublabel + value).
 *
 * Props are intentionally narrow:
 *   - `allowCustom`: when true, a typed query that doesn't match any
 *     existing option can still be saved as a free-text value. We need
 *     this so users can pick "ACME Corp" from the list OR type a new
 *     customer the first time without losing existing data.
 */
import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import type { SelectOption } from '../../services/optionsService';

export interface SelectModalProps {
  visible: boolean;
  title: string;
  options: SelectOption[];
  /** Currently selected value (highlights the matching row). */
  value?: string | null;
  onSelect: (value: string) => void;
  onClose: () => void;
  /** When true, free-text "Use 'X'" row appears for unmatched queries. */
  allowCustom?: boolean;
  /** Helper text under the title. */
  hint?: string;
  /**
   * QA bug #114: when set, an additional "+ Create new" row renders at
   * the very top of the list (above any allowCustom "Use X" row).
   * Pressing it closes this modal and invokes the callback so the
   * caller can present a creation form (e.g. CreateLocationModal).
   * Keeping the modal close + callback dispatch in here means callers
   * don't have to manage the "is the picker still open" race.
   */
  onCreateNew?: () => void;
  /** Label for the create row. Defaults to "Create new". */
  createNewLabel?: string;
}

export default function SelectModal({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
  allowCustom = false,
  hint,
  onCreateNew,
  createNewLabel,
}: SelectModalProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      return (
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.sublabel || '').toLowerCase().includes(q)
      );
    });
  }, [query, options]);

  // Show the "Use '<query>'" row when the user has typed something
  // that doesn't exactly match any option's value or label. Trimmed so
  // a leading space doesn't trigger the prompt for an existing match.
  const trimmed = query.trim();
  const showCustomRow =
    allowCustom &&
    trimmed.length > 0 &&
    !options.some(
      (o) =>
        o.value.toLowerCase() === trimmed.toLowerCase() ||
        o.label.toLowerCase() === trimmed.toLowerCase(),
    );

  const handleSelect = (v: string) => {
    onSelect(v);
    setQuery('');
    onClose();
  };

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle}>{title}</Text>
              {hint ? <Text style={styles.headerHint}>{hint}</Text> : null}
            </View>
            <TouchableOpacity
              onPress={handleClose}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Ionicons name="close" size={24} color={colors.text2} />
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <Ionicons
              name="search"
              size={18}
              color={colors.text3}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search..."
              placeholderTextColor={colors.text3}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Ionicons name="close-circle" size={18} color={colors.text3} />
              </TouchableOpacity>
            )}
          </View>

          {/* List */}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              !showCustomRow ? (
                <View style={styles.emptyWrap}>
                  <Ionicons name="search-outline" size={32} color={colors.text3} />
                  <Text style={styles.emptyText}>No matches</Text>
                </View>
              ) : null
            }
            ListHeaderComponent={
              <>
                {/* QA bug #114: Create New row. Always available when
                    onCreateNew is provided so users can add a missing
                    location even before they start typing a query. The
                    "Use 'X'" row below remains for free-text fallback
                    when allowCustom=true and the query doesn't match. */}
                {onCreateNew ? (
                  <TouchableOpacity
                    style={styles.createRow}
                    onPress={() => {
                      setQuery('');
                      onCreateNew();
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="add-circle"
                      size={20}
                      color={colors.accent}
                    />
                    <Text style={styles.createRowText}>
                      {createNewLabel || 'Create new'}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                {showCustomRow ? (
                  <TouchableOpacity
                    style={styles.customRow}
                    onPress={() => handleSelect(trimmed)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={18}
                      color={colors.accent}
                    />
                    <Text style={styles.customRowText}>Use "{trimmed}"</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            }
            renderItem={({ item }) => {
              const active = value && item.value === value;
              return (
                <TouchableOpacity
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => handleSelect(item.value)}
                  activeOpacity={0.7}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{item.label}</Text>
                    {item.sublabel ? (
                      <Text style={styles.rowSublabel}>{item.sublabel}</Text>
                    ) : null}
                  </View>
                  {active ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '85%',
    minHeight: '50%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTextWrap: { flex: 1 },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  headerHint: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowActive: { backgroundColor: 'rgba(37,99,235,0.06)' },
  rowText: { flex: 1 },
  rowLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  rowSublabel: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: 'rgba(37,99,235,0.04)',
  },
  customRowText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  // QA bug #114: visually distinct from `customRow` so the user can
  // tell the persisting "Create new" action apart from the throwaway
  // "Use 'X'" free-text row. Slightly stronger background and a bolder
  // weight on the label.
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: 'rgba(37,99,235,0.10)',
  },
  createRowText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  emptyWrap: {
    alignItems: 'center',
    padding: spacing['2xl'],
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
});
