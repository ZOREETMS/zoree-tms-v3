import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import KpiCard from '../ui/KpiCard';
import { colors, spacing } from '../../theme';

/**
 * ItemStatsGrid — QA bug #259.
 *
 * Mobile Item Master previously rendered just a search box + class
 * filter + list. The web Item Master page (frontend/src/pages/
 * ItemMasterPage.jsx lines 126–134 and 526–533) shows a 5-card KPI
 * strip — Total Items, Hazmat, High-Value (>$10K), Active, Avg Weight
 * — so warehouse and procurement users get a one-glance summary
 * before they scroll. The QA report called out that mobile was
 * missing this dashboard. Porting the exact same aggregation logic
 * here (item-by-item filters + averages) so both platforms compute
 * identical numbers from identical input. Kept as a dedicated
 * component so the screen stays a thin controller (CLAUDE_RULES §6)
 * and so future screens that show items can drop the same KPIs in.
 *
 * Two-row 3+2 layout on mobile (vs the web's 5-across grid) so each
 * card still has enough horizontal room for the value type at a
 * normal-sized phone width.
 */

interface ItemStatsGridProps {
  items: any[];
}

const ItemStatsGrid: React.FC<ItemStatsGridProps> = ({ items }) => {
  const kpis = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    const hazmat = list.filter((it: any) => it && it.hazmat).length;
    const highValue = list.filter((it: any) => parseFloat(it?.value_unit) > 10000).length;
    const active = list.filter((it: any) => (it?.status || 'Active') === 'Active').length;
    const weights = list
      .map((it: any) => parseFloat(it?.weight_unit) || 0)
      .filter((w: number) => w > 0);
    const avgWeight = weights.length > 0
      ? Math.round(weights.reduce((a: number, b: number) => a + b, 0) / weights.length)
      : 0;
    return { total, hazmat, highValue, active, avgWeight };
  }, [items]);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.cell}>
          <KpiCard
            label="Total Items"
            value={kpis.total}
            icon="cube-outline"
            color={colors.accent}
          />
        </View>
        <View style={styles.cell}>
          <KpiCard
            label="Hazmat"
            value={kpis.hazmat}
            icon="warning-outline"
            color={colors.yellow}
          />
        </View>
        <View style={styles.cell}>
          <KpiCard
            label="High-Value (>$10K)"
            value={kpis.highValue}
            icon="diamond-outline"
            color={colors.red}
          />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.cell}>
          <KpiCard
            label="Active Items"
            value={kpis.active}
            icon="checkmark-circle-outline"
            color={colors.green}
          />
        </View>
        <View style={styles.cell}>
          <KpiCard
            label="Avg Weight (lbs)"
            value={kpis.avgWeight}
            icon="scale-outline"
            color={colors.accent}
          />
        </View>
        {/* Empty 3rd cell on row 2 to preserve column rhythm */}
        <View style={styles.cell} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
});

export default ItemStatsGrid;
