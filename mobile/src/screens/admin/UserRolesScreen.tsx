/**
 * UserRolesScreen — QA P208 (2026-05-11).
 *
 * Mobile companion to frontend/src/pages/UserRolesPage.jsx (REQ-08).
 * Surfaces the role catalog (admin / planner / finance / viewer +
 * any tenant-custom roles) and the permission flags each role has
 * been granted. The web page also supports inline permission editing
 * via a large grid of checkboxes; on mobile that grid is awkward, so
 * this first cut is **read-only** — admins can review what each role
 * can do without round-tripping to a desktop, but actual permission
 * changes still happen on the web. This is documented in the screen
 * header so users know where to go.
 *
 * Pulls the catalog via AuthApi.roles() — same endpoint the web hits.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import { AuthApi } from '../../lib/api';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

interface RoleRow {
  roleKey: string;
  displayName?: string;
  description?: string;
  permissions?: string[];
  default?: boolean;
  builtin?: boolean;
}

const ROLE_COLOR: Record<string, string> = {
  admin: '#7c3aed',
  planner: '#0d9488',
  finance: '#d97706',
  viewer: '#64748b',
};

function colorFor(role: string): string {
  return ROLE_COLOR[role] || '#64748b';
}

export default function UserRolesScreen() {
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res: any = await AuthApi.roles();
      // The /api/roles endpoint may return either { roles: [...] } or
      // the raw array — accept both shapes so a future schema tweak
      // doesn't blank the screen.
      const rows: RoleRow[] = Array.isArray(res?.roles)
        ? res.roles
        : Array.isArray(res)
        ? res
        : [];
      setRoles(rows);
    } catch (e: any) {
      setError(e?.message || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((m) => ({ ...m, [key]: !m[key] }));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: RoleRow }) => {
      const color = colorFor(item.roleKey);
      const perms = Array.isArray(item.permissions) ? item.permissions : [];
      const isOpen = !!expanded[item.roleKey];
      const label = item.displayName ||
        item.roleKey.charAt(0).toUpperCase() + item.roleKey.slice(1);
      return (
        <Card style={styles.card}>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => toggleExpanded(item.roleKey)}
            style={styles.headerRow}>
            <View style={[styles.roleDot, { backgroundColor: color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.roleName}>{label}</Text>
              {item.description ? (
                <Text style={styles.roleDescription} numberOfLines={isOpen ? 0 : 2}>
                  {item.description}
                </Text>
              ) : null}
            </View>
            <View style={styles.permCount}>
              <Text style={[styles.permCountText, { color }]}>
                {perms.length}
              </Text>
              <Ionicons
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.text3}
                style={{ marginLeft: 6 }}
              />
            </View>
          </TouchableOpacity>

          {isOpen ? (
            <View style={styles.permList}>
              {perms.length === 0 ? (
                <Text style={styles.permEmpty}>
                  No permissions assigned. Edit on web to grant access.
                </Text>
              ) : (
                perms.map((p) => (
                  <View key={p} style={styles.permRow}>
                    <Ionicons
                      name="checkmark-circle"
                      size={14}
                      color={color}
                    />
                    <Text style={styles.permText}>{p}</Text>
                  </View>
                ))
              )}
              {item.builtin ? (
                <Text style={styles.builtinHint}>
                  Built-in role — name and key cannot be changed.
                </Text>
              ) : null}
            </View>
          ) : null}
        </Card>
      );
    },
    [expanded, toggleExpanded],
  );

  const summary = useMemo(() => {
    if (loading) return 'Loading…';
    return `${roles.length} role${roles.length === 1 ? '' : 's'} · read-only`;
  }, [loading, roles.length]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>User Roles</Text>
        <Text style={styles.count}>{summary}</Text>
        <Text style={styles.hint}>
          Permission editing is on the web app — Settings → User Roles.
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading && roles.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={roles}
          keyExtractor={(r) => String(r.roleKey)}
          renderItem={renderItem}
          contentContainerStyle={
            roles.length === 0 ? styles.emptyContainer : styles.listContent
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
              icon="shield-outline"
              title="No roles configured"
              subtitle="Define roles on the web app — they will show up here."
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  hint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.xs,
    fontStyle: 'italic',
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
  listContent: { paddingBottom: spacing['3xl'] },
  emptyContainer: { flexGrow: 1 },
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  roleDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  roleName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  roleDescription: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  permCount: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  permCountText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  permList: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    gap: spacing.xs,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  permText: {
    fontSize: fontSize.sm,
    color: colors.text,
  },
  permEmpty: {
    fontSize: fontSize.sm,
    color: colors.text3,
    fontStyle: 'italic',
  },
  builtinHint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
});
