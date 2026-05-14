/**
 * RateStatsGrid — KPI strip above the Rate Management list. Mirrors
 * the web Rate Management dashboard: Active rates, Avg rate, Modes
 * count, Carriers count.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import KpiCard from '../ui/KpiCard';
import { colors, spacing } from '../../theme';

interface Props {
  rates: any[];
}

const RateStatsGrid: React.FC<Props> = ({ rates }) => {
  const stats = useMemo(() => {
    const safe = Array.isArray(rates) ? rates : [];
    const active = safe.filter(
      (r) => (r?.status || 'Active').toLowerCase() === 'active',
    ).length;
    const modes = new Set(
      safe.map((r) => String(r?.mode || r?.transport_mode || '').toUpperCase()).filter(Boolean),
    );
    const carriers = new Set(
      safe.map((r) => String(r?.carrier || r?.carrier_name || '').trim()).filter(Boolean),
    );
    const ratesWithVal = safe
      .map((r) => parseFloat(r?.rate || r?.rate_per_mile || 0))
      .filter((v) => Number.isFinite(v) && v > 0);
    const avg = ratesWithVal.length
      ? ratesWithVal.reduce((s, v) => s + v, 0) / ratesWithVal.length
      : 0;
    return {
      active,
      avg,
      modes: modes.size,
      carriers: carriers.size,
    };
  }, [rates]);

  return (
    <View style={styles.row}>
      <View style={styles.cell}>
        <KpiCard label="Active Rates" value={stats.active} icon="pricetag-outline" color={colors.accent} />
      </View>
      <View style={styles.cell}>
        <KpiCard
          label="Avg Rate"
          value={stats.avg > 0 ? `$${stats.avg.toFixed(2)}` : '—'}
          icon="trending-up-outline"
          color={colors.green}
        />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Modes" value={stats.modes} icon="git-branch-outline" color={colors.purple} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Carriers" value={stats.carriers} icon="people-outline" color={colors.cyan} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  cell: { flexBasis: '47%', flexGrow: 1 },
});

export default RateStatsGrid;
