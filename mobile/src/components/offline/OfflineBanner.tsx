// ═══════════════════════════════════════════════════════════════════
// OfflineBanner — REQ-OFFLINE Phase 5 (mobile, 2026-05-10).
//
// Persistent banner that renders above every screen when the device
// is offline OR when there are pending writes waiting to sync. Sits
// just inside the SafeArea boundary in App.tsx so it shadows the
// notch / status-bar correctly on iOS notched devices and the
// status-bar background on Android.
//
// State sourced from OfflineContext. Three visual states:
//
//   offline + queue empty → red banner, "You're offline."
//   offline + queue > 0   → red banner with pill, "Offline · N pending"
//   online  + queue > 0   → amber banner, "Syncing N pending change(s)…"
//   online  + queue empty → renders nothing (returns null).
//
// We deliberately return null when there's nothing to show so the
// banner doesn't take vertical space in the common case. The
// component is stateless wrt offline data — pure read of context.
// ═══════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOffline } from '../../state/OfflineContext';
import { colors, fontSize, fontWeight, spacing } from '../../theme';

export default function OfflineBanner() {
  const { isOnline, pendingCount, conflictCount } = useOffline();

  // Nothing to show: online + queue empty.
  if (isOnline && pendingCount === 0 && conflictCount === 0) return null;

  if (!isOnline) {
    return (
      <View style={[styles.banner, styles.offlineBanner]} accessibilityLiveRegion="polite">
        <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
        <Text style={styles.text} numberOfLines={1}>
          {pendingCount > 0
            ? `You're offline · ${pendingCount} pending change${pendingCount === 1 ? '' : 's'}`
            : "You're offline. Changes will sync when you reconnect."}
        </Text>
      </View>
    );
  }

  // Online but queue isn't empty (drain in progress or has conflicts).
  if (conflictCount > 0) {
    return (
      <View style={[styles.banner, styles.conflictBanner]} accessibilityLiveRegion="polite">
        <Ionicons name="alert-circle-outline" size={16} color="#fff" />
        <Text style={styles.text} numberOfLines={1}>
          {conflictCount} change{conflictCount === 1 ? '' : 's'} couldn't sync — review needed
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.banner, styles.syncingBanner]} accessibilityLiveRegion="polite">
      <Ionicons name="sync-outline" size={16} color="#fff" />
      <Text style={styles.text} numberOfLines={1}>
        Syncing {pendingCount} pending change{pendingCount === 1 ? '' : 's'}…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  offlineBanner: { backgroundColor: colors.red },
  conflictBanner: { backgroundColor: colors.red },
  syncingBanner: { backgroundColor: '#D97706' /* amber-600 */ },
  text: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    flex: 1,
  },
});
