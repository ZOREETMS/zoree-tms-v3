/**
 * RouteFormModal — slide-up sheet for creating, viewing, or editing
 * a multi-stop route template.
 *
 * Mobile mirror of the union of:
 *   frontend/src/components/multi-stop/RouteEditModal.jsx
 *   frontend/src/components/multi-stop/RouteDetailModal.jsx
 *   frontend/src/components/multi-stop/StopsEditor.jsx
 *
 * Combined into one sheet because mobile screen real estate doesn't
 * benefit from the web's separate "view" vs "edit" affordance.
 *
 * The web includes a LocationPicker that does live geocoded search;
 * mobile uses plain city / state inputs. When location-search lands
 * here later, it slots into the same `updateStopField` calls.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  addStop,
  deleteRoute,
  emptyRoute,
  moveStop,
  removeStop,
  saveRoute,
  updateStopField,
  type RouteStop,
  type RouteTemplate,
} from '../../services/routeService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const MODES = ['TL', 'LTL', 'Intermodal', 'Flatbed'] as const;
const STATUSES = ['Active', 'Inactive'] as const;

export interface RouteFormModalProps {
  visible: boolean;
  /** Existing route row for edit, or null/undefined for create. */
  route?: any | null;
  onClose: () => void;
  onSaved?: (saved: any) => void | Promise<void>;
}

function fromRow(row: any): RouteTemplate {
  if (!row) return emptyRoute();
  return {
    id: row.id || emptyRoute().id,
    name: row.name || '',
    mode: row.mode || 'TL',
    carrier: row.carrier || '',
    max_weight: row.max_weight ?? 44000,
    cost_override: row.cost_override ?? '',
    miles_override: row.miles_override ?? '',
    transit_days: row.transit_days ?? '',
    status: row.status || 'Active',
    notes: row.notes || '',
    stops: Array.isArray(row.stops) && row.stops.length > 0 ? row.stops : emptyRoute().stops,
    total_miles: row.total_miles || 0,
  };
}

