/**
 * OrderSelectionBar — floating bar shown above the FAB on the Orders
 * screen when the user is in multi-select mode. Mirrors the web
 * OrdersPage selection chip with running count + Plan Selected /
 * Create Multi-Stop / Clear actions.
 *
 * Pure presentational — all state and dispatch live on OrdersScreen.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

export interface OrderSelectionBarProps {
  count: number;
  totalWeight: number;
  unplannedCount: number;
  busy?: boolean;
  onClear: () => void;
  onPlanSelected: () => void;
  onCreateMultiStop: () => void;
}

export default function OrderSelectionBar({
  count,
  totalWeight,
  unplannedCount,
  busy = false,
  onClear,
  onPlanSelected,
  onCreateMultiStop,
}: OrderSelectionBarProps) {
  const planDisabled = busy || unplannedCount === 0;
  // Multi-stop needs 2+ unplanned orders to make sense.
  const multiStopDisabled = busy || unplannedCount < 2;

  return (
    <View style={styles.bar}>
      <View style={styles.summary}>
        <Text style={styles.count}>{count}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.summaryTitle}>
            {count === 1 ? 'order selected' : 'orders selected'}
          </Text>
          <Text style={styles.summarySub}>
            {totalWeight.toLocaleString()} lbs · {unplannedCount} unplanned
          </Text>
        </View>
        <TouchableOpacity onPress={onClear} hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.white} />
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnGhost, multiStopDisabled && styles.btnDisabled]}
          onPress={onCreateMultiStop}
          disabled={multiStopDisabled}
          activeOpacity={0.8}
        >
          <Ionicons
            name="git-branch-outline"
            size={16}
            color={multiStopDisabled ? colors.text3 : colors.white}
          />
          <Text
            style={[
              styles.btnText,
              multiStopDisabled && styles.btnTextDisabled,
            ]}
          >
            Multi-Stop
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary, planDisabled && styles.btnDisabled]}
          onPress={onPlanSelected}
          disabled={planDisabled}
          activeOpacity={0.8}
        >
          <Ionicons
            name="rocket-outline"
            size={16}
            color={planDisabled ? colors.text3 : colors.white}
          />
          <Text
            style={[
              styles.btnText,
              planDisabled && styles.btnTextDisabled,
            ]}
          >
            Plan Selected
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing['3xl'],
    backgroundColor: colors.accent2,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  count: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.white,
    minWidth: 32,
    textAlign: 'center',
  },
  summaryTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summarySub: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  btnPrimary: { backgroundColor: colors.green },
  btnGhost: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  btnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  btnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  btnTextDisabled: { color: colors.text3 },
});
