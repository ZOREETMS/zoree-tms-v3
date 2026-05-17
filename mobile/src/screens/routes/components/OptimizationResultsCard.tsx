/**
 * OptimizationResultsCard — mobile parity with the web
 * "Optimization Results" panel.
 *
 * Shows distance, drive time, best carrier, linehaul + FSC, total
 * estimate, trailer utilization bar, and an HOS alert. Empty state
 * matches the web placeholder when the user hasn't tapped Optimize.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../../components/ui/Card';
import { borderRadius, colors, fontSize, fontWeight, spacing } from '../../../theme';
import type { OptimizationResult } from '../../../services/routeOptimizerService';

interface Props {
  hasOptimized: boolean;
  result: OptimizationResult | null;
}

function utilColor(pct: number): string {
  if (pct >= 90) return colors.green;
  if (pct >= 70) return colors.yellow;
  return colors.red;
}

export default function OptimizationResultsCard({ hasOptimized, result }: Props) {
  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Optimization Results</Text>

      {!hasOptimized || !result ? (
        <View style={styles.placeholder}>
          <Ionicons name="map-outline" size={36} color={colors.text3} />
          <Text style={styles.placeholderText}>
            Tap Optimize Route to calculate
          </Text>
        </View>
      ) : (
        <View>
          {/* Lane header */}
          <View style={styles.laneHeader}>
            <Text style={styles.laneEndpoint} numberOfLines={1}>
              {result.origin || '—'}
            </Text>
            <Text style={styles.laneArrow}>→</Text>
            <Text style={styles.laneEndpoint} numberOfLines={1}>
              {result.destination || '—'}
            </Text>
          </View>
          <View style={styles.divider} />

          {/* Distance */}
          <ResultRow
            icon="location-outline"
            label="Distance"
            value={result.miles
              ? `${result.miles.toLocaleString()} mi`
              : 'N/A — add ZIPs for estimate'}
          />
          {/* Drive time */}
          <ResultRow
            icon="time-outline"
            label="Drive Time"
            value={result.driveHours
              ? `${result.driveHours} hrs @ 55 mph`
              : 'N/A'}
          />
          {/* Best carrier */}
          <ResultRow
            icon="bus-outline"
            label="Best Carrier"
            value={result.best?.carrier || 'TBD'}
            valueStyle={{ color: colors.accent, fontWeight: fontWeight.bold }}
            badge={result.best?._czarlite
              ? { text: 'LTL · CzarLite', bg: '#4F46E5' }
              : result.best?.mode === 'LTL'
                ? { text: 'LTL', bg: colors.cyan }
                : undefined}
          />
          {/* Linehaul + FSC */}
          <ResultRow
            icon="cash-outline"
            label="Linehaul + FSC"
            value={`$${(result.best?.base || 0).toLocaleString()} + $${(result.best?.fsc || 0).toLocaleString()}`}
          />
          {/* Total */}
          <ResultRow
            icon="pricetag-outline"
            label="Total Est."
            value={`$${(result.best?.total || 0).toLocaleString()}`}
            valueStyle={{ color: colors.green, fontWeight: fontWeight.bold, fontSize: fontSize.lg }}
            bold
          />

          {/* Utilization bar */}
          <View style={styles.utilWrap}>
            <View style={styles.utilHeader}>
              <Text style={styles.utilLabel}>Trailer Utilization</Text>
              <Text style={[styles.utilPct, { color: utilColor(result.trailerUtilizationPct) }]}>
                {result.trailerUtilizationPct}% of 44,000 lbs
              </Text>
            </View>
            <View style={styles.utilTrack}>
              <View
                style={[
                  styles.utilFill,
                  {
                    width: `${result.trailerUtilizationPct}%`,
                    backgroundColor: utilColor(result.trailerUtilizationPct),
                  },
                ]}
              />
            </View>
          </View>

          {/* HOS Alert */}
          {result.hosOk !== null && (
            <View
              style={[
                styles.hosAlert,
                {
                  backgroundColor: result.hosOk ? colors.greenDim : colors.yellowDim,
                  borderColor: result.hosOk
                    ? 'rgba(5,150,105,0.25)'
                    : 'rgba(217,119,6,0.25)',
                },
              ]}>
              <Ionicons
                name={result.hosOk ? 'checkmark-circle' : 'warning'}
                size={16}
                color={result.hosOk ? colors.green : colors.yellow}
              />
              <Text style={styles.hosText}>
                <Text style={styles.hosBold}>HOS: </Text>
                {result.hosOk
                  ? 'Within 11-hour single-driver limit'
                  : 'Exceeds single-driver limit — consider team drivers'}
              </Text>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

function ResultRow({
  icon,
  label,
  value,
  valueStyle,
  bold,
  badge,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  valueStyle?: any;
  bold?: boolean;
  badge?: { text: string; bg: string };
}) {
  return (
    <View style={styles.resultRow}>
      <View style={styles.resultLabel}>
        <Ionicons name={icon} size={14} color={colors.text2} />
        <Text style={[styles.resultLabelText, bold && { fontWeight: fontWeight.bold }]}>
          {label}
        </Text>
      </View>
      <View style={styles.resultValueWrap}>
        <Text style={[styles.resultValue, valueStyle]} numberOfLines={1}>
          {value}
        </Text>
        {badge && (
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={styles.badgeText}>{badge.text}</Text>
          </View>
        )}
      </View>
    </View>
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
  placeholder: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  placeholderText: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    color: colors.text2,
    fontWeight: fontWeight.semibold,
  },
  laneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  laneEndpoint: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text2,
  },
  laneArrow: { color: colors.text3, fontSize: fontSize.md },
  divider: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
    marginBottom: spacing.md,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  resultLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resultLabelText: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
  resultValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    maxWidth: '60%',
  },
  resultValue: {
    fontSize: fontSize.sm,
    color: colors.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: fontWeight.bold,
  },
  utilWrap: { marginTop: spacing.md },
  utilHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  utilLabel: { fontSize: 11, color: colors.text3 },
  utilPct: { fontSize: 11, fontWeight: fontWeight.bold },
  utilTrack: {
    backgroundColor: colors.bg3,
    borderRadius: 6,
    height: 7,
    overflow: 'hidden',
  },
  utilFill: { height: 7, borderRadius: 6 },
  hosAlert: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  hosText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text,
  },
  hosBold: { fontWeight: fontWeight.bold },
});
