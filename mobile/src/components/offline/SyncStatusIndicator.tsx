// ═══════════════════════════════════════════════════════════════════
// SyncStatusIndicator — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Compact header chip showing sync state at a glance. Designed to sit
// in the right slot of a screen header (`navigation.setOptions`).
//
// States:
//   online,  queue empty  → grey cloud icon (idle)
//   offline, queue empty  → red cloud-offline icon
//   any,     queue > 0    → animated sync icon + pending count pill
//   conflicts             → red alert-circle + count
//
// Tap target: minimum 32×32 — taps invoke `drainNow()` so a user
// returning online and impatient with the auto-drain timer can force
// the engine. Online + idle taps are no-ops (we don't surface a
// settings screen from the header).
// ═══════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOffline } from '../../state/OfflineContext';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface SyncStatusIndicatorProps {
  /** Override the default tint for the surrounding header bg. */
  size?: number;
}

export default function SyncStatusIndicator({ size = 22 }: SyncStatusIndicatorProps) {
  const { isOnline, pendingCount, conflictCount, drainNow } = useOffline();

  const onPress = () => {
    if (isOnline && pendingCount > 0) {
      drainNow().catch(() => { /* swallowed — banner will surface state */ });
    }
  };

  let icon: keyof typeof Ionicons.glyphMap;
  let tint: string;
  if (conflictCount > 0) {
    icon = 'alert-circle-outline';
    tint = colors.red;
  } else if (!isOnline) {
    icon = 'cloud-offline-outline';
    tint = colors.red;
  } else if (pendingCount > 0) {
    icon = 'sync-outline';
    tint = '#D97706'; // amber-600
  } else {
    icon = 'cloud-done-outline';
    tint = colors.text3;
  }

  const totalBadge = conflictCount + pendingCount;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={isOnline && pendingCount > 0 ? 0.6 : 1.0}
      style={styles.wrap}
      accessibilityLabel={a11yLabel(isOnline, pendingCount, conflictCount)}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={size} color={tint} />
      {totalBadge > 0 ? (
        <View style={[styles.badge, conflictCount > 0 ? styles.badgeError : styles.badgePending]}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {totalBadge > 99 ? '99+' : String(totalBadge)}
          </Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function a11yLabel(isOnline: boolean, pending: number, conflict: number): string {
  if (conflict > 0) return `${conflict} conflict${conflict === 1 ? '' : 's'} waiting`;
  if (!isOnline) return 'Offline';
  if (pending > 0) return `Syncing, ${pending} pending change${pending === 1 ? '' : 's'}, tap to retry`;
  return 'Online';
}

const styles = StyleSheet.create({
  wrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xs,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePending: { backgroundColor: '#D97706' },
  badgeError:   { backgroundColor: colors.red },
  badgeText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    lineHeight: 14,
  },
});