export default function RouteFormModal({
  visible,
  route,
  onClose,
  onSaved,
}: RouteFormModalProps) {
  const isEdit = !!(route && route.id);
  const [form, setForm] = useState<RouteTemplate>(() => fromRow(route));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible && !busy) setForm(fromRow(route));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, route]);

  const set = <K extends keyof RouteTemplate>(key: K, value: RouteTemplate[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setStop = <K extends keyof RouteStop>(idx: number, key: K, value: RouteStop[K]) =>
    setForm((prev) => ({ ...prev, stops: updateStopField(prev.stops, idx, key, value) }));

  const handleAddPickup = () => set('stops', addStop(form.stops, 'pickup'));
  const handleAddDelivery = () => set('stops', addStop(form.stops, 'delivery'));
  const handleRemoveStop = (idx: number) => set('stops', removeStop(form.stops, idx));
  const handleMoveUp = (idx: number) =>
    idx > 0 && set('stops', moveStop(form.stops, idx, idx - 1));
  const handleMoveDown = (idx: number) =>
    idx < form.stops.length - 1 && set('stops', moveStop(form.stops, idx, idx + 1));

  async function handleSubmit() {
    setBusy(true);
    try {
      const saved = await saveRoute(form);
      if (onSaved) await onSaved(saved);
      onClose();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save route');
    } finally {
      setBusy(false);
    }
  }

  function handleDelete() {
    if (!isEdit || !form.id) return;
    Alert.alert(
      'Delete Route',
      `Permanently delete "${form.name || form.id}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteRoute(form.id);
              if (onSaved) await onSaved({ deleted: true, id: form.id });
              onClose();
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message || 'Could not delete route');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => !busy && onClose()}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerLabel}>{isEdit ? 'Edit' : 'New'}</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {form.name || 'Route Template'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => !busy && onClose()}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              disabled={busy}
            >
              <Ionicons name="close" size={24} color={colors.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <SectionLabel label="Identity" />
            <Field
              label="Name"
              value={form.name}
              onChange={(v) => set('name', v)}
              placeholder="Chicago → Dallas overnight"
              required
            />
            <Field
              label="Carrier"
              value={form.carrier}
              onChange={(v) => set('carrier', v)}
              placeholder="e.g. XPO Logistics"
            />

            <Text style={styles.fieldLabel}>MODE</Text>
            <View style={styles.chipRow}>
              {MODES.map((m) => (
                <Chip key={m} label={m} active={form.mode === m} onPress={() => set('mode', m)} />
              ))}
            </View>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Max Weight (lbs)"
                  value={String(form.max_weight)}
                  onChange={(v) => set('max_weight', Number(v.replace(/[^0-9.]/g, '')) || 0)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Transit Days"
                  value={String(form.transit_days || '')}
                  onChange={(v) => set('transit_days', v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Miles Override"
                  value={String(form.miles_override || '')}
                  onChange={(v) => set('miles_override', v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  hint="Leave blank to auto-compute from stop coords."
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Cost Override ($)"
                  value={String(form.cost_override || '')}
                  onChange={(v) => set('cost_override', v.replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  hint="Optional — bypasses rate calc."
                />
              </View>
            </View>

            <Text style={styles.fieldLabel}>STATUS</Text>
            <View style={styles.chipRow}>
              {STATUSES.map((s) => (
                <Chip key={s} label={s} active={form.status === s} onPress={() => set('status', s)} />
              ))}
            </View>

            {/* Stops editor */}
            <View style={styles.stopsHeaderRow}>
              <SectionLabel label={`Stops (${form.stops.length})`} />
              <View style={styles.addStopRow}>
                <TouchableOpacity
                  style={[styles.addStopBtn, { borderColor: colors.accent }]}
                  onPress={handleAddPickup}
                  activeOpacity={0.7}
                >
                  <Ionicons name="arrow-up-circle-outline" size={14} color={colors.accent} />
                  <Text style={[styles.addStopText, { color: colors.accent }]}>Pickup</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addStopBtn, { borderColor: colors.green }]}
                  onPress={handleAddDelivery}
                  activeOpacity={0.7}
                >
                  <Ionicons name="arrow-down-circle-outline" size={14} color={colors.green} />
                  <Text style={[styles.addStopText, { color: colors.green }]}>Delivery</Text>
                </TouchableOpacity>
              </View>
            </View>

            {form.stops.map((stop, idx) => (
              <View key={idx} style={styles.stopCard}>
                <View style={styles.stopCardHeader}>
                  <View style={styles.stopBadge}>
                    <Text style={styles.stopBadgeText}>{stop.sequence || idx + 1}</Text>
                  </View>
                  <Text
                    style={[
                      styles.stopType,
                      stop.type === 'pickup' ? { color: colors.accent } : { color: colors.green },
                    ]}
                  >
                    {String(stop.type || '').toUpperCase()}
                    {stop.type === 'delivery' && stop.load_seq !== '' ? `  ·  Load #${stop.load_seq}` : ''}
                  </Text>
                  <View style={styles.stopActions}>
                    <TouchableOpacity onPress={() => handleMoveUp(idx)} disabled={idx === 0}>
                      <Ionicons
                        name="chevron-up"
                        size={18}
                        color={idx === 0 ? colors.text3 : colors.text2}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleMoveDown(idx)}
                      disabled={idx === form.stops.length - 1}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={18}
                        color={idx === form.stops.length - 1 ? colors.text3 : colors.text2}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRemoveStop(idx)}
                      disabled={form.stops.length <= 2}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={form.stops.length <= 2 ? colors.text3 : colors.red}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={[styles.flex1, { flex: 2 }]}>
                    <Field
                      label="City"
                      value={stop.city}
                      onChange={(v) => setStop(idx, 'city', v)}
                      required
                    />
                  </View>
                  <View style={styles.flex1}>
                    <Field
                      label="State"
                      value={stop.state}
                      onChange={(v) => setStop(idx, 'state', v.toUpperCase())}
                      maxLength={2}
                      placeholder="IL"
                    />
                  </View>
                </View>
                <Text style={styles.fieldLabel}>TYPE</Text>
                <View style={styles.chipRow}>
                  <Chip
                    label="Pickup"
                    active={stop.type === 'pickup'}
                    onPress={() => setStop(idx, 'type', 'pickup')}
                  />
                  <Chip
                    label="Delivery"
                    active={stop.type === 'delivery'}
                    onPress={() => setStop(idx, 'type', 'delivery')}
                  />
                </View>
              </View>
            ))}

            <SectionLabel label="Notes" />
            <Field
              label="Notes"
              value={form.notes}
              onChange={(v) => set('notes', v)}
              placeholder="Anything dispatchers should know"
              multiline
            />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => !busy && onClose()}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            {isEdit ? (
              <TouchableOpacity
                style={[styles.btn, styles.btnDanger, busy && styles.btnDisabled]}
                onPress={handleDelete}
                disabled={busy}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={18} color={colors.red} />
                <Text style={styles.btnDangerText}>Delete</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={busy}
              activeOpacity={0.7}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="save-outline" size={18} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>{isEdit ? 'Save' : 'Create'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  maxLength,
  keyboardType,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  hint?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label.toUpperCase()}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        style={[styles.input, multiline && styles.textarea]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        maxLength={maxLength}
        keyboardType={keyboardType || 'default'}
        multiline={!!multiline}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: 2,
  },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    letterSpacing: 0.5,
  },
  field: { marginBottom: spacing.md },
  fieldLabel: {
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
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  fieldHint: { fontSize: fontSize.xs, color: colors.text3, marginTop: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentGlow },
  chipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  chipTextActive: { color: colors.accent },
  stopsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  addStopRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  addStopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    backgroundColor: colors.bg2,
  },
  addStopText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  stopCard: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  stopCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  stopBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accentGlow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  stopType: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    flex: 1,
    letterSpacing: 0.5,
  },
  stopActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg2,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btnGhostText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  btnDanger: { borderWidth: 1, borderColor: colors.redDim, backgroundColor: 'transparent' },
  btnDangerText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.red },
  btnDisabled: { opacity: 0.7 },
});
