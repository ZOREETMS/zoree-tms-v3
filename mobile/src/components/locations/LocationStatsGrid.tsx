/**
 * LocationStatsGrid — KPI strip above the Location Master list.
 * Mirrors the web Location Master's summary band (QA #271 page-content
 * gap): Total, Shippers, Consignees, Warehouses.
 *
 * Counts are derived from the full data.locations array so they don't
 * shrink when the user narrows the type/state filter below.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import KpiCard from '../ui/KpiCard';
import { colors, spacing } from '../../theme';

interface Props {
  locations: any[];
}

function isType(loc: any, type: string): boolean {
  const t = String(loc?.type || '').toLowerCase();
  return t === type.toLowerCase();
}

const LocationStatsGrid: React.FC<Props> = ({ locations }) => {
  const stats = useMemo(() => {
    const safe = Array.isArray(locations) ? locations : [];
    return {
      total:      safe.length,
      shippers:   safe.filter((l) => isType(l, 'Shipper')).length,
      consignees: safe.filter((l) => isType(l, 'Consignee')).length,
      warehouses: safe.filter((l) => isType(l, 'Warehouse')).length,
    };
  }, [locations]);

  return (
    <View style={styles.row}>
      <View style={styles.cell}>
        <KpiCard label="Total Locations" value={stats.total}      icon="location-outline" color={colors.accent} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Shippers"        value={stats.shippers}   icon="arrow-up-outline" color={colors.green} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Consignees"      value={stats.consignees} icon="arrow-down-outline" color={colors.purple} />
      </View>
      <View style={styles.cell}>
        <KpiCard label="Warehouses"      value={stats.warehouses} icon="business-outline" color={colors.cyan} />
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

export default LocationStatsGrid;
