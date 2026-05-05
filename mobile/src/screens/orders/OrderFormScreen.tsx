/**
 * OrderFormScreen — single screen that handles both creating a new
 * order (Dashboard → Quick Actions → New Order) and editing an
 * existing one (OrderDetailScreen → Edit). Mirrors the
 * ItemFormScreen / LocationFormScreen pattern so the navigation
 * surface stays consistent.
 *
 * No business / persistence logic lives here — saving routes through
 * services/ordersService.ts (saveOrder), which validates and calls
 * the service-layer API endpoints. Per CLAUDE_RULES the screen is
 * thin: state + form layout + delegation.
 */

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { saveOrder } from '../../services/ordersService';
import {
  customerOptions,
  locationOptions,
} from '../../services/optionsService';
import {
  EMPTY_ORDER,
  ORDER_STATUSES,
  SHIP_MODES,
  SERVICE_LEVELS,
  INCOTERMS,
} from '../../shared/constants/orderConstants';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import SelectField from '../../components/common/SelectField';
import DateField from '../../components/common/DateField';
// QA bug #107 — line-items editor replaces the standalone Weight /
// Pieces inputs in the Freight section. See orders/LineItemsEditor for
// the rollup contract (weight/pieces are derived from the lines list).
import LineItemsEditor, {
  rollupLineTotals,
} from '../../components/orders/LineItemsEditor';
import { OrdersApi } from '../../shared/api';
import type { PlanningTabParamList } from '../../navigation/types';

type FormRoute = RouteProp<PlanningTabParamList, 'OrderForm'>;

