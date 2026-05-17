/**
 * RouteBuilderCard — mobile RouteOptimizer input form.
 *
 * Mirrors the web "Route Builder" card from RouteOptimizerPage:
 *   - Origin (city, state)
 *   - Destination (city, state)
 *   - Load Type (ALL / TL / LTL)
 *   - Weight (lbs)
 *   - Origin ZIP / Dest ZIP (used for the LTL CzarLite quote)
 *
 * Stateless — receives form values + onChange handlers from the
 * useRouteOptimizer hook. Pure presentation.
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import Card from '../../../components/ui/Card';
import { borderRadius, colors, fontSize, fontWeight, spacing } from '../../../theme';
import type {
  RouteOptimizerFormState,
} from '../../../hooks/useRouteOptimizer';
import type { RouteMode } from '../../../services/routeOptimizerService';

const MODE_OPTIONS: { value: RouteMode; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'TL',  label: 'TL'  },
  { value: 'LTL', label: 'LTL' },
];

interface Props {
  form: RouteOptimizerFormState;
  setField: <K extends keyof RouteOptimizerFormState>(
    key: K,
    value: RouteOptimizerFormState[K],
  ) => void;
}

export default function RouteBuilderCard({ form, setField }: Props) {
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Route Builder</Text>

      {/* Origin */}
      <Text style={styles.label}>Origin</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.cityInput]}
          placeholder="City (e.g. Chicago)"
          placeholderTextColor={colors.text3}
          value={form.originCity}
          onChangeText={(v) => setField('originCity', v)}
        />
        <TextInput
          style={[styles.input, styles.stateInput]}
          placeholder="ST"
          placeholderTextColor={colors.text3}
          value={form.originState}
          onChangeText={(v) => setField('originState', v.toUpperCase().slice(0, 2))}
          autoCapitalize="characters"
          maxLength={2}
        />
      </View>

      {/* Destination */}
      <Text style={styles.label}>Destination</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.cityInput]}
          placeholder="City (e.g. Dallas)"
          placeholderTextColor={colors.text3}
          value={form.destCity}
          onChangeText={(v) => setField('destCity', v)}
        />
        <TextInput
          style={[styles.input, styles.stateInput]}
          placeholder="ST"
          placeholderTextColor={colors.text3}
          value={form.destState}
          onChangeText={(v) => setField('destState', v.toUpperCase().slice(0, 2))}
          autoCapitalize="characters"
          maxLength={2}
        />
      </View>

      {/* Load Type + Weight */}
      <View style={styles.row}>
        <View style={styles.half}>
          <Text style={styles.label}>Load Type</Text>
          <View style={styles.segment}>
            {MODE_OPTIONS.map((opt) => {
              const active = form.mode === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                  onPress={() => setField('mode', opt.value)}>
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        <View style={styles.half}>
          <Text style={styles.label}>Weight (lbs)</Text>
          <TextInput
            style={styles.input}
            placeholder="4000"
            placeholderTextColor={colors.text3}
            value={form.weightLbs}
            onChangeText={(v) => setField('weightLbs', v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {/* ZIPs (LTL CzarLite) */}
      <View style={styles.row}>
        <View style={styles.half}>
          <Text style={styles.label}>
            Origin ZIP <Text style={styles.hint}>(LTL CzarLite)</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.zipInput]}
            placeholder="e.g. 77001"
            placeholderTextColor={colors.text3}
            value={form.originZip}
            onChangeText={(v) => setField('originZip', v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>
        <View style={styles.half}>
          <Text style={styles.label}>
            Dest ZIP <Text style={styles.hint}>(LTL CzarLite)</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.zipInput]}
            placeholder="e.g. 75201"
            placeholderTextColor={colors.text3}
            value={form.destZip}
            onChangeText={(v) => setField('destZip', v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  hint: {
    fontSize: 10,
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  half: { flex: 1 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    color: colors.text,
    backgroundColor: colors.bg2,
  },
  cityInput:  { flex: 2 },
  stateInput: { width: 64, textAlign: 'center', textTransform: 'uppercase' },
  zipInput:   { fontFamily: 'Courier' },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.bg2,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg2,
  },
  segmentBtnActive: {
    backgroundColor: colors.accent,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  segmentTextActive: {
    color: colors.white,
  },
});
