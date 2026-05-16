/**
 * LanePreferenceCard — single lane preference row.
 *
 * Read-only summary card mirroring the web LanePreferencesPage rows:
 *   - Lane (Origin → Destination), mode badge, priority chip
 *   - Preferred carriers (green chips)
 *   - Excluded carriers (red chips)
 *   - Reason / customer hint
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Card from '../ui/Card';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const PRIORITY_STYLES: Record<string, { bg: string; color: string }> = {
  High:   { bg: 'rgba(220,38,38,0.10)',  color: colors.red },
  Medium: { bg: 'rgba(217,119,6,0.10)',  color: colors.yellow },
  Low:    { bg: 'rgba(5,150,105,0.10)',  color: colors.green },
};

interface Props {
  pref: any;
  /** QA #324 — long-press surfaces the Edit / Delete action sheet. */
  onLongPress?: () => void;
  /** QA #324 — tap to edit. Optional; when omitted the card is read-only. */
  onPress?: () => void;
}

const LanePreferenceCard: React.FC<Props> = ({ pref, onLongPress, onPress }) => {
  const origin = pref?.origin || '—';
  const dest = pref?.dest || pref?.destination || '—';
  const mode = pref?.mode || '—';
  const priority = pref?.priority || 'Medium';
  const customer = pref?.customer || '';
  const reason = pref?.reason || '';
  const preferred: string[] = Array.isArray(pref?.preferred) ? pref.preferred : [];
  const excluded: string[]  = Array.isArray(pref?.excluded)  ? pref.excluded  : [];
  const prio = PRIORITY_STYLES[priority] || PRIORITY_STYLES.Medium;
  // QA #324 — paused rows render dimmed so users can scan past them;
  // the long-press sheet still surfaces Edit / Enable / Delete on the
  // same row so a paused pref is easy to re-activate.
  const isPaused = Boolean(pref?.disabled);

  // QA #324 — wrap in TouchableOpacity so the screen can attach tap +
  // long-press handlers for Edit / Delete actions without rewriting
  // the card body. When neither handler is supplied the touchable is
  // effectively a no-op pass-through (matches the previous read-only
  // behaviour).
  const Wrapper: any = onPress || onLongPress ? TouchableOpacity : View;
  return (
    <Wrapper
      activeOpacity={0.85}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
    <Card style={[styles.card, isPaused && styles.cardPaused]}>
      <View style={styles.topRow}>
        <View style={{ flex: 1, marginRight: spacing.sm }}>
          <Text style={styles.lane} numberOfLines={1}>
            {origin} → {dest}
          </Text>
          <View style={styles.subRow}>
            <View style={styles.modeBadge}>
              <Text style={styles.modeText}>{mode}</Text>
            </View>
            <View style={[styles.priorityChip, { backgroundColor: prio.bg }]}>
              <Text style={[styles.priorityText, { color: prio.color }]}>
                {priority}
              </Text>
            </View>
            {customer ? (
              <Text style={styles.customer} numberOfLines={1}>
                {customer}
              </Text>
            ) : null}
            {isPaused ? (
              <View style={styles.pausedChip}>
                <Text style={styles.pausedText}>Paused</Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {preferred.length > 0 && (
        <View style={styles.carrierGroup}>
          <Text style={styles.groupLabel}>Preferred</Text>
          <View style={styles.chipRow}>
            {preferred.map((c) => (
              <View key={`pref-${c}`} style={[styles.carrierChip, styles.prefChip]}>
                <Text style={[styles.carrierText, styles.prefText]}>{c}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {excluded.length > 0 && (
        <View style={styles.carrierGroup}>
          <Text style={styles.groupLabel}>Excluded</Text>
          <View style={styles.chipRow}>
            {excluded.map((c) => (
              <View key={`exc-${c}`} style={[styles.carrierChip, styles.exclChip]}>
                <Text style={[styles.carrierText, styles.exclText]}>{c}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {reason ? (
        <Text style={styles.reason} numberOfLines={3}>
          {reason}
        </Text>
      ) : null}
    </Card>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  // QA #324 — disabled / paused lane preference styling. Card dims so
  // the row reads as "still here but inactive"; small chip near the
  // mode badge labels it explicitly.
  cardPaused: { opacity: 0.6 },
  pausedChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pausedText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    letterSpacing: 0.3,
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  lane: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  modeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.bg4,
  },
  modeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  priorityChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  priorityText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  customer: { fontSize: fontSize.xs, color: colors.text3 },
  carrierGroup: { marginTop: spacing.sm },
  groupLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  carrierChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  prefChip: { backgroundColor: 'rgba(5,150,105,0.10)' },
  exclChip: { backgroundColor: 'rgba(220,38,38,0.10)' },
  carrierText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  prefText: { color: colors.green },
  exclText: { color: colors.red },
  reason: {
    marginTop: spacing.sm,
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    color: colors.text2,
  },
});

export default React.memo(LanePreferenceCard);
