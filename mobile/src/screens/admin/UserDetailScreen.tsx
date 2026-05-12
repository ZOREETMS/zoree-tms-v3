/**
 * UserDetailScreen — QA P208 (2026-05-11).
 *
 * Create or edit a single TMS user. Mirrors the modal form on
 * frontend/src/pages/UserManagementPage.jsx (REQ-08).
 *
 * Routes:
 *   - SystemTabs.UserDetail   — params: { userId?: string, focus?: 'password' }
 *     • userId absent → New User flow
 *     • userId present → load + edit
 *     • focus === 'password' → autofocus the password input (used by
 *       the Reset Password long-press action on the list screen)
 *
 * The screen drives UsersApi.create / .update. It never bypasses
 * those helpers — the API enforces audit + admin-gate server-side.
 *
 * Safety note: the signed-in user fills this form themselves. Per
 * the safety rules, the AI never auto-creates accounts; this screen
 * is purely a UI surface so an admin can manage their team.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { SystemTabParamList } from '../../navigation/types';
import { UsersApi } from '../../lib/api';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

const ROLE_OPTIONS: Array<{ key: string; label: string; color: string }> = [
  { key: 'admin',   label: 'Admin',   color: '#7c3aed' },
  { key: 'planner', label: 'Planner', color: '#0d9488' },
  { key: 'finance', label: 'Finance', color: '#d97706' },
  { key: 'viewer',  label: 'Viewer',  color: '#64748b' },
];

interface UserForm {
  email: string;
  password: string;
  fullName: string;
  roles: string[];
  activeRole: string;
}

function emptyForm(): UserForm {
  return { email: '', password: '', fullName: '', roles: ['viewer'], activeRole: 'viewer' };
}

type UserDetailRouteProp = RouteProp<
  SystemTabParamList & { UserDetail: { userId?: string; focus?: string } },
  'UserDetail'
>;

export default function UserDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<UserDetailRouteProp>();
  const userId = route.params?.userId;
  const focus = route.params?.focus;
  const isEdit = !!userId;

  const [form, setForm] = useState<UserForm>(emptyForm);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const passwordRef = useRef<TextInput | null>(null);

  // For edit mode, fetch the existing user. UsersApi.list is the only
  // server-side helper that ships user rows on web; we read it once
  // and pluck the matching id. If the API gains a /users/:id endpoint
  // later this becomes a single GET.
  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    (async () => {
      try {
        const res: any = await UsersApi.list();
        const rows = Array.isArray(res?.users) ? res.users : [];
        const u = rows.find((x: any) => String(x?.id) === String(userId));
        if (!u) throw new Error('User not found');
        if (cancelled) return;
        const roles = Array.isArray(u.roles) && u.roles.length ? u.roles : ['viewer'];
        setForm({
          email: u.email || '',
          password: '',
          fullName: u.fullName || u.full_name || '',
          roles,
          activeRole: u.activeRole || u.active_role || roles[0],
        });
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load user');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, userId]);

  // Focus the password input when the list screen passes ?focus=password
  // (Reset Password long-press). Delayed via a microtask so the input
  // has actually mounted.
  useEffect(() => {
    if (focus !== 'password') return;
    const t = setTimeout(() => passwordRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [focus]);

  const toggleRole = useCallback((r: string) => {
    setForm((f) => {
      const on = f.roles.includes(r);
      const nextRoles = on ? f.roles.filter((x) => x !== r) : [...f.roles, r];
      const safeRoles = nextRoles.length ? nextRoles : ['viewer'];
      const nextActive = safeRoles.includes(f.activeRole)
        ? f.activeRole
        : safeRoles[0];
      return { ...f, roles: safeRoles, activeRole: nextActive };
    });
  }, []);

  const setActiveRole = useCallback((r: string) => {
    setForm((f) => {
      if (!f.roles.includes(r)) return f;
      return { ...f, activeRole: r };
    });
  }, []);

  const onSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      if (isEdit) {
        const patch: Record<string, unknown> = {
          fullName: form.fullName,
          roles: form.roles,
          activeRole: form.activeRole,
        };
        if (form.password && form.password.trim()) {
          patch.password = form.password.trim();
        }
        await UsersApi.update(userId as string, patch);
      } else {
        if (!form.email.trim() || !form.password.trim()) {
          throw new Error('Email and password are required');
        }
        await UsersApi.create({
          email: form.email.trim(),
          password: form.password.trim(),
          fullName: form.fullName.trim(),
          roles: form.roles,
          activeRole: form.activeRole,
        });
      }
      navigation.goBack();
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [form, isEdit, userId, navigation]);

  const title = useMemo(
    () => (isEdit ? 'Edit User' : 'New User'),
    [isEdit],
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{title}</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={[styles.input, isEdit && styles.inputDisabled]}
          value={form.email}
          onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
          editable={!isEdit}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="name@example.com"
          placeholderTextColor={colors.text3}
        />
        {isEdit ? (
          <Text style={styles.helper}>
            Email cannot be changed after creation.
          </Text>
        ) : null}

        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          value={form.fullName}
          onChangeText={(v) => setForm((f) => ({ ...f, fullName: v }))}
          placeholder="Jane Planner"
          placeholderTextColor={colors.text3}
        />

        <Text style={styles.label}>
          {isEdit ? 'New password (leave blank to keep)' : 'Password'}
        </Text>
        <TextInput
          ref={passwordRef}
          style={styles.input}
          value={form.password}
          onChangeText={(v) => setForm((f) => ({ ...f, password: v }))}
          secureTextEntry
          autoCapitalize="none"
          placeholder={isEdit ? '••••••••' : 'Minimum 8 characters'}
          placeholderTextColor={colors.text3}
        />

        <Text style={styles.label}>Roles</Text>
        <View style={styles.chipRow}>
          {ROLE_OPTIONS.map((r) => {
            const on = form.roles.includes(r.key);
            return (
              <TouchableOpacity
                key={r.key}
                onPress={() => toggleRole(r.key)}
                style={[
                  styles.chip,
                  {
                    borderColor: on ? r.color : 'rgba(255,255,255,0.15)',
                    backgroundColor: on ? `${r.color}1A` : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    styles.chipText,
                    { color: on ? r.color : colors.text2 },
                  ]}>
                  {r.label}
                </Text>
                {on ? (
                  <Ionicons name="checkmark" size={14} color={r.color} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Active role</Text>
        <View style={styles.chipRow}>
          {ROLE_OPTIONS.filter((r) => form.roles.includes(r.key)).map((r) => {
            const isActive = form.activeRole === r.key;
            return (
              <TouchableOpacity
                key={r.key}
                onPress={() => setActiveRole(r.key)}
                style={[
                  styles.chip,
                  {
                    borderColor: isActive ? r.color : 'rgba(255,255,255,0.15)',
                    backgroundColor: isActive ? `${r.color}1A` : 'transparent',
                  },
                ]}>
                <Text
                  style={[
                    styles.chipText,
                    { color: isActive ? r.color : colors.text2 },
                  ]}>
                  {r.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => navigation.goBack()}
            disabled={saving}>
            <Text style={styles.btnGhostText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, saving && styles.btnDisabled]}
            onPress={onSave}
            disabled={saving}>
            <Text style={styles.btnPrimaryText}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { justifyContent: 'center', alignItems: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  errorBox: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(220,38,38,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.35)',
    marginBottom: spacing.md,
  },
  errorText: { color: '#fca5a5', fontSize: fontSize.sm },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: fontSize.md,
  },
  inputDisabled: { opacity: 0.6 },
  helper: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  actions: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    gap: spacing.md,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  btnDisabled: { opacity: 0.6 },
  btnPrimaryText: {
    color: colors.white,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.md,
  },
  btnGhostText: {
    color: colors.text2,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.md,
  },
});
