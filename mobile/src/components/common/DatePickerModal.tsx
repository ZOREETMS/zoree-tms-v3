/**
 * DatePickerModal — calendar-grid date picker, pure React Native.
 *
 * Why an in-house picker:
 * Adding @react-native-community/datetimepicker would require an
 * Expo prebuild config change and would surface a different native
 * widget on each platform. For a YYYY-MM-DD field with no time
 * component, a portable JS calendar is simpler, deterministic, and
 * matches the web app's date picker affordance (REQ from QA bug #89).
 *
 * Public contract:
 *   - `value`     — current YYYY-MM-DD string ('' for unset).
 *   - `onChange`  — fires once with the new YYYY-MM-DD string.
 *   - `min`/`max` — optional bounds. Used by the OrderEditModal to
 *                   keep "due" >= "ready" without a separate validator.
 *
 * Date math is deliberately UTC-naive: orders.ready / orders.due are
 * stored as DATE columns in Supabase (no time, no zone), so we treat
 * them as wall-clock and never `new Date(string)` them through the
 * timezone-shifty parser.
 */
import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface DatePickerModalProps {
  visible: boolean;
  /** Selected date in YYYY-MM-DD. Empty string = no selection. */
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  title?: string;
  /** Inclusive lower bound, YYYY-MM-DD. */
  min?: string;
  /** Inclusive upper bound, YYYY-MM-DD. */
  max?: string;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format a calendar (year, month-1-indexed, day) tuple as YYYY-MM-DD. */
function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

/**
 * Parse YYYY-MM-DD into a {year, month, day} tuple. Returns null when
 * the string isn't well-formed — callers should fall back to "today"
 * for cursor placement in that case.
 */
function parseYmd(s: string): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (
    !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)
    || month < 0 || month > 11 || day < 1 || day > 31
  ) return null;
  return { y: year, m: month, d: day };
}

/** Days-in-month respecting leap years. */
function daysInMonth(year: number, monthZeroIndexed: number): number {
  return new Date(year, monthZeroIndexed + 1, 0).getDate();
}

/** Comparison helper that operates on YYYY-MM-DD strings safely (lexicographic). */
function cmp(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export default function DatePickerModal({
  visible,
  value,
  onChange,
  onClose,
  title,
  min,
  max,
}: DatePickerModalProps) {
  // Cursor = which month is on screen. Re-seed when modal opens so
  // re-opening after a save doesn't keep stale month state from a
  // prior pick.
  const today = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  }, []);
  const initial = parseYmd(value) || today;
  const [cursorYear, setCursorYear] = useState<number>(initial.y);
  const [cursorMonth, setCursorMonth] = useState<number>(initial.m);

  useEffect(() => {
    if (!visible) return;
    const seed = parseYmd(value) || today;
    setCursorYear(seed.y);
    setCursorMonth(seed.m);
  }, [visible, value, today]);

  const todayYmd = ymd(today.y, today.m, today.d);

  const cells = useMemo(() => {
    const firstDow = new Date(cursorYear, cursorMonth, 1).getDay(); // 0..6 Sun..Sat
    const dim = daysInMonth(cursorYear, cursorMonth);
    const out: (string | null)[] = [];
    for (let i = 0; i < firstDow; i++) out.push(null);
    for (let d = 1; d <= dim; d++) out.push(ymd(cursorYear, cursorMonth, d));
    // Pad to a multiple of 7 so the grid stays rectangular.
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [cursorYear, cursorMonth]);

  const goPrev = () => {
    if (cursorMonth === 0) {
      setCursorYear(cursorYear - 1);
      setCursorMonth(11);
    } else {
      setCursorMonth(cursorMonth - 1);
    }
  };
  const goNext = () => {
    if (cursorMonth === 11) {
      setCursorYear(cursorYear + 1);
      setCursorMonth(0);
    } else {
      setCursorMonth(cursorMonth + 1);
    }
  };

  const handleSelect = (ymdStr: string) => {
    onChange(ymdStr);
    onClose();
  };

  const handleClear = () => {
    onChange('');
    onClose();
  };

  const handleToday = () => {
    if (min && cmp(todayYmd, min) < 0) return;
    if (max && cmp(todayYmd, max) > 0) return;
    handleSelect(todayYmd);
  };

  const todayDisabled =
    (!!min && cmp(todayYmd, min) < 0) || (!!max && cmp(todayYmd, max) > 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title || 'Pick a date'}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Ionicons name="close" size={24} color={colors.text2} />
            </TouchableOpacity>
          </View>

          {/* Month nav */}
          <View style={styles.monthNav}>
            <TouchableOpacity
              onPress={goPrev}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.monthLabel}>
              {MONTH_NAMES[cursorMonth]} {cursorYear}
            </Text>
            <TouchableOpacity
              onPress={goNext}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Weekday header */}
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={`${w}-${i}`} style={styles.weekday}>
                {w}
              </Text>
            ))}
          </View>

          {/* Grid */}
          <ScrollView contentContainerStyle={styles.grid}>
            {cells.map((c, idx) => {
              if (!c) {
                return <View key={`empty-${idx}`} style={styles.cell} />;
              }
              const selected = c === value;
              const isToday = c === todayYmd;
              const outOfRange =
                (!!min && cmp(c, min) < 0) || (!!max && cmp(c, max) > 0);
              const dayNum = parseInt(c.slice(8, 10), 10);
              return (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.cell,
                    selected && styles.cellSelected,
                    !selected && isToday && styles.cellToday,
                    outOfRange && styles.cellDisabled,
                  ]}
                  disabled={outOfRange}
                  onPress={() => handleSelect(c)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.cellText,
                      selected && styles.cellTextSelected,
                      !selected && isToday && styles.cellTextToday,
                      outOfRange && styles.cellTextDisabled,
                    ]}
                  >
                    {dayNum}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Actions */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnGhost]}
              onPress={handleClear}
              activeOpacity={0.7}
            >
              <Text style={styles.actionBtnGhostText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                styles.actionBtnPrimary,
                todayDisabled && styles.actionBtnDisabled,
              ]}
              onPress={handleToday}
              disabled={todayDisabled}
              activeOpacity={0.7}
            >
              <Text style={styles.actionBtnPrimaryText}>Today</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const CELL_SIZE = 40;

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
    paddingBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  monthLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  weekdayRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
  },
  cell: {
    width: `${100 / 7}%`,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  cellText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
    width: CELL_SIZE - 6,
    height: CELL_SIZE - 6,
    textAlign: 'center',
    textAlignVertical: 'center',
    lineHeight: CELL_SIZE - 6,
    borderRadius: (CELL_SIZE - 6) / 2,
  },
  cellSelected: {},
  cellTextSelected: {
    backgroundColor: colors.accent,
    color: colors.white,
    fontWeight: fontWeight.bold,
  },
  cellToday: {},
  cellTextToday: {
    borderWidth: 1,
    borderColor: colors.accent,
    color: colors.accent,
  },
  cellDisabled: {},
  cellTextDisabled: {
    color: colors.text3,
    opacity: 0.4,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnGhost: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnGhostText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  actionBtnPrimary: { backgroundColor: colors.accent },
  actionBtnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  actionBtnDisabled: { opacity: 0.5 },
});
