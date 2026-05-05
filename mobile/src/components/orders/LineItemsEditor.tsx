/**
 * LineItemsEditor — mobile parity port of the web OrderLinesEditor
 * (frontend/src/components/OrderLinesEditor.jsx, edit mode).
 *
 * QA bug #107 fix: the new-order Freight section previously asked for
 * a single Weight + Pieces value, which made every mobile-created
 * order roll up to the same header the planner saw on web — but with
 * no underlying line items the OMS push step (services/omsSync) had
 * to fabricate one. The mobile new-order form now collects line
 * items directly so weight/pieces become a derived total instead of
 * a primary input, and the order_lines write that previously only
 * happened on copy now happens on create too.
 *
 * Shape contract — each line:
 *   { line_num, item_id, description, qty_ordered, unit_weight,
 *     total_weight }
 * matches the body the POST /api/orders/:id/lines endpoint
 * already accepts (see api/server.js around the /orders/:id/lines
 * handler) and the row shape OrderLinesEditor uses on the web side,
 * so a mobile-created order is line-item-compatible with the
 * planner's existing tooling without an adapter.
 *
 * No business logic / persistence here — the editor is presentational
 * and bubbles every change up via onChange. Saving is the form's
 * responsibility (OrderFormScreen → saveOrder → OrdersApi.saveLines),
 * keeping the screen thin per CLAUDE_RULES.
 */

import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SelectField from '../common/SelectField';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';
import type { SelectOption } from '../../services/optionsService';

export interface OrderLine {
  line_num: number;
  item_id: string;
  description: string;
  qty_ordered: number;
  unit_weight: number;
  total_weight: number;
}

export interface LineItemsEditorProps {
  lines: OrderLine[];
  /** Item master rows from DataContext.data.items. */
  items: any[];
  onChange: (next: OrderLine[]) => void;
}

/* ───────── Pure helpers (exported for unit tests) ───────── */

export function rollupLineTotals(lines: OrderLine[] | null | undefined) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { totalWeight: 0, totalPieces: 0 };
  }
  let totalWeight = 0;
  let totalPieces = 0;
  for (const l of lines) {
    const w = Number(l?.total_weight || 0);
    const q = Number(l?.qty_ordered || 0);
    if (Number.isFinite(w)) totalWeight += w;
    if (Number.isFinite(q)) totalPieces += q;
  }
  // Round weight to 4dp to match the web safeMultiply rounding.
  return {
    totalWeight: Math.round(totalWeight * 10000) / 10000,
    totalPieces,
  };
}

function safeMultiply(a: number, b: number): number {
  return Math.round(a * b * 10000) / 10000;
}

