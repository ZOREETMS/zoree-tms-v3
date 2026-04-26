import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';

import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import { useData } from '../../state/DataContext';
import { TenderApi } from '../../lib/api';
import { copyShipment, deleteShipmentById } from '../../services/shipmentService';
import { formatCurrency } from '../../shared/utils/formatters';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';
import type { PlanningTabParamList } from '../../navigation/types';

type DetailRoute = RouteProp<PlanningTabParamList, 'ShipmentDetail'>;

const STATUS_FLOW = ['Planned', 'Tendered', 'Picked Up', 'In Transit', 'Delivered'] as const;

function formatDate(value: string | null | undefined): string {
  if (!value) return '--';
  const d = new Date(value);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatWeight(value: number | null | undefined): string {
  if (value == null) return '--';
  return `${Number(value).toLocaleString()} lbs`;
}

export default function ShipmentDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute<DetailRoute>();
  const { shipmentId } = route.params;
  const { data, setData, refreshData } = useData() as any;

  const [tenderLoading, setTenderLoading] = useState(false);
  const [mutating, setMutating] = useState(false);

  const shipment = useMemo(
    () =>
      data.shipments.find(
        (s: any) =>
          String(s.id || s.shipment_id || s.shipmentId) === String(shipmentId),
      ),
    [data.shipments, shipmentId],
  );

  const handleTender = useCallback(async () => {
    if (!shipment) return;
    setTenderLoading(true);
    try {
      const carrier =
        shipment.carrier_name || shipment.carrierName || shipment.carrier || '';
      await TenderApi.sendEmail({
        shipmentId: String(shipment.id || shipment.shipment_id || shipment.shipmentId),
        carrierName: carrier,
        origin: shipment.origin_city || shipment.origin || '',
        destination: shipment.destination_city || shipment.destination || '',
        pickupDate: shipment.pickup_date || shipment.pickupDate || '',
        deliveryDate: shipment.delivery_date || shipment.deliveryDate || '',
      });
      Alert.alert('Tender Sent', `Tender email sent for shipment ${shipmentId}.`);
    } catch (err: any) {
      Alert.alert('Tender Failed', err.message || 'Could not send tender email.');
    } finally {
      setTenderLoading(false);
    }
  }, [shipment, shipmentId]);

  /**
   * Copy this shipment. Mirrors the web "Copy Shipment" path —
   * creates a fresh planning candidate (no order_ids, no BOL fields,
   * status reset to Planned). Refreshes the data layer so the new row
   * appears in the list and navigates back so the user can find it.
   */
  const handleCopy = useCallback(() => {
    if (!shipment) return;
    Alert.alert(
      'Copy Shipment',
      `Create a copy of "${shipment.id || shipment.shipment_id}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy',
          onPress: async () => {
            setMutating(true);
            try {
              await copyShipment(shipment);
              if (refreshData) await refreshData();
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Copy failed', e?.message || 'Could not copy shipment');
            } finally {
              setMutating(false);
            }
          },
        },
      ],
    );
  }, [shipment, refreshData, navigation]);

  /**
   * Permanently delete this shipment. Web parity: shipmentService
   * calls ShipmentsApi.remove which goes through the domain endpoint.
   * Mobile uses DbApi.remove via deleteShipmentById — same end state.
   */
  const handleDelete = useCallback(() => {
    if (!shipment) return;
    const id = shipment.id || shipment.shipment_id || shipment.shipmentId;
    Alert.alert(
      'Delete Shipment',
      `Permanently delete "${id}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setMutating(true);
            try {
              await deleteShipmentById(String(id));
              if (refreshData) await refreshData();
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message || 'Could not delete shipment');
            } finally {
              setMutating(false);
            }
          },
        },
      ],
    );
  }, [shipment, refreshData, navigation]);

  const handleStatusUpdate = useCallback(
    (newStatus: string) => {
      if (!shipment) return;
      const key = shipment.id || shipment.shipment_id || shipment.shipmentId;
      setData(prev => ({
        ...prev,
        shipments: prev.shipments.map((s: any) => {
          const sKey = s.id || s.shipment_id || s.shipmentId;
          return String(sKey) === String(key)
            ? { ...s, status: newStatus }
            : s;
        }),
      }));
    },
    [shipment, setData],
  );

  if (!shipment) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.notFoundText}>Shipment not found.</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backLink}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const id = shipment.id || shipment.shipment_id || shipment.shipmentId || '';
  const carrier =
    shipment.carrier_name || shipment.carrierName || shipment.carrier || '--';
  const origin =
    shipment.origin_city || shipment.origin || shipment.originCity || '--';
  const destination =
    shipment.destination_city ||
    shipment.destination ||
    shipment.destinationCity ||
    '--';
  const status = shipment.status || 'Planned';
  const pickupDate = shipment.pickup_date || shipment.pickupDate;
  const deliveryDate = shipment.delivery_date || shipment.deliveryDate;
  const weight = shipment.weight ?? shipment.total_weight ?? null;
  const pieces = shipment.pieces ?? shipment.total_pieces ?? null;
  const totalCost =
    shipment.total_cost ?? shipment.totalCost ?? shipment.cost ?? null;

  const currentStatusIndex = STATUS_FLOW.indexOf(status as any);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {id}
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleCopy}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={mutating}
            style={mutating ? { opacity: 0.4 } : undefined}
          >
            <Ionicons
              name="copy-outline"
              size={22}
              color={mutating ? colors.text3 : colors.text2}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            disabled={mutating}
            style={mutating ? { opacity: 0.4 } : undefined}
          >
            <Ionicons
              name="trash-outline"
              size={22}
              color={mutating ? colors.text3 : colors.red}
            />
          </TouchableOpacity>
          <StatusBadge status={status} />
        </View>
      </View>
      {mutating ? (
        <View style={styles.headerSpinner}>
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Carrier Card */}
        <Card style={styles.infoCard}>
          <Text style={styles.cardLabel}>Carrier</Text>
          <Text style={styles.cardValue}>{carrier}</Text>
        </Card>

        {/* Route Card */}
        <Card style={styles.infoCard}>
          <Text style={styles.cardLabel}>Route</Text>
          <View style={styles.routeRow}>
            <View style={styles.routePoint}>
              <Ionicons name="location-outline" size={18} color={colors.accent} />
              <View style={styles.routeInfo}>
                <Text style={styles.routeLabel}>Origin</Text>
                <Text style={styles.routeValue}>{origin}</Text>
              </View>
            </View>
            <Ionicons
              name="arrow-forward"
              size={18}
              color={colors.text3}
              style={styles.routeArrow}
            />
            <View style={styles.routePoint}>
              <Ionicons name="location-outline" size={18} color={colors.green} />
              <View style={styles.routeInfo}>
                <Text style={styles.routeLabel}>Destination</Text>
                <Text style={styles.routeValue}>{destination}</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* Dates Card */}
        <Card style={styles.infoCard}>
          <View style={styles.rowBetween}>
            <View>
              <Text style={styles.cardLabel}>Pickup Date</Text>
              <Text style={styles.cardValue}>{formatDate(pickupDate)}</Text>
            </View>
            <View style={styles.rightAlign}>
              <Text style={styles.cardLabel}>Delivery Date</Text>
              <Text style={styles.cardValue}>{formatDate(deliveryDate)}</Text>
            </View>
          </View>
        </Card>

        {/* Weight / Pieces / Cost Card */}
        <Card style={styles.infoCard}>
          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.cardLabel}>Weight</Text>
              <Text style={styles.cardValue}>{formatWeight(weight)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.cardLabel}>Pieces</Text>
              <Text style={styles.cardValue}>
                {pieces != null ? Number(pieces).toLocaleString() : '--'}
              </Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.cardLabel}>Total Cost</Text>
              <Text style={[styles.cardValue, styles.costValue]}>
                {totalCost != null ? formatCurrency(Number(totalCost)) : '--'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Map Placeholder */}
        <Card style={styles.infoCard}>
          <View style={styles.mapPlaceholder}>
            <Ionicons name="map-outline" size={40} color={colors.text3} />
            <Text style={styles.mapText}>Map view coming soon</Text>
          </View>
        </Card>

        {/* Tender Button */}
        <TouchableOpacity
          style={styles.tenderButton}
          activeOpacity={0.8}
          onPress={handleTender}
          disabled={tenderLoading}>
          {tenderLoading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="send-outline" size={18} color={colors.white} />
              <Text style={styles.tenderButtonText}>Send Tender Email</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Status Update Buttons */}
        <Text style={styles.sectionTitle}>Update Status</Text>
        <View style={styles.statusButtonsRow}>
          {STATUS_FLOW.map((s, i) => {
            const isCurrent = s === status;
            const isPast = i < currentStatusIndex;
            return (
              <TouchableOpacity
                key={s}
                style={[
                  styles.statusButton,
                  isCurrent && styles.statusButtonCurrent,
                  isPast && styles.statusButtonPast,
                ]}
                activeOpacity={0.7}
                disabled={isCurrent}
                onPress={() => handleStatusUpdate(s)}>
                <Text
                  style={[
                    styles.statusButtonLabel,
                    isCurrent && styles.statusButtonLabelCurrent,
                    isPast && styles.statusButtonLabelPast,
                  ]}
                  numberOfLines={1}>
                  {s}
                </Text>
              </TouchableOpacity>
            );
          })}
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['3xl'],
  },
  notFoundText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  backLink: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg2,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerSpinner: {
    paddingVertical: spacing.xs,
    alignItems: 'center',
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  infoCard: {
    marginBottom: spacing.md,
  },
  cardLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  cardValue: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  routeInfo: {
    marginLeft: spacing.sm,
    flex: 1,
  },
  routeLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
  },
  routeValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  routeArrow: {
    marginHorizontal: spacing.sm,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rightAlign: {
    alignItems: 'flex-end',
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metric: {
    flex: 1,
  },
  costValue: {
    color: colors.green,
  },
  mapPlaceholder: {
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.md,
  },
  mapText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    marginTop: spacing.sm,
  },
  tenderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  tenderButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  sectionTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  statusButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  statusButtonCurrent: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  statusButtonPast: {
    backgroundColor: colors.bg3,
    borderColor: colors.border2,
  },
  statusButtonLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  statusButtonLabelCurrent: {
    color: colors.white,
    fontWeight: fontWeight.semibold,
  },
  statusButtonLabelPast: {
    color: colors.text3,
  },
});
