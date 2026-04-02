import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { computeKpis } from '../../shared/services/analyticsService';
import { formatCurrency } from '../../shared/utils/formatters';
import KpiCard from '../../components/ui/KpiCard';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { data, loading, refreshData } = useData();

  const kpis = useMemo(() => computeKpis(data.shipments), [data.shipments]);

  const recentOrders = useMemo(
    () =>
      [...data.orders]
        .sort((a, b) => {
          const da = new Date(a.created_at || a.date || 0).getTime();
          const db = new Date(b.created_at || b.date || 0).getTime();
          return db - da;
        })
        .slice(0, 5),
    [data.orders],
  );

  const activeShipments = useMemo(
    () =>
      data.shipments.filter(
        (s) => s.status === 'In Transit' || s.status === 'Picked Up',
      ),
    [data.shipments],
  );

  const handleRefresh = useCallback(() => {
    refreshData();
  }, [refreshData]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Overview of your operations</Text>
        </View>

        {/* KPI Row */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Total Orders"
              value={data.orders.length}
              icon="receipt-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Shipments"
              value={kpis.totalShipments}
              icon="cube-outline"
              color={colors.cyan}
            />
          </View>
        </View>
        <View style={styles.kpiRow}>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="On-Time %"
              value={`${kpis.onTimePct}%`}
              icon="checkmark-circle-outline"
              color={colors.green}
            />
          </View>
          <View style={styles.kpiHalf}>
            <KpiCard
              label="Total Spend"
              value={formatCurrency(kpis.totalSpend)}
              icon="wallet-outline"
              color={colors.purple}
            />
          </View>
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionButton}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Planning', { screen: 'Orders', params: { screen: 'OrderDetail', params: { orderId: 'new' } } })}
          >
            <View style={[styles.actionIcon, { backgroundColor: `${colors.accent}14` }]}>
              <Ionicons name="add-circle-outline" size={22} color={colors.accent} />
            </View>
            <Text style={styles.actionLabel}>New Order</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Execution', { screen: 'Shipments' })}
          >
            <View style={[styles.actionIcon, { backgroundColor: `${colors.cyan}14` }]}>
              <Ionicons name="locate-outline" size={22} color={colors.cyan} />
            </View>
            <Text style={styles.actionLabel}>Track Shipment</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('Insights', { screen: 'Alerts' })}
          >
            <View style={[styles.actionIcon, { backgroundColor: `${colors.red}14` }]}>
              <Ionicons name="notifications-outline" size={22} color={colors.red} />
            </View>
            <Text style={styles.actionLabel}>View Alerts</Text>
          </TouchableOpacity>
        </View>

        {/* Recent Orders */}
        <Text style={styles.sectionTitle}>Recent Orders</Text>
        {recentOrders.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>No orders yet</Text>
          </Card>
        ) : (
          recentOrders.map((order) => (
            <Card key={order.id || order.order_id} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemId}>
                    {order.order_id || order.id}
                  </Text>
                  <Text style={styles.itemSub} numberOfLines={1}>
                    {order.customer_name || order.origin_city || 'N/A'}
                    {order.destination_city ? ` \u2192 ${order.destination_city}` : ''}
                  </Text>
                </View>
                <StatusBadge status={order.status || 'Unplanned'} />
              </View>
            </Card>
          ))
        )}

        {/* Active Shipments */}
        <Text style={styles.sectionTitle}>Active Shipments</Text>
        {activeShipments.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>No active shipments</Text>
          </Card>
        ) : (
          activeShipments.map((shipment) => (
            <Card key={shipment.id || shipment.shipment_id} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemId}>
                    {shipment.shipment_id || shipment.id}
                  </Text>
                  <Text style={styles.itemSub} numberOfLines={1}>
                    {shipment.carrier_name || shipment.carrier || 'Unassigned'}
                  </Text>
                </View>
                <StatusBadge status={shipment.status} />
              </View>
            </Card>
          ))
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['5xl'],
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.md,
  },
  kpiHalf: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  actionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text,
    textAlign: 'center',
  },
  itemCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  itemId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  itemSub: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  emptyText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    textAlign: 'center',
  },
  bottomSpacer: {
    height: spacing['3xl'],
  },
});
