/**
 * RoleSwitcher — QA P209 (2026-05-11).
 *
 * Mobile parity for the web's frontend/src/components/RoleSwitcher.jsx
 * (REQ-08). Renders a row of pills for every role assigned to the
 * signed-in user; tapping a pill calls AuthContext.switchRole, which
 * PATCHes /api/auth/active-role and updates local state + storage.
 *
 * Behaviour mirrors the web component:
 *   - Hidden when the user has fewer than 2 assigned roles (single-role
 *     accounts have nothing to switch).
 *   - Pills wrap onto a second row when the list is wide.
 *   - In-flight switching disables further taps and surfaces an error
 *     line if the API rejects.
 *
 * Pure UI on top of the existing AuthContext — no new state.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../state/AuthContext';

interface RoleMeta {
  label: string;
  icon: string;
  color: string;
  bg: string;
}

// Keep these in lockstep with frontend/src/components/RoleSwitcher.jsx
// so design tokens stay consistent across web + mobile.
const ROLE_META: Record<string, RoleMeta> = {
  admin:   { label: 'Admin',   icon: '🛡', color: '#7c3aed', bg: 'rgba(124,58,237,.15)' },
  planner: { label: 'Planner', icon: '🧭', color: '#0d9488', bg: 'rgba(13,148,136,.15)' },
  finance: { label: 'Finance', icon: '💰', color: '#d97706', bg: 'rgba(217,119,6,.15)' },
  viewer:  { label: 'Viewer',  icon: '👁', color: '#64748b', bg: 'rgba(100,116,139,.15)' },
};

function metaFor(role: string): RoleMeta {
  return (
    ROLE_META[role] || {
      label: role,
      icon: '•',
      color: '#64748b',
      bg: 'rgba(100,116,139,.15)',
    }
  );
}

export default function RoleSwitcher() {
  const { user, switchRole } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  const roles = Array.isArray(user?.roles) ? user!.roles! : [];
  const activeRole = user?.activeRole || user?.role || '';

  // Hidden for single-role users — matches the web behaviour so we
  // don't take up valuable drawer real estate on accounts where
  // switching has no effect.
  if (roles.length < 2) return null;

  const onPress = async (r: string) => {
    if (busy || r === activeRole) return;
    setBusy(true);
    setError('');
    try {
      await switchRole(r);
    } catch (e: any) {
      setError(e?.message || 'Failed to switch role');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Active role</Text>
      <View style={styles.pillRow}>
        {roles.map((r) => {
          const meta = metaFor(r);
          const isActive = r === activeRole;
          return (
            <TouchableOpacity
              key={r}
              accessibilityRole="button"
              accessibilityLabel={
                isActive
                  ? `Currently viewing as ${meta.label}`
                  : `Switch to ${meta.label}`
              }
              disabled={busy}
              onPress={() => onPress(r)}
              style={[
                styles.pill,
                {
                  borderColor: isActive
                    ? meta.color
                    : 'rgba(255,255,255,0.15)',
                  borderWidth: isActive ? 1.5 : 1,
                  backgroundColor: isActive ? meta.bg : 'transparent',
                  opacity: busy && !isActive ? 0.6 : 1,
                },
              ]}>
              <Text style={styles.pillIcon}>{meta.icon}</Text>
              <Text
                style={[
                  styles.pillLabel,
                  {
                    color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.8)',
                    fontWeight: isActive ? '700' : '500',
                  },
                ]}>
                {meta.label}
              </Text>
              {isActive ? <Text style={styles.pillCheck}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 8,
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 6,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 4,
  },
  pillIcon: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  pillLabel: {
    fontSize: 11,
  },
  pillCheck: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
  },
  error: {
    marginTop: 6,
    fontSize: 10,
    color: '#fca5a5',
  },
});
