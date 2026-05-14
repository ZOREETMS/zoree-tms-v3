/**
 * UserManagementScreen — QA P208 (2026-05-11).
 *
 * Mobile parity for frontend/src/pages/UserManagementPage.jsx (REQ-08).
 * Lists every TMS user with their assigned roles + active role. Long-
 * press opens a destructive-action sheet (Reset Password / Delete);
 * tap navigates to UserDetail for full edit. FAB opens the New User
 * form via the same UserDetail screen with no userId.
 *
 * Admin-only — the backend enforces access via rolePermissions, so
 * non-admin tokens see a 403 from UsersApi.list() and the screen
 * surfaces the error state cleanly.
 *
 * NB (per safety rules): user creation here is performed BY the
 * signed-in admin filling in the form, not by the AI. This screen is
 * a UI surface for an admin's own decisions — not an auto-pilot.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import { useAuth } from '../../state/AuthContext';
import { UsersApi } from '../../lib/api';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

interface User {
  id: string;
  email: string;
  fullName?: string;
  full_name?: string;
  roles?: string[];
  activeRole?: string;
  active_role?: string;
  disabled?: boolean;
}

const ROLE_COLOR: Record<string, string> = {
  admin: '#7c3aed',
  planner: '#0d9488',
  finance: '#d97706',
  viewer: '#64748b',
};

function RoleChip({ role }: { role: string }) {
  const color = ROLE_COLOR[role] || '#64748b';
  return (
    <View
      style={[
        styles.chip,
        { borderColor: `${color}66`, backgroundColor: `${color}1A` },
      ]}>
      <Text style={[styles.chipText, { color }]}>
        {role.charAt(0).toUpperCase() + role.slice(1)}
      </Text>
    </View>
  );
}

export default function UserManagementScreen() {
  const navigation = useNavigation<any>();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res: any = await UsersApi.list();
      const rows: User[] = Array.isArray(res?.users) ? res.users : [];
      setUsers(rows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreate = useCallback(() => {
    navigation.navigate('UserDetail', {});
  }, [navigation]);

  const openEdit = useCallback(
    (u: User) => {
      navigation.navigate('UserDetail', { userId: u.id });
    },
    [navigation],
  );

  /**
   * Long-press surfaces destructive actions. Delete is gated against
   * the signed-in admin's own row (matches the web's behavior — you
   * can't delete yourself). Reset Password jumps to UserDetail with a
   * focused password field; for parity with the web's inline flow we
   * could do it here, but a dedicated form keeps the screen simple.
   */
  const handleLongPress = useCallback(
    (u: User) => {
      const isSelf = me?.id === u.id || me?.email === u.email;
      type Item = { label: string; run: () => void; destructive?: boolean };
      const items: Item[] = [];
      items.push({ label: 'Edit', run: () => openEdit(u) });
      items.push({
        label: 'Reset Password',
        run: () =>
          navigation.navigate('UserDetail', {
            userId: u.id,
            focus: 'password',
          }),
      });
      if (!isSelf) {
        items.push({
          label: 'Delete User',
          destructive: true,
          run: () => {
            Alert.alert(
              'Delete user?',
              `${u.email} will be removed. This cannot be undone.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await UsersApi.remove(u.id);
                      await refresh();
                    } catch (err: any) {
                      Alert.alert(
                        'Delete failed',
                        err?.message || String(err),
                      );
                    }
                  },
                },
              ],
            );
          },
        });
      }
      const labels = items.map((i) => i.label);
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...labels, 'Close'],
            cancelButtonIndex: labels.length,
            destructiveButtonIndex: items.findIndex((i) => i.destructive),
          },
          (chosen) => {
            if (chosen >= 0 && chosen < items.length) items[chosen].run();
          },
        );
      } else {
        Alert.alert(u.email, undefined, [
          ...items.map((it) => ({ text: it.label, onPress: it.run })),
          { text: 'Close', style: 'cancel' as const },
        ]);
      }
    },
    [me, openEdit, navigation, refresh],
  );

  const renderItem = useCallback(
    ({ item }: { item: User }) => {
      const roles = Array.isArray(item.roles) ? item.roles : [];
      const activeRole = item.activeRole || item.active_role || roles[0];
      const fullName = item.fullName || item.full_name || '';
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => openEdit(item)}
          onLongPress={() => handleLongPress(item)}
          delayLongPress={300}>
          <Card style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.email} numberOfLines={1}>
                  {item.email}
                </Text>
                {fullName ? (
                  <Text style={styles.fullName} numberOfLines={1}>
                    {fullName}
                  </Text>
                ) : null}
              </View>
              {item.disabled ? (
                <View style={styles.disabledBadge}>
                  <Text style={styles.disabledText}>Disabled</Text>
                </View>
              ) : null}
              {/* QA #299 — explicit 3-dot action menu so Edit/Disable/
                  Delete are discoverable without relying on long-press
                  (mirrors the web Users page's action menu column). */}
              <TouchableOpacity
                onPress={(e) => {
                  e.stopPropagation();
                  handleLongPress(item);
                }}
                hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${item.email}`}
                style={styles.menuBtn}>
                <Ionicons
                  name="ellipsis-vertical"
                  size={18}
                  color={colors.text2}
                />
              </TouchableOpacity>
            </View>
            <View style={styles.chipRow}>
              {roles.length === 0 ? (
                <Text style={styles.noRoles}>No roles assigned</Text>
              ) : (
                roles.map((r) => <RoleChip key={r} role={r} />)
              )}
            </View>
            {activeRole && roles.length > 1 ? (
              <Text style={styles.activeLine}>
                Active: <Text style={styles.activeBold}>{activeRole}</Text>
              </Text>
            ) : null}
          </Card>
        </TouchableOpacity>
      );
    },
    [handleLongPress, openEdit],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>User Management</Text>
          <Text style={styles.count}>
            {loading ? 'Loading…' : `${users.length} user${users.length === 1 ? '' : 's'}`}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={users}
        keyExtractor={(u) => String(u.id)}
        renderItem={renderItem}
        contentContainerStyle={
          users.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={loading ? 'Loading users…' : 'No users'}
            subtitle={
              loading
                ? ''
                : error
                ? 'Pull to retry.'
                : 'Use the + button to add the first user.'
            }
          />
        }
      />

      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={openCreate}
        accessibilityLabel="Add a new user">
        <Ionicons name="person-add-outline" size={24} color={colors.white} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  count: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  errorBox: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(220,38,38,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.35)',
  },
  errorText: { color: '#fca5a5', fontSize: fontSize.sm },
  listContent: { paddingBottom: spacing['5xl'] },
  emptyContainer: { flexGrow: 1 },
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  email: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  fullName: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: 2,
  },
  disabledBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(100,116,139,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.4)',
  },
  disabledText: {
    fontSize: fontSize.xs,
    color: colors.text2,
    fontWeight: fontWeight.semibold,
  },
  menuBtn: {
    marginLeft: spacing.sm,
    padding: spacing.xs,
    borderRadius: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  noRoles: {
    fontSize: fontSize.xs,
    color: colors.text3,
    fontStyle: 'italic',
  },
  activeLine: {
    marginTop: spacing.xs,
    fontSize: fontSize.xs,
    color: colors.text2,
  },
  activeBold: {
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing['3xl'],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
