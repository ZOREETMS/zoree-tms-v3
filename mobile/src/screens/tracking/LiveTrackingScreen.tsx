import React, { useMemo } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import LoadingScreen from '../../components/ui/LoadingScreen';
import { useData } from '../../state/DataContext';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function LiveTrackingScreen() {
  const { data, loading, refreshData } = useData();

  const inTransitShipments = useMemo(() => {
    return data.shipments.filter(
      (s: any) =>
        (s.status || '').toLowerCase() === 'in transit' ||
        (s.status || '').toLowerCase() === 'picked up',
    );
  }, [data.shipments]);

  if (loading && data.shipments.length === 0) {
    return <LoadingScreen />;
  }

  const renderShipment = ({ item }: { item: any }) => {
    const id = item.id || item.shipment_id || item.shipmentId || '--';
    const carrier = item.carrier_name || item.carrierName || item.carrier || 'Unassigned';
    const driver = item.driver_name || item.driverName || item.driver || '--';
    const origin = item.origin_city || item.origin || item.originCity || '--';
    const destination = item.destination_city || item.destination || item.destinationCity || '--';
    const status = item.status || 'Unknown';

    return (
      <Card style={styles.shipmentCard}>
        <View style={styles.cardHeader}>
          <Text style={styles.shipmentId}>{id}</Text>
          <StatusBadge status={status} />
        </View>

        <View style={styles.cardRow}>
          <Ionicons name="person-outline" size={16} color={colors.text2} />
          <Text style={styles.cardLabel}>Driver:</Text>
          <Text style={styles.cardValue}>{driver}</Text>
        </View>

        <View style={styles.cardRow}>
          <Ionicons name="bus-outline" size={16} color={colors.text2} />
          <Text style={styles.cardLabel}>Carrier:</Text>
          <Text style={styles.cardValue}>{carrier}</Text>
        </View>

        <View style={styles.routeRow}>
          <View style={styles.routePoint}>
            <Ionicons name="radio-button-on" size={14} color={colors.green} />
            <Text style={styles.routeText} numberOfLines={1}>{origin}</Text>
          </View>
          <Ionicons name="arrow-forward" size={14} color={colors.text3} style={styles.routeArrow} />
          <View style={styles.routePoint}>
            <Ionicons name="location" size={14} color={colors.red} />
            <Text style={styles.routeText} numberOfLines={1}>{destination}</Text>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="navigate" size={24} color={colors.accent} />
          <Text style={styles.title}>Live Tracking</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{inTransitShipments.length}</Text>
          </View>
        </View>

        {/* Map placeholder */}
        <View style={styles.mapPlaceholder}>
          <Ionicons name="map-outline" size={48} color={colors.text3} />
          <Text style={styles.mapPlaceholderText}>Map View</Text>
          <Text style={styles.mapPlaceholderSubtext}>
            Requires react-native-maps native setup
          </Text>
        </View>

        {/* Active shipments list */}
        <Text style={styles.sectionTitle}>Active Shipments</Text>

        <FlatList
          data={inTransitShipments}
          renderItem={renderShipment}
          keyExtractor={(item: any) =>
            String(item.id || item.shipment_id || item.shipmentId || Math.random())
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refreshData}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="navigate-outline"
              title="No active shipments"
              subtitle="Shipments that are in transit will appear here for live tracking."
            />
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    flex: 1,
  },
  countBadge: {
    backgroundColor: colors.accentGlow,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  countText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  mapPlaceholder: {
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    height: 180,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapPlaceholderText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginTop: spacing.sm,
  },
  mapPlaceholderSubtext: {
    fontSize: fontSize.sm,
    color: colors.text3,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['5xl'],
    flexGrow: 1,
  },
  shipmentCard: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  shipmentId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  cardLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  cardValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
    flex: 1,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  routeArrow: {
    marginHorizontal: spacing.sm,
  },
  routeText: {
    fontSize: fontSize.sm,
    color: colors.text,
    flex: 1,
  },
});