function toNumber(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function itemOptionsFromMaster(items: any[] | null | undefined): SelectOption[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((it) => it && it.id)
    .map((it) => {
      const desc = String(it.description || it.desc || '').trim();
      const idStr = String(it.id);
      return {
        value: idStr,
        label: desc ? `${idStr} — ${desc.slice(0, 30)}` : idStr,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ───────── Component ───────── */

export default function LineItemsEditor({
  lines,
  items,
  onChange,
}: LineItemsEditorProps) {
  const itemOptions = React.useMemo(
    () => itemOptionsFromMaster(items),
    [items],
  );
  const totals = React.useMemo(() => rollupLineTotals(lines), [lines]);

  const updateLine = (index: number, patch: Partial<OrderLine>) => {
    const next = lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
    onChange(next);
  };

  const handleSelectItem = (index: number, itemId: string) => {
    const item = items?.find?.((it: any) => String(it?.id) === String(itemId));
    const unitWt = toNumber(
      item?.weight_unit ?? item?.weight_per_unit ?? item?.weightUnit ?? 0,
    );
    const qty = toNumber(lines[index]?.qty_ordered, 1);
    const desc = item
      ? `${item.id} — ${(item.description || item.desc || '').slice(0, 30)}`
      : '';
    updateLine(index, {
      item_id: itemId,
      description: desc,
      unit_weight: unitWt,
      total_weight: safeMultiply(qty, unitWt),
    });
  };

  const handleQtyChange = (index: number, raw: string) => {
    const qty = toNumber(raw, 0);
    const unitWt = toNumber(lines[index]?.unit_weight);
    updateLine(index, {
      qty_ordered: qty,
      total_weight: safeMultiply(qty, unitWt),
    });
  };

  const handleUnitWeightChange = (index: number, raw: string) => {
    const unitWt = toNumber(raw, 0);
    const qty = toNumber(lines[index]?.qty_ordered, 1);
    updateLine(index, {
      unit_weight: unitWt,
      total_weight: safeMultiply(qty, unitWt),
    });
  };

  const handleAddLine = () => {
    const next: OrderLine = {
      line_num: lines.length + 1,
      item_id: '',
      description: '',
      qty_ordered: 1,
      unit_weight: 0,
      total_weight: 0,
    };
    onChange([...lines, next]);
  };

  const handleRemoveLine = (index: number) => {
    // Renumber line_num after removal so we don't leave gaps —
    // matches OrderLinesEditor.jsx removeLine on web.
    const next = lines
      .filter((_, i) => i !== index)
      .map((l, i) => ({ ...l, line_num: i + 1 }));
    onChange(next);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Line Items</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={handleAddLine}
          activeOpacity={0.7}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
          <Text style={styles.addBtnText}>Add line</Text>
        </TouchableOpacity>
      </View>

      {lines.length === 0 ? (
        <Text style={styles.emptyText}>
          No line items yet. Tap "Add line" to start.
        </Text>
      ) : (
        lines.map((line, idx) => (
          <View key={`line-${idx}`} style={styles.lineCard}>
            <View style={styles.lineHeader}>
              <Text style={styles.lineNum}>#{line.line_num || idx + 1}</Text>
              <TouchableOpacity
                onPress={() => handleRemoveLine(idx)}
                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              >
                <Ionicons name="trash-outline" size={18} color={colors.red} />
              </TouchableOpacity>
            </View>

            <SelectField
              label="Item"
              value={String(line.item_id || '')}
              onChange={(v) => handleSelectItem(idx, v)}
              options={itemOptions}
              placeholder="Select item from master"
              modalTitle="Select Item"
              allowCustom={false}
            />

            <View style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.subLabel}>Qty</Text>
                <TextInput
                  style={styles.input}
                  value={String(line.qty_ordered ?? '')}
                  onChangeText={(v) => handleQtyChange(idx, v)}
                  keyboardType="numeric"
                  placeholderTextColor={colors.text3}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.subLabel}>Unit Wt (lbs)</Text>
                <TextInput
                  style={styles.input}
                  value={String(line.unit_weight ?? '')}
                  onChangeText={(v) => handleUnitWeightChange(idx, v)}
                  keyboardType="numeric"
                  placeholderTextColor={colors.text3}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.subLabel}>Total Wt</Text>
                <View style={[styles.input, styles.totalReadonly]}>
                  <Text style={styles.totalText}>
                    {Number(line.total_weight || 0).toLocaleString()}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ))
      )}

      {/* Rollup so the planner-facing weight / pieces totals are
          visible to the user before they save. saveOrder mirrors
          these into the order's weight/pieces header. */}
      <View style={styles.totalsRow}>
        <Text style={styles.totalsText}>
          Pieces: <Text style={styles.totalsValue}>{totals.totalPieces}</Text>
        </Text>
        <Text style={styles.totalsText}>
          Total Weight:{' '}
          <Text style={styles.totalsValue}>
            {Number(totals.totalWeight).toLocaleString()} lbs
          </Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.text3,
    fontStyle: 'italic',
    paddingVertical: spacing.sm,
  },
  lineCard: {
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  lineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  lineNum: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  subLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: fontSize.md,
    color: colors.text,
    minHeight: 36,
  },
  totalReadonly: {
    justifyContent: 'center',
    backgroundColor: colors.bg3,
  },
  totalText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  totalsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalsText: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
  totalsValue: {
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
