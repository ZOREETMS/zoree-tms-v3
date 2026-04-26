/**
 * InvoiceFormModal — slide-up sheet for creating or editing an invoice.
 *
 * Mobile mirror of frontend/src/components/invoices/InvoiceModal.jsx.
 * Trimmed: shipment / carrier are chip pickers fed by the data layer
 * (no async search). Web's "additional shipment IDs" consolidation
 * field is included as a free-text input.
 *
 * Form state and persistence live in mobile/src/services/invoiceService.ts.
 */

import React, { useEffect, useMemo, useState } from 'react';
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
  INVOICE_STATUSES,
  PAYMENT_TERMS,
  buildBlankInvoice,
  buildInvoiceFormFromRow,
  recomputeDueDate,
  saveInvoice,
  type InvoiceFormState,
} from '../../services/invoiceService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface InvoiceFormModalProps {
  visible: boolean;
  /** Existing invoice row for edit, or null/undefined for create. */
  invoice?: any | null;
  /** Carrier list — accepts {name} objects or plain strings. */
  carriers?: Array<{ name?: string } | string>;
  /** Available shipments to attach the invoice to. */
  shipments?: Array<any>;
  onClose: () => void;
  /** Called after a successful save (create or edit). */
  onSaved?: (saved: any) => void | Promise<void>;
}

export default function InvoiceFormModal({
  visible,
  invoice,
  carriers,
  shipments,
  onClose,
  onSaved,
}: InvoiceFormModalProps) {
  const isEdit = !!(invoice && (invoice.id || invoice.invoice_id || invoice.num));

  const [form, setForm] = useState<InvoiceFormState>(() =>
    isEdit ? buildInvoiceFormFromRow(invoice) : buildBlankInvoice(),
  );
  const [busy, setBusy] = useState(false);

  // Re-seed when modal opens or invoice changes underneath us.
  useEffect(() => {
    if (visible && !busy) {
      setForm(isEdit ? buildInvoiceFormFromRow(invoice) : buildBlankInvoice());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, invoice]);

  const set = <K extends keyof InvoiceFormState>(key: K, value: InvoiceFormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value } as InvoiceFormState;
      // Re-derive due date when invoice date or terms change. Mirrors
      // the web modal's handleField side effect.
      if (key === 'date' || key === 'paymentTerms') {
        return recomputeDueDate(next);
      }
      return next;
    });
  };

  const carrierNames = useMemo(() => {
    if (!carriers) return [] as string[];
    return carriers
      .map((c) => (typeof c === 'string' ? c : c?.name || ''))
      .filter(Boolean);
  }, [carriers]);

  const shipmentIds = useMemo(() => {
    if (!shipments) return [] as string[];
    return shipments
      .map((s: any) => String(s?.id || s?.shipment_id || ''))
      .filter(Boolean);
  }, [shipments]);

  async function handleSubmit() {
    setBusy(true);
    try {
      const baseId = isEdit ? (invoice.id || invoice.invoice_id || invoice.num) : null;
      const saved = await saveInvoice(form, baseId);
      if (onSaved) await onSaved(saved);
      onClose();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save invoice');
    } finally {
      setBusy(false);
    }
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
                {form.num || 'Invoice'}
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
              label="Invoice #"
              value={form.num}
              onChange={(v) => set('num', v)}
              editable={!isEdit}
              hint={isEdit ? 'Cannot change once created.' : undefined}
            />

            {carrierNames.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>CARRIER *</Text>
                <View style={styles.chipRowWrap}>
                  {carrierNames.map((n) => (
                    <Chip
                      key={n}
                      label={n}
                      active={form.carrier === n}
                      onPress={() => set('carrier', n)}
                    />
                  ))}
                </View>
              </>
            ) : (
              <Field
                label="Carrier"
                value={form.carrier}
                onChange={(v) => set('carrier', v)}
                placeholder="e.g. XPO Logistics"
              />
            )}

            <SectionLabel label="Shipments" />
            {shipmentIds.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>PRIMARY SHIPMENT</Text>
                <View style={styles.chipRowWrap}>
                  {shipmentIds.slice(0, 12).map((sid) => (
                    <Chip
                      key={sid}
                      label={sid}
                      active={form.shipId === sid}
                      onPress={() => set('shipId', sid)}
                    />
                  ))}
                </View>
              </>
            ) : (
              <Field
                label="Primary Shipment"
                value={form.shipId}
                onChange={(v) => set('shipId', v)}
                placeholder="SHP-2026-1234"
              />
            )}
            <Field
              label="Additional Shipments (optional)"
              value={form.extraShipIds}
              onChange={(v) => set('extraShipIds', v)}
              placeholder="Comma-separated for consolidated invoices"
              hint="Server sums agreed costs from all listed shipments."
            />

            <SectionLabel label="Status" />
            <View style={styles.chipRow}>
              {INVOICE_STATUSES.map((s) => (
                <Chip
                  key={s}
                  label={s}
                  active={form.status === s}
                  onPress={() => set('status', s)}
                />
              ))}
            </View>

            <SectionLabel label="Dates & Terms" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Invoice Date"
                  value={form.date}
                  onChange={(v) => set('date', v)}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Due Date"
                  value={form.due}
                  onChange={(v) => set('due', v)}
                  placeholder="YYYY-MM-DD"
                  keyboardType="numeric"
                  hint="Auto-recomputed from terms."
                />
              </View>
            </View>
            <Text style={styles.fieldLabel}>PAYMENT TERMS</Text>
            <View style={styles.chipRow}>
              {PAYMENT_TERMS.map((p) => (
                <Chip
                  key={p}
                  label={p}
                  active={form.paymentTerms === p}
                  onPress={() => set('paymentTerms', p)}
                />
              ))}
            </View>

            <SectionLabel label="Money" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Field
                  label="Amount ($)"
                  value={form.amount}
                  onChange={(v) => set('amount', v.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.flex1}>
                <Field
                  label="Agreed ($)"
                  value={form.agreed}
                  onChange={(v) => set('agreed', v.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  hint="From shipment quote."
                />
              </View>
            </View>

            <SectionLabel label="Notes" />
            <TextInput
              style={[styles.input, styles.textarea]}
              value={form.notes}
              onChangeText={(v) => set('notes', v)}
              multiline
              numberOfLines={3}
              placeholder="Dispute notes, references, internal context..."
              placeholderTextColor={colors.text3}
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
                  <Text style={styles.btnPrimaryText}>{isEdit ? 'Save Changes' : 'Create Invoice'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── Sub-components ── */

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  editable = true,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  editable?: boolean;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        editable={editable}
        keyboardType={keyboardType || 'default'}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
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
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
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
  inputDisabled: {
    backgroundColor: colors.bg,
    color: colors.text3,
  },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  hint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.xs,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  chipRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  chipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  chipTextActive: { color: colors.accent },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
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
  btnGhost: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnDisabled: { opacity: 0.7 },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
});
