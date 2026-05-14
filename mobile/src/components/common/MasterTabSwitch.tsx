/**
 * MasterTabSwitch — two-pill segmented toggle.
 *
 * Generic reusable component used by Item Master (Items / Packaging)
 * and any future screen that needs a two-tab top-of-page switch.
 * Keeps the pill style consistent across the app.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface MasterTab {
  key: string;
  label: string;
}

interface Props {
  tabs: MasterTab[];
  active: string;
  onSelect: (key: string) => void;
}

const MasterTabSwitch: React.FC<Props> = ({ tabs, active, onSelect }) => (
  <View style={styles.wrap}>
    {tabs.map((t) => {
      const isActive = t.key === active;
      return (
        <TouchableOpacity
          key={t.key}
          onPress={() => onSelect(t.key)}
          activeOpacity={0.8}
          style={[styles.pill, isActive && styles.pillActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: isActive }}>
          <Text style={[styles.label, isActive && styles.labelActive]}>
            {t.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: colors.bg4,
    borderRadius: borderRadius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.15)',
    alignSelf: 'flex-start',
  },
  pill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  pillActive: {
    backgroundColor: colors.bg2,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  labelActive: {
    color: colors.accent,
    fontWeight: fontWeight.bold,
  },
});

export default MasterTabSwitch;
