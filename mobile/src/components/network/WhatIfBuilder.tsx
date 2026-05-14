/**
 * WhatIfBuilder — phone-sized What-If scenario form for Network
 * Modeling (QA #292).
 *
 * The web Network Modeling page has a desktop side panel with rate
 * change %, volume change %, lane filters, etc. On a phone the
 * minimum-viable scenario builder is:
 *
 *   - Two number inputs: rate change (Δ$/mi or %) and volume change (%)
 *   - Run Analysis: applies the modifiers to the lane set, parent
 *     re-renders the table with adjusted figures.
 *   - Save Scenario: stores the current scenario locally so the user
 *     can return to it via the list. (No persistence across reinstall
 *     because we don't have a server-side scenarios table on mobile
 *     yet — saving lives in component state.)
 *
 * The parent owns the lanes data; this component is a controlled form.
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface WhatIfScenario {
  id: string;
  label: string;
  ratePct: number;
  volumePct: number;
}

interface Props {
  expanded: boolean;
  onToggle: () => void;
  onRun: (s: { ratePct: number; volumePct: number }) => void;
  onSave: (s: { ratePct: number; volumePct: number; label: string }) => void;
  scenarios: WhatIfScenario[];
  onLoadScenario: (s: WhatIfScenario) => void;
}

const WhatIfBuilder: React.FC<Props> = ({
  expanded,
  onToggle,
  onRun,
  onSave,
  scenarios,
  onLoadScenario,
}) => {
  const [ratePct, setRatePct]     = useState<string>('0');
  const [volumePct, setVolumePct] = useState<string>('0');
  const [label, setLabel]         = useState<string>('');

  const parsedRate = Number(ratePct) || 0;
  const parsedVolume = Number(volumePct) || 0;

  return (
    <Card style={styles.card}>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        style={styles.headerRow}>
        <Ionicons
          name="git-compare-outline"
          size={18}
          color={colors.accent}
        />
        <Text style={styles.headerText}>What-If Scenario Builder</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.text3}
          style={{ marginLeft: 'auto' }}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          <View style={styles.fieldRow}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Rate change (%)</Text>
              <TextInput
                value={ratePct}
                onChangeText={setRatePct}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                placeholderTextColor={colors.text3}
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Volume change (%)</Text>
              <TextInput
                value={volumePct}
                onChangeText={setVolumePct}
                keyboardType="numbers-and-punctuation"
                placeholder="0"
                placeholderTextColor={colors.text3}
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <View style={[styles.field, { flex: 2 }]}>
              <Text style={styles.fieldLabel}>Scenario name (optional)</Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="e.g. Q3 contract renegotiation"
                placeholderTextColor={colors.text3}
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => onSave({ ratePct: parsedRate, volumePct: parsedVolume, label: label || 'Untitled' })}
              style={[styles.btn, styles.btnSecondary]}
              accessibilityRole="button">
              <Ionicons name="bookmark-outline" size={14} color={colors.accent} />
              <Text style={styles.btnSecondaryText}>Save Scenario</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onRun({ ratePct: parsedRate, volumePct: parsedVolume })}
              style={[styles.btn, styles.btnPrimary]}
              accessibilityRole="button">
              <Ionicons name="play-outline" size={14} color={colors.white} />
              <Text style={styles.btnPrimaryText}>Run Analysis</Text>
            </TouchableOpacity>
          </View>

          {scenarios.length > 0 && (
            <View style={styles.savedList}>
              <Text style={styles.savedListLabel}>Saved scenarios</Text>
              {scenarios.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => {
                    setRatePct(String(s.ratePct));
                    setVolumePct(String(s.volumePct));
                    setLabel(s.label);
                    onLoadScenario(s);
                  }}
                  style={styles.savedRow}>
                  <Ionicons name="bookmark" size={12} color={colors.accent} />
                  <Text style={styles.savedRowLabel} numberOfLines={1}>
                    {s.label}
                  </Text>
                  <Text style={styles.savedRowMeta}>
                    Δrate {s.ratePct}% · Δvol {s.volumePct}%
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  body: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  field: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.text,
    backgroundColor: colors.bg2,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  btnPrimary:   { backgroundColor: colors.accent },
  btnSecondary: { borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.bg2 },
  btnPrimaryText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  btnSecondaryText: {
    color: colors.accent,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  savedList: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  savedListLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  savedRowLabel: {
    fontSize: fontSize.sm,
    color: colors.text,
    flex: 1,
  },
  savedRowMeta: {
    fontSize: fontSize.xs,
    color: colors.text3,
  },
});

export default WhatIfBuilder;
