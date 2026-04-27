/**
 * InviteCustomerModal — slide-up sheet for inviting a customer to the
 * portal. Mobile mirror of frontend/src/components/customer-portal/
 * InviteCustomerModal.jsx.
 *
 * Pure presentation. The customer-portal hook
 * (mobile/src/shared/hooks/useCustomerPortal.js) owns persistence via
 * `handleInvite(invite)` — this modal only collects the form and hands
 * it off.
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
  VISIBILITY_LEVELS,
  emptyCustomerInvite,
} from '../../shared/types/customerPortal';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface CustomerInvite {
  name: string;
  email: string;
  company: string;
  visibility: string;
}

export interface InviteCustomerModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (invite: CustomerInvite) => void | Promise<void>;
}

export default function InviteCustomerModal({
  visible,
  onClose,
  onSubmit,
}: InviteCustomerModalProps) {
  const [form, setForm] = useState<CustomerInvite>(() => emptyCustomerInvite());
  const [busy, setBusy] = useState(false);

  // Reset whenever the modal opens so a cancelled draft doesn't bleed
  // into the next invite.
  useEffect(() => {
    if (visible && !busy) setForm(emptyCustomerInvite());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const set = <K extends keyof CustomerInvite>(key: K, value: CustomerInvite[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function validate(): { ok: boolean; error?: string } {
    if (!form.name.trim()) return { ok: false, error: 'Customer name is required.' };
    if (!form.email.trim()) return { ok: false, error: 'Contact email is required.' };
    // Quick sanity check — no need for full RFC parsing on mobile.
    if (!/.+@.+\..+/.test(form.email.trim())) {
      return { ok: false, error: 'Enter a valid email address.' };
    }
    return { ok: true };
  }

  async function handleSubmit() {
    const v = validate();
    if (!v.ok) {
      Alert.alert('Cannot send invite', v.error || 'Please fix the form.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        company: form.company.trim(),
      });
      // Caller closes on success; we just keep the local busy flag honest.
    } catch (e: any) {
      Alert.alert('Invite failed', e?.message || 'Could not send invite');
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
              <Text style={styles.headerLabel}>Invite</Text>
              <Text style={styles.headerTitle}>Customer Portal</Text>
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
            <Field
              label="Customer Name"
              value={form.name}
              onChange={(v) => set('name', v)}
              placeholder="Acme Logistics"
              required
            />
            <Field
              label="Contact Email"
              value={form.email}
              onChange={(v) => set('email', v)}
              placeholder="contact@company.com"
              required
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Field
              label="Company"
              value={form.company}
              onChange={(v) => set('company', v)}
              placeholder="Legal entity name (optional)"
            />

            <Text style={styles.fieldLabel}>VISIBILITY LEVEL</Text>
            <View style={styles.chipRowWrap}>
              {Object.values(VISIBILITY_LEVELS).map((lvl: any) => (
                <TouchableOpacity
                  key={String(lvl)}
                  style={[
                    styles.chip,
                    form.visibility === lvl && styles.chipActive,
                  ]}
                  onPress={() => set('visibility', String(lvl))}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.chipText,
                      form.visibility === lvl && styles.chipTextActive,
                    ]}
                  >
                    {String(lvl)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.hint}>
              Determines what the customer sees in their portal. "Full" includes
              line items and documents; "Status Only" hides everything except
              status changes; "ETA Only" surfaces just the projected delivery date.
            </Text>
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
                  <Ionicons name="mail-outline" size={18} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>Send Invite</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label.toUpperCase()}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType={keyboardType || 'default'}
        autoCapitalize={autoCapitalize || 'sentences'}
        autoCorrect={false}
      />
    </View>
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
  chipRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
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
  hint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
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
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
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