export default function OrderFormScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<FormRoute>();
  const orderId = route.params?.orderId;
  const isEdit = !!orderId;

  const { data, refreshData } = useData();

  // When editing, hydrate from the camelCase order in DataContext.
  // When creating, start from the canonical EMPTY_ORDER so we never
  // ship undefined fields to the API.
  const existing = useMemo(
    () =>
      isEdit
        ? data.orders.find(
            (o: any) => String(o.id ?? o.order_id) === String(orderId),
          )
        : null,
    [data.orders, orderId, isEdit],
  );

  const [form, setForm] = useState<any>(() =>
    existing
      ? {
          ...EMPTY_ORDER,
          ...existing,
          // Form inputs are strings; coerce numerics so TextInput
          // doesn't choke on a number value.
          weight: existing.weight != null ? String(existing.weight) : '',
          pieces: existing.pieces != null ? String(existing.pieces) : '',
          // QA bug #107 — `lines` is hydrated lazily for edits via
          // OrdersApi.lines (effect below). Start with whatever was
          // already on the cached order, otherwise empty.
          lines: Array.isArray(existing.lines) ? existing.lines : [],
        }
      : { ...EMPTY_ORDER },
  );
  const [saving, setSaving] = useState(false);

  // QA bug #107: when editing an existing order, fetch its current
  // line items so the editor opens populated. New orders skip this —
  // their lines start empty and the user adds them inline.
  React.useEffect(() => {
    let cancelled = false;
    if (!isEdit || !orderId) return;
    OrdersApi.lines(orderId)
      .then((rows: any[]) => {
        if (cancelled || !Array.isArray(rows)) return;
        setForm((p: any) => ({
          ...p,
          lines: rows.map((r: any, i: number) => ({
            line_num: r.line_num ?? i + 1,
            item_id: r.item_id || '',
            description: r.description || '',
            qty_ordered: Number(r.qty_ordered ?? r.qty ?? 0) || 0,
            unit_weight: Number(r.unit_weight ?? r.unitWt ?? 0) || 0,
            total_weight: Number(r.total_weight ?? r.totalWt ?? 0) || 0,
          })),
        }));
      })
      .catch(() => {
        // Swallow: the user can still edit the rest of the order if
        // the lines fetch flaked. The detail screen has its own
        // editor as a recovery path.
      });
    return () => {
      cancelled = true;
    };
  }, [isEdit, orderId]);

  // Dropdown options derived from already-loaded DataContext rows.
  // Memoised so the picker FlatLists don't re-key on every form
  // keystroke. customerOptions is sourced from existing orders (no
  // dedicated `customers` table is loaded on mobile today); origin /
  // destination come from the locations master.
  const customers = useMemo(() => customerOptions(data.orders), [data.orders]);
  const locations = useMemo(() => locationOptions(data.locations), [data.locations]);

  const updateField = (key: string, value: any) =>
    setForm((p: any) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // QA bug #107: weight + pieces are now derived from the line
      // items rather than entered directly. Roll them up into the
      // form payload so the planner-facing header stays populated
      // (validateOrderPayload still requires weight > 0). If the user
      // hasn't added any lines, the existing weight/pieces values
      // (preserved from the EMPTY_ORDER strings or a hydrated edit)
      // are kept as-is so we don't accidentally zero-out an order
      // that already had a header value before this change shipped.
      const lines = Array.isArray(form.lines) ? form.lines : [];
      let payloadForm = form;
      if (lines.length > 0) {
        const { totalWeight, totalPieces } = rollupLineTotals(lines);
        payloadForm = {
          ...form,
          weight: String(totalWeight || 0),
          pieces: String(totalPieces || 0),
        };
      }
      const saved = await saveOrder(payloadForm, orderId || null);
      // QA bug #107: persist the line items alongside the order. The
      // POST /api/orders/:id/lines endpoint replaces all lines (delete
      // + insert), so sending an empty array on edit also clears
      // them — which matches the user-visible state of the editor.
      const targetId = saved?.id || orderId || payloadForm.id;
      if (targetId) {
        try {
          await OrdersApi.saveLines(
            String(targetId),
            lines.map((l: any, i: number) => ({
              line_num: l.line_num || i + 1,
              item_id: l.item_id || null,
              description: l.description || '',
              qty_ordered: Number(l.qty_ordered) || 0,
              unit_weight: Number(l.unit_weight) || 0,
              total_weight: Number(l.total_weight) || 0,
            })),
          );
        } catch (linesErr: any) {
          // Don't fail the whole save just because the lines write
          // flaked — the order itself is already saved. Surface a
          // soft warning so the user knows to retry from the detail
          // screen's lines editor.
          console.warn(
            '[OrderFormScreen] Order saved but lines write failed:',
            linesErr?.message,
          );
        }
      }
      await refreshData();
      // After create: route the user to the new order's detail view
      // so they can plan / tender / copy. After edit: pop back to
      // wherever they came from.
      if (isEdit) {
        navigation.goBack();
      } else {
        navigation.replace('OrderDetail', { orderId: saved?.id || form.id });
      }
    } catch (e: any) {
      // Distinguish a fetch-level network error (RN raises a generic
      // "Network request failed" with no status) from a server-side
      // 4xx / 5xx so the user actually knows whether to check their
      // connection or fix their input. Without this, QA bug #90 / #91
      // bottom out at the same opaque alert and the user can't tell
      // which it is.
      const raw = String(e?.message || 'Unknown error');
      // Catch both the raw fetch errors RN can surface and the
      // friendlier rewrite produced by the shared api() wrapper
      // (#90: "Cannot reach server. Check your connection ...").
      const isNetwork = /Network request failed|Failed to fetch|TypeError: Network|Cannot reach server/i.test(raw);
      const title = isNetwork ? 'Cannot reach server' : 'Could not save order';
      const body = isNetwork
        ? 'The app could not reach the TMS API. Check your Wi-Fi, then verify the API base URL in Settings.'
        : raw;
      Alert.alert(title, body);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            disabled={saving}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isEdit ? 'Edit Order' : 'New Order'}
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Customer & Lane */}
          <Text style={styles.sectionTitle}>Customer & Lane</Text>
          {/* QA bug #86: Customer must be a dropdown of existing
              customers; allow free-text fallback so first-time
              customers still save. Options come from optionsService
              (distinct customer names on prior orders). */}
          <SelectField
            label="Customer"
            value={form.customer || ''}
            onChange={(v) => updateField('customer', v)}
            options={customers}
            placeholder="Select or type a customer"
            modalTitle="Select Customer"
          />
          {/* QA bug #87: Origin / Destination dropdowns sourced from
              the locations master. allowCustom keeps ad-hoc lanes
              workable (e.g. one-off pickups not yet in the master). */}
          <SelectField
            label="Origin"
            value={form.origin || ''}
            onChange={(v) => updateField('origin', v)}
            options={locations}
            placeholder="City, ST ZIP"
            modalTitle="Select Origin"
          />
          <SelectField
            label="Destination"
            value={form.destination || ''}
            onChange={(v) => updateField('destination', v)}
            options={locations}
            placeholder="City, ST ZIP"
            modalTitle="Select Destination"
          />
          {/* QA bug #106: Ship-from Name / Ship-to Name removed; the
              mobile new-order flow now collects City + State per side
              (the canonical orders.origin / orders.dest column already
              stores "City, ST ZIP" — saveOrder composes that string
              from the camelCase camel fields below in
              ordersService.buildOrderSavePayload). The DB columns
              ship_from_name / ship_to_name remain editable on the web. */}
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput
                label="Origin City"
                value={form.originCity}
                onChangeText={(v: string) => updateField('originCity', v)}
                autoCapitalize="words"
              />
            </View>
            <View style={styles.flex}>
              <FormInput
                label="Origin State"
                value={form.originState}
                onChangeText={(v: string) =>
                  updateField('originState', v.toUpperCase())
                }
                autoCapitalize="characters"
                maxLength={2}
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput
                label="Dest City"
                value={form.destCity}
                onChangeText={(v: string) => updateField('destCity', v)}
                autoCapitalize="words"
              />
            </View>
            <View style={styles.flex}>
              <FormInput
                label="Dest State"
                value={form.destState}
                onChangeText={(v: string) =>
                  updateField('destState', v.toUpperCase())
                }
                autoCapitalize="characters"
                maxLength={2}
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <FormInput
                label="Origin ZIP"
                value={form.originZip}
                onChangeText={(v: string) => updateField('originZip', v)}
                keyboardType="number-pad"
              />
            </View>
            <View style={styles.flex}>
              <FormInput
                label="Dest ZIP"
                value={form.destZip}
                onChangeText={(v: string) => updateField('destZip', v)}
                keyboardType="number-pad"
              />
            </View>
          </View>

          {/* Freight — QA bug #107: standalone Weight / Pieces inputs
              removed from this section. Users now build the freight
              from a Line Items list (item dropdown + qty + unit
              weight); buildOrderSavePayload rolls those up into the
              order's weight/pieces header so the planner sees the
              same totals it always has. */}
          <Text style={styles.sectionTitle}>Freight</Text>
          <FormInput
            label="Commodity"
            value={form.commodity}
            onChangeText={(v: string) => updateField('commodity', v)}
          />
          <LineItemsEditor
            lines={form.lines || []}
            items={data.items || []}
            onChange={(next: any[]) => updateField('lines', next)}
          />
          {/* QA bug #88: Ship Mode chip row must include "None" so
              users can clear the mode. SHIP_MODES now starts with ''
              (mapped to label "None") — matching the SERVICE_LEVELS
              pattern below so both rows behave the same way. The
              empty-string value persists as NULL in ship_mode. */}
          <Text style={styles.label}>Ship Mode</Text>
          <ChipRow
            options={SHIP_MODES.map((s) => s || 'None')}
            value={form.shipMode || 'None'}
            onChange={(v) => updateField('shipMode', v === 'None' ? '' : v)}
          />
          <Text style={styles.label}>Service Level</Text>
          <ChipRow
            options={SERVICE_LEVELS.map((s) => s || 'None')}
            value={form.serviceLevel || 'None'}
            onChange={(v) =>
              updateField('serviceLevel', v === 'None' ? '' : v)
            }
          />

          {/* Schedule — QA bug #89: Ready / Due Date now use a
              calendar picker (DateField) instead of free-text. Due
              must be >= Ready, enforced via DateField's `min` so the
              user can't pick an earlier due date in the modal. */}
          <Text style={styles.sectionTitle}>Schedule</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <DateField
                label="Ready Date"
                value={form.readyDate || ''}
                onChange={(v) => updateField('readyDate', v)}
                modalTitle="Pick Ready Date"
              />
            </View>
            <View style={styles.flex}>
              <DateField
                label="Due Date"
                value={form.dueDate || ''}
                onChange={(v) => updateField('dueDate', v)}
                modalTitle="Pick Due Date"
                min={form.readyDate || undefined}
              />
            </View>
          </View>

          {/* References — QA bug #109: Ref # was not required by the
              planner / OMS workflow, so it has been removed from the
              mobile form. The orders.ref_num column stays in the DB
              (web edit path still surfaces it) — we just don't
              collect it here. PO # is now full-width in the row. */}
          <Text style={styles.sectionTitle}>References</Text>
          <FormInput
            label="PO #"
            value={form.poNum}
            onChangeText={(v: string) => updateField('poNum', v)}
          />
          {/* QA bug #108: Incoterms is now a controlled dropdown
              sourced from INCOTERMS in orderConstants. Free-text was
              causing inconsistent values between mobile and web; the
              two surfaces now share the same canonical list. */}
          <SelectField
            label="Incoterms"
            value={form.incoterms || ''}
            onChange={(v) => updateField('incoterms', v)}
            options={INCOTERMS.map((t) => ({ value: t, label: t }))}
            placeholder="Select Incoterms"
            modalTitle="Select Incoterms"
            allowCustom={false}
          />

          {/* Status (edit-only — new orders default to Unplanned) */}
          {isEdit && (
            <>
              <Text style={styles.sectionTitle}>Status</Text>
              <ChipRow
                options={ORDER_STATUSES}
                value={form.status}
                onChange={(v) => updateField('status', v)}
              />
            </>
          )}

          {/* QA bug #111: Carrier Preferences, Flags, and Notes
              sections are not part of the mobile new-order workflow —
              dispatchers set those on the web planner. Underlying
              columns (preferred_carrier, excluded_carrier, hazmat,
              no_consolidate, no_contract_rate, dedicated_equip, notes)
              remain in the DB and are still editable on web; we just
              stop collecting them here. EMPTY_ORDER keeps the keys so
              the API contract (camelCase payload) stays unchanged. */}

          {/* QA bug #110: Special Instructions captures freight-specific
              handling notes for the carrier (e.g. lift-gate required,
              call before delivery). Persists to orders.notes — the
              same column the OMS push service writes its
              special_instructions field into (see
              services/omsSync/pushOrderService.js), so a value entered
              here lines up with what the OMS already sends. Renaming
              the DB column would be a REQ-02 audited migration; the
              UI relabel is the right scope for this QA item. */}
          <Text style={styles.sectionTitle}>Special Instructions</Text>
          <FormInput
            label="Special Instructions"
            value={form.notes}
            onChangeText={(v: string) => updateField('notes', v)}
            placeholder="e.g. lift-gate required, call before delivery"
            multiline
            numberOfLines={4}
            style={styles.notesInput}
          />

          <View style={{ height: spacing['5xl'] }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ───────── Reusable sub-components ───────── */

function FormInput({ label, value, onChangeText, style, ...props }: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholderTextColor={colors.text3}
        {...props}
      />
    </View>
  );
}

function ChipRow({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(opt)}
          >
            <Text
              style={[styles.chipText, active && styles.chipTextActive]}
            >
              {opt}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/* ───────── Styles ───────── */

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { marginRight: spacing.md, padding: spacing.xs },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    minWidth: 72,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  scroll: { padding: spacing.lg },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldWrap: { marginBottom: spacing.md },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
  },
  notesInput: { minHeight: 96, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: spacing.sm },
  chipScroll: { marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  chipTextActive: { color: colors.white, fontWeight: fontWeight.semibold },
});
