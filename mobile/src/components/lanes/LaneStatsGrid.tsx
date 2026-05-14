/**
 * LaneStatsGrid — KPI strip above the Lane Preferences list. Mirrors
 * the web Lane Preferences summary band: Total Lanes, Preferred
 * Carriers count, Excluded Carriers count, Unique Lane Pairs.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import KpiCard from '../ui/KpiCard';
import { colors, spacing } from '../../theme';

interface Props {
  lanePreferences: any[];
}

const LaneStatsGrid: React.FC<Props> = ({ lanePreferences }) => {
  const stats = useMemo(() => {
    const safe = Array.isArray(lanePreferences) ? lanePreferences : [];
    const preferred = safe.reduce(
      (sum, p) => sum + (Array.isArray(p?.preferred) ? p.preferred.length : 0),
      0,
    );
    const excluded = safe.reduce(
      (sum, p) => sum + (Array.isArray(p?.excluded) ? p.excluded.length : 0),
      0,
    );
    const lanes = new Set(
      safe.map(
        (p) => `${p?.origin || ''}|${p?.dest || p?.destination || ''}`,
      ),
    );
    return {
      total: safe.length,
      preferred,
      excluded,
      lanes: lanes.size,
    };
  }, [lanePreferences]);

  return (
    <View style={styles.row}>
      <View style={styles.cell}>
        <KpiCard label="Lane Preferences" value={stats.total}     icon="star-outline"        color={colors.accent} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Preferred Carriers" value={stats.preferred} icon="checkmark-outline" color={colors.green} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Excluded Carriers" value={stats.excluded}   icon="close-outline"     color={colors.red} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Unique Lanes" value={stats.lanes}           icon="git-network-outline" color={colors.purple} />
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

export default LaneStatsGrid;
