/**
 * PackagingStatsGrid — KPI strip shown above the Packaging Units list
 * on the mobile Item Master screen. Mirrors the web Item Master's
 * 4-card Packaging KPIs (Total, Cartons, Pallets, Drums/IBCs).
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import KpiCard from '../ui/KpiCard';
import { colors, spacing } from '../../theme';

interface Props {
  units: any[];
}

const PackagingStatsGrid: React.FC<Props> = ({ units }) => {
  const stats = useMemo(() => {
    const safe = Array.isArray(units) ? units : [];
    const total = safe.length;
    const cartons = safe.filter((p) => p?.type === 'Carton').length;
    const pallets = safe.filter((p) => p?.type === 'Pallet').length;
    const drums = safe.filter(
      (p) => p?.type === 'Drum' || p?.type === 'IBC',
    ).length;
    return { total, cartons, pallets, drums };
  }, [units]);

  return (
    <View style={styles.row}>
      <View style={styles.cell}>
        <KpiCard label="Total Units" value={stats.total} icon="layers-outline" color={colors.accent} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Cartons" value={stats.cartons} icon="cube-outline" color={colors.accent} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Pallets" value={stats.pallets} icon="albums-outline" color={colors.purple} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Drums / IBCs" value={stats.drums} icon="ellipse-outline" color={colors.cyan} />
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
  cell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
});

export default PackagingStatsGrid;
