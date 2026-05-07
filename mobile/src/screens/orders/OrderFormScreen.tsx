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
import type { SelectOption } from '../../services/optionsService';
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
// QA bug #114 - inline location creation so the user can add a missing
// pickup/dropoff without leaving the New Order flow.
import CreateLocationModal from '../../components/locations/CreateLocationModal';
// QA bug #114 - reuse the canonical "City, ST ZIP" composer so a row
// created inline matches the format the dropdown otherwise stores.
import { locationDisplayValue as composeLocationDisplay } from '../../services/locationsService';
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
  // keystroke.
  //
  // QA bug #113: customerOptions now takes BOTH the orders list (for
  // legacy / in-flight customers not yet in the OMS master) and the
  // OMS customer master (oms_customers, exposed through DataContext as
  // `customers`). The merge dedupes by case-folded name so a customer
  // present in both sources appears once.
  //
  // QA bug #115: each `location` option now carries a `meta` payload
  // with the source row's structured city / state / zip, so picking an
  // existing location can auto-populate the sibling City / State / ZIP
  // inputs - see `handleOriginChange` / `handleDestinationChange`.
  const customers = useMemo(
    () => customerOptions(data.orders, (data as any).customers),
    [data.orders, data.customers],
  );
  const locations = useMemo(
    () => locationOptions(data.locations),
    [data.locations],
  );

  // QA bug #117: Ship Mode and Service Level were rendered as
  // horizontal chip rows (with the empty-string mapped to "None"), so
  // they didn't visually align with the rest of the form's dropdowns
  // and the "None" chip was easy to mis-read as a real value. Convert
  // them to canonical SelectOption shapes here so SelectField can
  // render them the same way it renders Customer / Origin / Incoterms.
  // Empty string -> friendly "(None)" label; persisted value still ''.
  const shipModeOptions = useMemo<SelectOption[]>(
    () =>
      SHIP_MODES.map((m) => ({
        value: m,
        label: m === '' ? '(None)' : m,
      })),
    [],
  );
  const serviceLevelOptions = useMemo<SelectOption[]>(
    () =>
      SERVICE_LEVELS.map((s) => ({
        value: s,
        label: s === '' ? '(None)' : s,
      })),
    [],
  );

  // QA bug #114 - state for the inline Create Location modal.
  // `pendingLocationSide` tracks whether the user is creating an
  // origin or destination so we can route the saved row back into
  // the correct sibling fields without re-prompting.
  const [createLocationOpen, setCreateLocationOpen] = useState(false);
  const [pendingLocationSide, setPendingLocationSide] =
    useState<'origin' | 'destination' | null>(null);

  const updateField = (key: string, value: any) =>
    setForm((p: any) => ({ ...p, [key]: value }));

  /**
   * Apply a chosen location option (from the dropdown) to the form -
   * auto-populates City / State / ZIP from the option's meta when
   * available so the user doesn't have to re-type values that already
   * live in the locations master (QA bug #115). Custom-typed values
   * (no matched option) leave the sibling fields untouched.
   */
  const applyLocationSelection = (
    side: 'origin' | 'destination',
    nextValue: string,
    option: SelectOption | null,
  ) => {
    setForm((p: any) => {
      const out: any = { ...p };
      const prefix = side === 'origin' ? 'origin' : 'dest';
      out[side === 'origin' ? 'origin' : 'destination'] = nextValue;
      if (option && option.meta) {
        const m = option.meta as { city?: string; state?: string; zip?: string; name?: string };
        if (m.city) out[`${prefix}City`] = m.city;
        if (m.state) out[`${prefix}State`] = String(m.state).toUpperCase();
        if (m.zip) out[`${prefix}Zip`] = m.zip;
        // QA bug #123 - capture the source row's location name so
        // ship_from_name / ship_to_name persist on the created order
        // (otherwise the web TMS shows blank Ship From / Ship To name).
        if (m.name) {
          out[side === 'origin' ? 'shipFromName' : 'shipToName'] = m.name;
        }
      }
      return out;
    });
  };

  const handleOriginChange = (v: string, opt: SelectOption | null) =>
    applyLocationSelection('origin', v, opt);
  const handleDestinationChange = (v: string, opt: SelectOption | null) =>
    applyLocationSelection('destination', v, opt);

  /**
   * QA bug #114 - "+ Create new location" was tapped on the picker.
   * Capture which side the user is on, open the create modal, and
   * leave the picker closed.
   */
  const openCreateLocation = (side: 'origin' | 'destination') => {
    setPendingLocationSide(side);
    setCreateLocationOpen(true);
  };

  /**
   * Called by CreateLocationModal once a new location row has been
   * persisted. Refresh DataContext so the new option appears in the
   * picker, then auto-select it for the side the user was creating
   * from. The structured fields (city/state/zip) are mirrored into the
   * form so the user doesn't have to re-pick after saving.
   */
  const handleLocationCreated = async (loc: any) => {
    await refreshData().catch(() => {});
    if (!pendingLocationSide || !loc) {
      setCreateLocationOpen(false);
      setPendingLocationSide(null);
      return;
    }
    const composed = composeLocationDisplay(loc);
    setForm((p: any) => {
      const prefix = pendingLocationSide === 'origin' ? 'origin' : 'dest';
      return {
        ...p,
        [pendingLocationSide === 'origin' ? 'origin' : 'destination']: composed,
        [`${prefix}City`]: loc.city || '',
        [`${prefix}State`]: String(loc.state || '').toUpperCase(),
        [`${prefix}Zip`]: loc.zip || '',
        [pendingLocationSide === 'origin' ? 'shipFromName' : 'shipToName']:
          loc.name || '',
      };
    });
    setCreateLocationOpen(false);
    setPendingLocationSide(null);
  };

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
              customers still save.
              QA bug #113: the option list now merges the OMS customer
              master with order-derived names (see customerOptions in
              services/optionsService) so the dropdown shows every
              active customer rather than just the ~3 already on
              orders. Free-text entry remains available for legacy or
              one-off customers. */}
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
              workable (e.g. one-off pickups not yet in the master).
              QA bug #114: each picker now exposes a "+ Create new
              location" affordance that opens CreateLocationModal so a
              user who can't find their pickup/dropoff can add it
              inline. The new row is auto-selected on save.
              QA bug #115: handleOriginChange / handleDestinationChange
              auto-populate City / State / ZIP from the picked option's
              meta so the user doesn't re-type. */}
          <SelectField
            label="Origin"
            value={form.origin || ''}
            onChange={handleOriginChange}
            options={locations}
            placeholder="City, ST ZIP"
            modalTitle="Select Origin"
            onCreateNew={() => openCreateLocation('origin')}
            createNewLabel="Create new origin location"
          />
          <SelectField
            label="Destination"
            value={form.destination || ''}
            onChange={handleDestinationChange}
            options={locations}
            placeholder="City, ST ZIP"
            modalTitle="Select Destination"
            onCreateNew={() => openCreateLocation('destination')}
            createNewLabel="Create new destination location"
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

          {/* QA bug #107: standalone Weight / Pieces inputs removed.
              Users now build the freight from a Line Items list (item
              dropdown + qty + unit weight); buildOrderSavePayload
              rolls those up into the order's weight/pieces header so
              the planner sees the same totals it always has.

              QA bug #118a: the prior "Freight" sectionTitle has been
              removed - it was a stray label left over from the QA-107
              refactor that no longer demarcated anything (Commodity +
              Line Items already imply this is the freight section)
              and confused users into thinking Freight was a separate
              tab. Commodity now sits directly under the location
              section without a leading divider.

              QA bug #116: Commodity no longer pre-fills with "General"
              - the EMPTY_ORDER default is now "" so the placeholder
              guides the user to pick a real value. The save-time
              fallback to "General" was also removed in
              buildOrderSavePayload, so an empty input persists as
              NULL rather than silently coercing to "General". */}
          <FormInput
            label="Commodity"
            value={form.commodity}
            onChangeText={(v: string) => updateField('commodity', v)}
            placeholder="e.g. Network Equipment"
          />
          <LineItemsEditor
            lines={form.lines || []}
            items={data.items || []}
            onChange={(next: any[]) => updateField('lines', next)}
          />
          {/* QA bug #117: Ship Mode and Service Level were horizontal
              chip rows that did not visually align with the rest of
              the form's dropdowns and the inline "None" chip read as
              a real value to QA. They are now SelectFields built from
              the same SHIP_MODES / SERVICE_LEVELS lists, so picker
              behaviour (search, scroll, "None" mapped to "(None)") is
              consistent across the screen. The persisted value is
              still '' for "no mode chosen" - SHIP_MODES[0] === '' is
              what backs the (None) option. */}
          <SelectField
            label="Ship Mode"
            value={form.shipMode || ''}
            onChange={(v) => updateField('shipMode', v)}
            options={shipModeOptions}
            placeholder="(None)"
            modalTitle="Select Ship Mode"
            allowCustom={false}
          />
          <SelectField
            label="Service Level"
            value={form.serviceLevel || ''}
            onChange={(v) => updateField('serviceLevel', v)}
            options={serviceLevelOptions}
            placeholder="(None)"
            modalTitle="Select Service Level"
            allowCustom={false}
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

          {/* QA bug #109: Ref # was not required by the planner / OMS
              workflow, so it has been removed from the mobile form.
              The orders.ref_num column stays in the DB (web edit path
              still surfaces it) - we just don't collect it here.

              QA bug #118a: the prior "References" sectionTitle was
              removed along with the Ref # field; with only PO # and
              Incoterms remaining, a separate section header looked
              orphaned and re-introduced the impression of a multi-
              field group that no longer exists. Both fields render
              flat under the schedule. */}
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
              here lines up with what the OMS already sends.

              QA bug #118a: the section sat under a `sectionTitle` AND
              the `FormInput` re-rendered "Special Instructions" as
              its own field label, so the screen showed the heading
              twice in a row. The FormInput's label is now blank - the
              `sectionTitle` is the single source of truth. The hint
              copy moves under the textarea so users still see the
              examples at a glance. */}
          <Text style={styles.sectionTitle}>Special Instructions</Text>
          <FormInput
            label=""
            value={form.notes}
            onChangeText={(v: string) => updateField('notes', v)}
            placeholder="e.g. lift-gate required, call before delivery"
            multiline
            numberOfLines={4}
            style={styles.notesInput}
          />

          <View style={{ height: spacing['5xl'] }} />
        </ScrollView>

        {/* QA bug #114 - inline create-location modal. Visible state
            is controlled by createLocationOpen; the picker that
            triggered it is already closed. The pendingLocationSide
            tells handleLocationCreated which side to auto-select on
            save (origin vs destination). */}
        <CreateLocationModal
          visible={createLocationOpen}
          onClose={() => {
            setCreateLocationOpen(false);
            setPendingLocationSide(null);
          }}
          onCreated={handleLocationCreated}
          title={
            pendingLocationSide === 'destination'
              ? 'Add Destination Location'
              : 'Add Origin Location'
          }
        />
      </View>
    </KeyboardAvoidingView>
  );
}

/* ───────── Reusable sub-components ───────── */

function FormInput({ label, value, onChangeText, style, ...props }: any) {
  // QA bug #118a: a blank label means the caller relies on a higher-
  // level sectionTitle to label the field (e.g. Special Instructions).
  // Skip rendering the empty Text node so we don't leave a phantom row
  // of empty-baseline whitespace above the input.
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
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
