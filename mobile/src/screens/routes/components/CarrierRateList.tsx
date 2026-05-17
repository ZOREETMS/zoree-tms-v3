/**
 * CarrierRateList — phone-friendly rendering of the web "Carrier Rate
 * Comparison" table.
 *
 * The web screen renders an 11-column desktop table. Mobile-friendly
 * v1: vertical card list, one card per quote, with the same essentials:
 *   carrier · mode badge · CzarLite badge · base · FSC · total · transit
 *   · service level · miles (if from PC*MILER)
 *
 * Sort controls live above the list (Total / Base / Transit). Sort
 * defaults to ascending Total — matches web "best price first".
 */

import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../../components/ui/Card';
import EmptyState from '../../../components/ui/EmptyState';
import { borderRadius, colors, fontSize, fontWeight, spacing } from '../../../theme';
import type { RateComparisonRow } from '../../../services/routeOptimizerService';

type SortKey = 'total' | 'base' | 'transit';

interface Props {
  rows: RateComparisonRow[];
  hasOptimized: boolean;
  onSelect?: (row: RateComparisonRow) => void;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'total',   label: 'Total'   },
  { key: 'base',    label: 'Base'    },
  { key: 'transit', label: 'Transit' },
];

export default function CarrierRateList({ rows, hasOptimized, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      return sortAsc ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortAsc]);

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>Carrier Rate Comparison</Text>
        {sorted.length > 0 && (
          <Text style={styles.count}>
            {sorted.length} quote{sorted.length === 1 ? '' : 's'}
          </Text>
        )}
      </View>

      {sorted.length > 0 && (
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort:</Text>
          {SORT_OPTIONS.map((opt) => {
            const active = sortKey === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.sortChip, active && styles.sortChipActive]}
                onPress={() => {
                  if (sortKey === opt.key) setSortAsc(!sortAsc);
                  else { setSortKey(opt.key); setSortAsc(true); }
                }}>
                <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>
                  {opt.label}
                </Text>
                {active && (
                  <Ionicons
                    name={sortAsc ? 'arrow-up' : 'arrow-down'}
                    size={11}
                    color={colors.white}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon="pricetags-outline"
          title={hasOptimized ? 'No carrier rates for this lane' : 'No quotes yet'}
          subtitle={hasOptimized
            ? 'Try a different origin / destination or widen the load type filter.'
            : 'Fill the Route Builder above and tap Optimize Route.'}
        />
      ) : (
        sorted.map((row, idx) => (
          <RateCard
            key={`${row.carrier}-${row.mode}-${idx}`}
            row={row}
            isBest={idx === 0 && sortKey === 'total' && sortAsc}
            onSelect={onSelect}
          />
        ))
      )}
    </Card>
  );
}

/* ── Per-quote card ─────────────────────────────────────────────────── */

function RateCard({
  row,
  isBest,
  onSelect,
}: {
  row: RateComparisonRow;
  isBest: boolean;
  onSelect?: (row: RateComparisonRow) => void;
}) {
  return (
    <View
      style={[
        styles.rateCard,
        isBest && styles.rateCardBest,
        row._czarlite && styles.rateCardCzar,
      ]}>
      {/* Row 1: carrier + total */}
      <View style={styles.rateHeader}>
        <View style={styles.carrierWrap}>
          <Text style={styles.carrierText} numberOfLines={1}>
            {row.carrier}
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.modeBadge, { backgroundColor: row.mode === 'TL' ? colors.cyan : '#4F46E5' }]}>
              <Text style={styles.modeBadgeText}>{row.mode}</Text>
            </View>
            {row._czarlite && (
              <View style={styles.czarBadge}>
                <Text style={styles.czarBadgeText}>
                  CzarLite{row._czarliteClass ? ` Cl.${row._czarliteClass}` : ''}
                </Text>
              </View>
            )}
            {row._ccLive && (
              <View style={styles.ccBadge}>
                <Text style={styles.ccBadgeText}>CC</Text>
              </View>
            )}
            {isBest && (
              <View style={styles.bestBadge}>
                <Text style={styles.bestBadgeText}>BEST</Text>
              </View>
            )}
          </View>
        </View>
        <Text
          style={[
            styles.totalText,
            isBest && { color: colors.green },
            row._czarlite && !isBest && { color: '#6366F1' },
          ]}>
          ${(row.total || 0).toLocaleString()}
        </Text>
      </View>

      {/* Row 2: metric grid */}
      <View style={styles.metricsGrid}>
        <Metric label="Base"    value={`$${(row.base || 0).toLocaleString()}`} />
        <Metric label="FSC"     value={`$${(row.fsc || 0).toLocaleString()}`} />
        <Metric
          label="Transit"
          value={row.transit
            ? `${row.transit}d`
            : row._ccFailed
              ? 'CC fail'
              : '—'}
        />
        <Metric
          label="Service"
          value={row.serviceLevel ? row.serviceLevel.toUpperCase() : '—'}
        />
      </View>

      {/* Optional CzarLite breakdown */}
      {row._czarlite && (row.czarBaseGross || row.discountAmt) ? (
        <Text style={styles.czarBreakdown}>
          CzarLite base ${(row.czarBaseGross || row.czarBase || 0).toLocaleString()}
          {row.discountAmt && row.discountAmt > 0
            ? ` − $${row.discountAmt.toLocaleString()} disc`
            : ''}
          {row.fscCharge ? ` + FSC $${row.fscCharge.toLocaleString()}` : ''}
        </Text>
      ) : null}

      {/* PC*MILER miles annotation (TL only) */}
      {row.miles && !row._czarlite ? (
        <Text
          style={[
            styles.milesText,
            { color: row.pcmilerMiles ? colors.purple : colors.text3 },
          ]}>
          📏 {row.miles.toLocaleString()} mi{row.pcmilerMiles ? ' (PC*MILER)' : ''}
        </Text>
      ) : null}

      {/* Select button */}
      {onSelect && (
        <TouchableOpacity
          style={[styles.selectBtn, isBest && styles.selectBtnBest]}
          onPress={() => onSelect(row)}>
          <Text style={[styles.selectBtnText, isBest && styles.selectBtnTextBest]}>
            Select carrier
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  count: {
    fontSize: fontSize.xs,
    color: colors.text2,
    fontWeight: fontWeight.semibold,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  sortLabel: {
    fontSize: fontSize.xs,
    color: colors.text3,
    fontWeight: fontWeight.semibold,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  sortChipText: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  sortChipTextActive: { color: colors.white },

  rateCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.bg2,
  },
  rateCardBest: {
    borderColor: colors.green,
    backgroundColor: colors.greenDim,
  },
  rateCardCzar: {
    borderLeftWidth: 3,
    borderLeftColor: '#6366F1',
  },
  rateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  carrierWrap: { flex: 1 },
  carrierText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  modeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  modeBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  czarBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: '#4F46E5',
  },
  czarBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  ccBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.green,
  },
  ccBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  bestBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.green,
  },
  bestBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  totalText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metric: {
    flexBasis: '22%',
    flexGrow: 1,
    minWidth: 64,
  },
  metricLabel: {
    fontSize: 10,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: fontWeight.semibold,
  },
  metricValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: 2,
  },
  czarBreakdown: {
    marginTop: spacing.sm,
    fontSize: 11,
    color: '#6366F1',
  },
  milesText: {
    marginTop: spacing.sm,
    fontSize: 11,
  },
  selectBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    alignItems: 'center',
  },
  selectBtnBest: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  selectBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  selectBtnTextBest: { color: colors.white },
});
