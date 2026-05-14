/**
 * HomeKpiRow — four-KPI summary band shown above the module grid on
 * the mobile Home screen. Derives counts from the shipments + orders
 * arrays the caller already has, so this stays a pure-presentation
 * component (no API calls of its own).
 *
 * Counts mirror the web HomePage:
 *   activeShipments — shipments whose status is not Delivered/Cancelled
 *   openOrders      — orders with status === "Unplanned"
 *   delayed         — shipments with status === "Exception"
 *   savingsEst      — 4% of total shipment cost (matches HomePage.jsx)
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import KpiCard from '../ui/KpiCard';
import { colors, spacing } from '../../theme';

interface HomeKpiRowProps {
  shipments: any[];
  orders: any[];
}

function parseCost(s: any): number {
  return parseFloat(s?.total_cost) || 0;
}

const HomeKpiRow: React.FC<HomeKpiRowProps> = ({ shipments, orders }) => {
  const kpis = useMemo(() => {
    const safeShipments = Array.isArray(shipments) ? shipments : [];
    const safeOrders = Array.isArray(orders) ? orders : [];
    const activeShipments = safeShipments.filter(
      (s) => s?.status !== 'Delivered' && s?.status !== 'Cancelled',
    ).length;
    const inTransit = safeShipments.filter((s) => s?.status === 'In Transit').length;
    const openOrders = safeOrders.filter((o) => o?.status === 'Unplanned').length;
    const delayed = safeShipments.filter((s) => s?.status === 'Exception').length;
    const totalCost = safeShipments.reduce((sum, s) => sum + parseCost(s), 0);
    const savingsEst = Math.round(totalCost * 0.04);
    return { activeShipments, inTransit, openOrders, delayed, savingsEst };
  }, [shipments, orders]);

  return (
    <View style={styles.row}>
      <View style={styles.cell}>
        <KpiCard
          label="Active Shipments"
          value={kpis.activeShipments}
          subtitle={`${kpis.inTransit} in transit`}
          icon="cube-outline"
          color={colors.accent}
        />
      </View>
      <View style={styles.cell}>
        <KpiCard
          label="Open Orders"
          value={kpis.openOrders}
          subtitle="Awaiting planning"
          icon="receipt-outline"
          color={colors.yellow}
        />
      </View>
      <View style={styles.cell}>
        <KpiCard
          label="Delayed Loads"
          value={kpis.delayed}
          subtitle="Needs attention"
          icon="alert-circle-outline"
          color={colors.red}
          trend={kpis.delayed > 0 ? 'up' : 'flat'}
        />
      </View>
      <View style={styles.cell}>
        <KpiCard
          label="Savings Identified"
          value={`$${kpis.savingsEst.toLocaleString()}`}
          subtitle="Estimated this month"
          icon="trending-up-outline"
          color={colors.green}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  cell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
});

export default HomeKpiRow;
