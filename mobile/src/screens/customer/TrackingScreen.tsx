import React, { useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

/**
 * Timeline step definition for shipment tracking.
 */
interface TimelineStep {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const TIMELINE_STEPS: TimelineStep[] = [
  { key: 'ordered', label: 'Ordered', icon: 'receipt-outline' },
  { key: 'picked_up', label: 'Picked Up', icon: 'archive-outline' },
  { key: 'in_transit', label: 'In Transit', icon: 'car-outline' },
  { key: 'delivered', label: 'Delivered', icon: 'checkmark-circle-outline' },
];

/**
 * Map raw shipment status strings to timeline step keys.
 */
function resolveActiveStep(status: string): number {
  const s = (status || '').toLowerCase().replace(/[\s_-]/g, '');
  if (s.includes('delivered') || s.includes('complete')) return 3;
  if (s.includes('intransit') || s.includes('transit')) return 2;
  if (s.includes('pickedup') || s.includes('pickup')) return 1;
  return 0;
}

interface TrackingScreenProps {
  route?: {
    params?: {
      shipment?: any;
    };
  };
}

export default function TrackingScreen({ route }: TrackingScreenProps) {
  const shipment = route?.params?.shipment;

  const activeStep = useMemo(
    () => resolveActiveStep(shipment?.status || ''),
    [shipment?.status],
  );

  const statusLabel = shipment?.status || 'Unknown';
  const carrierName =
    shipment?.carrier_name ||
    shipment?.carrierName ||
    shipment?.carrier ||
    'Not assigned';
  const origin =
    shipment?.origin_city || shipment?.origin || shipment?.originCity || '--';
  const destination =
    shipment?.destination_city ||
    shipment?.destination ||
    shipment?.destinationCity ||
    '--';
  const eta = shipment?.eta || shipment?.estimated_delivery || 'TBD';
  const shipmentId =
    shipment?.shipment_id ||
    shipment?.id ||
    shipment?.shipmentId ||
    'N/A';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Shipment Tracking</Text>
          <StatusBadge status={statusLabel} />
        </View>

        {/* Shipment ID */}
        <View style={styles.idRow}>
          <Ionicons name="cube-outline" size={18} color={colors.text2} />
          <Text style={styles.shipmentId}>{shipmentId}</Text>
        </View>

        {/* Status Timeline */}
        <Card style={styles.timelineCard}>
          <Text style={styles.sectionTitle}>Shipment Status</Text>
          <View style={styles.timeline}>
            {TIMELINE_STEPS.map((step, index) => {
              const isComplete = index <= activeStep;
              const isCurrent = index === activeStep;
              const isLast = index === TIMELINE_STEPS.length - 1;

              return (
                <View key={step.key} style={styles.timelineStep}>
                  {/* Connector line (above the dot) */}
                  {index > 0 && (
                    <View
                      style={[
                        styles.timelineLineTop,
                        isComplete && styles.timelineLineActive,
                      ]}
                    />
                  )}

                  {/* Dot / Icon */}
                  <View
                    style={[
                      styles.timelineDot,
                      isComplete && styles.timelineDotActive,
                      isCurrent && styles.timelineDotCurrent,
                    ]}>
                    <Ionicons
                      name={step.icon}
                      size={18}
                      color={isComplete ? colors.white : colors.text3}
                    />
                  </View>

                  {/* Label */}
                  <Text
                    style={[
                      styles.timelineLabel,
                      isComplete && styles.timelineLabelActive,
                      isCurrent && styles.timelineLabelCurrent,
                    ]}>
                    {step.label}
                  </Text>

                  {/* Connector line (below the dot) */}
                  {!isLast && (
                    <View
                      style={[
                        styles.timelineLineBottom,
                        index < activeStep && styles.timelineLineActive,
                      ]}
                    />
                  )}
                </View>
              );
            })}
          </View>
        </Card>

        {/* Current Location */}
        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons
              name="location-outline"
              size={20}
              color={colors.accent}
            />
            <Text style={styles.infoTitle}>Current Location</Text>
          </View>
          <View style={styles.routeRow}>
            <View style={styles.routePoint}>
              <View style={[styles.routeDot, { backgroundColor: colors.green }]} />
              <View>
                <Text style={styles.routeLabel}>Origin</Text>
                <Text style={styles.routeValue}>{origin}</Text>
              </View>
            </View>
            <View style={styles.routeDivider}>
              <Ionicons
                name="arrow-forward"
                size={16}
                color={colors.text3}
              />
            </View>
            <View style={styles.routePoint}>
              <View style={[styles.routeDot, { backgroundColor: colors.red }]} />
              <View>
                <Text style={styles.routeLabel}>Destination</Text>
                <Text style={styles.routeValue}>{destination}</Text>
              </View>
            </View>
          </View>
        </Card>

        {/* ETA */}
        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="time-outline" size={20} color={colors.yellow} />
            <Text style={styles.infoTitle}>Estimated Arrival</Text>
          </View>
          <Text style={styles.etaValue}>{eta}</Text>
          <Text style={styles.etaSubtitle}>
            {activeStep >= 3
              ? 'This shipment has been delivered.'
              : 'Estimated based on current route and conditions.'}
          </Text>
        </Card>

        {/* Carrier Info */}
        <Card style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="car-outline" size={20} color={colors.purple} />
            <Text style={styles.infoTitle}>Carrier Information</Text>
          </View>
          <View style={styles.carrierRow}>
            <View style={styles.carrierAvatar}>
              <Ionicons
                name="business-outline"
                size={22}
                color={colors.accent}
              />
            </View>
            <View style={styles.carrierInfo}>
              <Text style={styles.carrierName}>{carrierName}</Text>
              <Text style={styles.carrierMeta}>
                {shipment?.mode || shipment?.transport_mode || 'TL'}
              </Text>
            </View>
          </View>
        </Card>

        {/* Map Placeholder */}
        <Card style={styles.mapCard}>
          <View style={styles.mapPlaceholder}>
            <Ionicons name="map-outline" size={48} color={colors.text3} />
            <Text style={styles.mapPlaceholderText}>
              Map view coming soon
            </Text>
            <Text style={styles.mapPlaceholderSubtext}>
              Live route tracking will be displayed here.
            </Text>
          </View>
        </Card>
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
  scrollContent: {
    paddingBottom: spacing['5xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  shipmentId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  timelineCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  timeline: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.sm,
  },
  timelineStep: {
    alignItems: 'center',
    flex: 1,
  },
  timelineLineTop: {
    display: 'none',
  },
  timelineLineBottom: {
    display: 'none',
  },
  timelineLineActive: {
    backgroundColor: colors.accent,
  },
  timelineDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.bg3,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  timelineDotActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  timelineDotCurrent: {
    borderColor: colors.accent2,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  timelineLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textAlign: 'center',
  },
  timelineLabelActive: {
    color: colors.text,
  },
  timelineLabelCurrent: {
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  infoCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  infoTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  routePoint: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  routeLabel: {
    fontSize: fontSize.xs,
    color: colors.text3,
  },
  routeValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
    marginTop: 1,
  },
  routeDivider: {
    paddingHorizontal: spacing.sm,
  },
  etaValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  etaSubtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
  carrierRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  carrierAvatar: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentGlow,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  carrierInfo: {
    flex: 1,
  },
  carrierName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  carrierMeta: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: 2,
  },
  mapCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  mapPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.md,
  },
  mapPlaceholderText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginTop: spacing.md,
  },
  mapPlaceholderSubtext: {
    fontSize: fontSize.sm,
    color: colors.text3,
    marginTop: spacing.xs,
  },
});
