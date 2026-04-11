import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import LoadingScreen from '../../components/ui/LoadingScreen';
import { useData } from '../../state/DataContext';
import { DbApi } from '../../lib/api';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

interface StatusOption {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const STATUS_OPTIONS: StatusOption[] = [
  { label: 'Arrived at Pickup', value: 'Arrived at Pickup', icon: 'location', color: colors.cyan },
  { label: 'Loading', value: 'Loading', icon: 'archive-outline', color: colors.yellow },
  { label: 'Departed', value: 'Departed', icon: 'arrow-forward-circle', color: colors.accent },
  { label: 'In Transit', value: 'In Transit', icon: 'bus-outline', color: colors.accent },
  { label: 'Arrived at Delivery', value: 'Arrived at Delivery', icon: 'flag', color: colors.purple },
  { label: 'Delivered', value: 'Delivered', icon: 'checkmark-circle', color: colors.green },
  { label: 'Exception', value: 'Exception', icon: 'warning', color: colors.red },
];

export default function StatusUpdateScreen() {
  const { data, loading, refreshData } = useData();
  const [updating, setUpdating] = useState(false);
  const [selectedShipmentIndex, setSelectedShipmentIndex] = useState(0);

  // Get active shipments (not delivered/cancelled)
  const activeShipments = data.shipments.filter(
    (s: any) =>
      !['delivered', 'cancelled'].includes((s.status || '').toLowerCase()),
  );

  const currentShipment = activeShipments[selectedShipmentIndex] || null;

  if (loading && data.shipments.length === 0) {
    return <LoadingScreen />;
  }

  const handleStatusUpdate = (option: StatusOption) => {
    if (!currentShipment) return;

    const shipmentId = currentShipment.id || currentShipment.shipment_id || currentShipment.shipmentId;
    const shipmentLabel = String(shipmentId);

    Alert.alert(
      'Confirm Status Update',
      `Update shipment ${shipmentLabel} to "${option.label}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: 'default',
          onPress: async () => {
            setUpdating(true);
            try {
              await DbApi.patch('shipments', shipmentId, {
                status: option.value,
              });
              await refreshData();
              Alert.alert('Success', `Status updated to "${option.label}"`);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to update status');
            } finally {
              setUpdating(false);
            }
          },
        },
      ],
    );
  };

  const cycleShipment = (direction: 1 | -1) => {
    if (activeShipments.length === 0) return;
    setSelectedShipmentIndex((prev) => {
      const next = prev + direction;
      if (next < 0) return activeShipments.length - 1;
      if (next >= activeShipments.length) return 0;
      return next;
    });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="sync-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Status Update</Text>
        </View>

        {/* Current shipment info */}
        {currentShipment ? (
          <Card style={styles.shipmentCard}>
            <View style={styles.shipmentHeader}>
              <TouchableOpacity onPress={() => cycleShipment(-1)} disabled={activeShipments.length <= 1}>
                <Ionicons
                  name="chevron-back"
                  size={24}
                  color={activeShipments.length > 1 ? colors.accent : colors.text3}
                />
              </TouchableOpacity>

              <View style={styles.shipmentInfo}>
                <Text style={styles.shipmentId}>
                  {currentShipment.id || currentShipment.shipment_id || currentShipment.shipmentId}
                </Text>
                <StatusBadge status={currentShipment.status || 'Unknown'} />
              </View>

              <TouchableOpacity onPress={() => cycleShipment(1)} disabled={activeShipments.length <= 1}>
                <Ionicons
                  name="chevron-forward"
                  size={24}
                  color={activeShipments.length > 1 ? colors.accent : colors.text3}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.detailsGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Carrier</Text>
                <Text style={styles.detailValue}>
                  {currentShipment.carrier_name || currentShipment.carrierName || currentShipment.carrier || '--'}
                </Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Origin</Text>
                <Text style={styles.detailValue} numberOfLines={1}>
                  {currentShipment.origin_city || currentShipment.origin || currentShipment.originCity || '--'}
                </Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Destination</Text>
                <Text style={styles.detailValue} numberOfLines={1}>
                  {currentShipment.destination_city || currentShipment.destination || currentShipment.destinationCity || '--'}
                </Text>
              </View>
            </View>

            <Text style={styles.counterText}>
              {selectedShipmentIndex + 1} of {activeShipments.length} active shipments
            </Text>
          </Card>
        ) : (
          <Card style={styles.shipmentCard}>
            <View style={styles.emptyShipment}>
              <Ionicons name="cube-outline" size={36} color={colors.text3} />
              <Text style={styles.emptyText}>No active shipments</Text>
            </View>
          </Card>
        )}

        {/* Status buttons */}
        <Text style={styles.sectionTitle}>Update Status</Text>
        <View style={styles.buttonsGrid}>
          {STATUS_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={styles.statusButton}
              activeOpacity={0.7}
              disabled={!currentShipment || updating}
              onPress={() => handleStatusUpdate(option)}
            >
              <View style={[styles.statusIconCircle, { backgroundColor: `${option.color}14` }]}>
                <Ionicons name={option.icon} size={28} color={option.color} />
              </View>
              <Text style={styles.statusButtonLabel}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
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
  content: {
    paddingBottom: spacing['5xl'],
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
  },
  shipmentCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  shipmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  shipmentInfo: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  shipmentId: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  detailsGrid: {
    gap: spacing.sm,
  },
  detailItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
  },
  counterText: {
    fontSize: fontSize.xs,
    color: colors.text3,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  emptyShipment: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.text2,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  buttonsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  statusButton: {
    width: '47%',
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  statusIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusButtonLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
});
