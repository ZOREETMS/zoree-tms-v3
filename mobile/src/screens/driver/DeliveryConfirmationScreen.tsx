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

const STEPS = [
  { key: 'photo', label: 'Photo Proof', icon: 'camera' as const },
  { key: 'signature', label: 'Signature', icon: 'create' as const },
  { key: 'confirm', label: 'Confirm', icon: 'checkmark-circle' as const },
];

export default function DeliveryConfirmationScreen() {
  const { data, loading, refreshData } = useData();
  const [currentStep, setCurrentStep] = useState(0);
  const [photoTaken, setPhotoTaken] = useState(false);
  const [signatureCaptured, setSignatureCaptured] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Get first active in-transit shipment
  const activeShipment = data.shipments.find(
    (s: any) =>
      ['in transit', 'picked up', 'arrived at delivery'].includes(
        (s.status || '').toLowerCase(),
      ),
  );

  if (loading && data.shipments.length === 0) {
    return <LoadingScreen />;
  }

  const shipmentId = activeShipment
    ? activeShipment.id || activeShipment.shipment_id || activeShipment.shipmentId
    : null;

  const handlePhotoCapture = () => {
    Alert.alert(
      'Photo Capture',
      'Camera requires native setup. Simulate photo capture?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Simulate',
          onPress: () => {
            setPhotoTaken(true);
            setCurrentStep(1);
          },
        },
      ],
    );
  };

  const handleSignatureCapture = () => {
    Alert.alert(
      'Signature Capture',
      'Signature pad requires react-native-signature-canvas. Simulate signature?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Simulate',
          onPress: () => {
            setSignatureCaptured(true);
            setCurrentStep(2);
          },
        },
      ],
    );
  };

  const handleConfirmDelivery = () => {
    if (!activeShipment || !shipmentId) {
      Alert.alert('Error', 'No active shipment selected.');
      return;
    }
    if (!photoTaken) {
      Alert.alert('Missing Step', 'Please capture photo proof first.');
      setCurrentStep(0);
      return;
    }
    if (!signatureCaptured) {
      Alert.alert('Missing Step', 'Please capture signature first.');
      setCurrentStep(1);
      return;
    }

    Alert.alert(
      'Confirm Delivery',
      `Mark shipment ${shipmentId} as Delivered?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Delivery',
          style: 'default',
          onPress: async () => {
            setSubmitting(true);
            try {
              await DbApi.patch('shipments', shipmentId, {
                status: 'Delivered',
              });
              await refreshData();
              Alert.alert('Success', 'Delivery confirmed successfully.');
              // Reset state
              setPhotoTaken(false);
              setSignatureCaptured(false);
              setCurrentStep(0);
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to confirm delivery');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Step 1: Capture Photo Proof</Text>
            <Text style={styles.stepDescription}>
              Take a photo of the delivered goods as proof of delivery.
            </Text>
            {photoTaken ? (
              <View style={styles.completedArea}>
                <Ionicons name="checkmark-circle" size={48} color={colors.green} />
                <Text style={styles.completedText}>Photo captured</Text>
                <TouchableOpacity
                  style={styles.retakeLink}
                  onPress={() => setPhotoTaken(false)}
                >
                  <Text style={styles.retakeLinkText}>Retake photo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.captureButton}
                activeOpacity={0.7}
                onPress={handlePhotoCapture}
              >
                <Ionicons name="camera" size={32} color={colors.white} />
                <Text style={styles.captureButtonText}>Take Photo</Text>
              </TouchableOpacity>
            )}
          </View>
        );

      case 1:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Step 2: Capture Signature</Text>
            <Text style={styles.stepDescription}>
              Capture the recipient's signature to confirm receipt of goods.
            </Text>
            {signatureCaptured ? (
              <View style={styles.completedArea}>
                <Ionicons name="checkmark-circle" size={48} color={colors.green} />
                <Text style={styles.completedText}>Signature captured</Text>
                <TouchableOpacity
                  style={styles.retakeLink}
                  onPress={() => setSignatureCaptured(false)}
                >
                  <Text style={styles.retakeLinkText}>Recapture signature</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.signaturePlaceholder}>
                  <Ionicons name="create-outline" size={48} color={colors.text3} />
                  <Text style={styles.signaturePlaceholderText}>
                    Signature pad placeholder
                  </Text>
                  <Text style={styles.signaturePlaceholderSubtext}>
                    Requires react-native-signature-canvas
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.signatureButton}
                  activeOpacity={0.7}
                  onPress={handleSignatureCapture}
                >
                  <Ionicons name="create" size={22} color={colors.white} />
                  <Text style={styles.captureButtonText}>Capture Signature</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        );

      case 2:
        return (
          <View style={styles.stepContent}>
            <Text style={styles.stepTitle}>Step 3: Confirm Delivery</Text>
            <Text style={styles.stepDescription}>
              Review and confirm that the delivery is complete.
            </Text>

            <Card style={styles.reviewCard}>
              <View style={styles.reviewRow}>
                <Ionicons
                  name={photoTaken ? 'checkmark-circle' : 'close-circle'}
                  size={20}
                  color={photoTaken ? colors.green : colors.red}
                />
                <Text style={styles.reviewLabel}>Photo proof</Text>
                <Text style={[styles.reviewStatus, { color: photoTaken ? colors.green : colors.red }]}>
                  {photoTaken ? 'Complete' : 'Missing'}
                </Text>
              </View>
              <View style={styles.reviewRow}>
                <Ionicons
                  name={signatureCaptured ? 'checkmark-circle' : 'close-circle'}
                  size={20}
                  color={signatureCaptured ? colors.green : colors.red}
                />
                <Text style={styles.reviewLabel}>Signature</Text>
                <Text style={[styles.reviewStatus, { color: signatureCaptured ? colors.green : colors.red }]}>
                  {signatureCaptured ? 'Complete' : 'Missing'}
                </Text>
              </View>
            </Card>

            <TouchableOpacity
              style={[
                styles.confirmButton,
                (!photoTaken || !signatureCaptured || submitting) && styles.confirmButtonDisabled,
              ]}
              activeOpacity={0.7}
              disabled={!photoTaken || !signatureCaptured || submitting}
              onPress={handleConfirmDelivery}
            >
              <Ionicons name="checkmark-done" size={24} color={colors.white} />
              <Text style={styles.confirmButtonText}>
                {submitting ? 'Submitting...' : 'Confirm Delivery'}
              </Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="checkmark-done-outline" size={24} color={colors.accent} />
          <Text style={styles.headerTitle}>Delivery Confirmation</Text>
        </View>

        {/* Shipment details */}
        {activeShipment ? (
          <Card style={styles.shipmentCard}>
            <View style={styles.shipmentRow}>
              <Text style={styles.shipmentId}>{shipmentId}</Text>
              <StatusBadge status={activeShipment.status || 'Unknown'} />
            </View>
            <View style={styles.shipmentDetails}>
              <Text style={styles.detailText}>
                {activeShipment.carrier_name || activeShipment.carrierName || activeShipment.carrier || '--'}
              </Text>
              <Text style={styles.routeText}>
                {activeShipment.origin_city || activeShipment.origin || '--'}
                {' -> '}
                {activeShipment.destination_city || activeShipment.destination || '--'}
              </Text>
            </View>
          </Card>
        ) : (
          <Card style={styles.shipmentCard}>
            <View style={styles.emptyShipment}>
              <Ionicons name="cube-outline" size={36} color={colors.text3} />
              <Text style={styles.emptyText}>No shipments ready for delivery confirmation</Text>
            </View>
          </Card>
        )}

        {/* Progress indicator */}
        <View style={styles.progressContainer}>
          {STEPS.map((step, index) => {
            const isActive = index === currentStep;
            const isCompleted =
              (index === 0 && photoTaken) ||
              (index === 1 && signatureCaptured) ||
              (index === 2 && photoTaken && signatureCaptured);

            return (
              <React.Fragment key={step.key}>
                <TouchableOpacity
                  style={styles.stepIndicator}
                  onPress={() => setCurrentStep(index)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.stepCircle,
                      isActive && styles.stepCircleActive,
                      isCompleted && styles.stepCircleCompleted,
                    ]}
                  >
                    <Ionicons
                      name={isCompleted ? 'checkmark' : step.icon}
                      size={18}
                      color={
                        isCompleted
                          ? colors.white
                          : isActive
                          ? colors.white
                          : colors.text3
                      }
                    />
                  </View>
                  <Text
                    style={[
                      styles.stepLabel,
                      isActive && styles.stepLabelActive,
                      isCompleted && styles.stepLabelCompleted,
                    ]}
                  >
                    {step.label}
                  </Text>
                </TouchableOpacity>
                {index < STEPS.length - 1 && (
                  <View
                    style={[
                      styles.stepConnector,
                      isCompleted && styles.stepConnectorCompleted,
                    ]}
                  />
                )}
              </React.Fragment>
            );
          })}
        </View>

        {/* Step content */}
        {activeShipment && renderStepContent()}
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
  headerTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  shipmentCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  shipmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  shipmentId: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  shipmentDetails: {
    gap: spacing.xs,
  },
  detailText: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
  routeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  emptyShipment: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.text2,
    textAlign: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  stepIndicator: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg3,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepCircleActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  stepCircleCompleted: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  stepLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
  },
  stepLabelActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  stepLabelCompleted: {
    color: colors.green,
    fontWeight: fontWeight.semibold,
  },
  stepConnector: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xl,
  },
  stepConnectorCompleted: {
    backgroundColor: colors.green,
  },
  stepContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  stepTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  stepDescription: {
    fontSize: fontSize.sm,
    color: colors.text2,
    lineHeight: fontSize.sm * 1.6,
  },
  completedArea: {
    alignItems: 'center',
    paddingVertical: spacing['2xl'],
    gap: spacing.sm,
  },
  completedText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.green,
  },
  retakeLink: {
    paddingVertical: spacing.xs,
  },
  retakeLinkText: {
    fontSize: fontSize.sm,
    color: colors.accent,
    fontWeight: fontWeight.medium,
  },
  captureButton: {
    flexDirection: 'row',
    backgroundColor: colors.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  captureButtonText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  signaturePlaceholder: {
    height: 160,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  signaturePlaceholderText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  signaturePlaceholderSubtext: {
    fontSize: fontSize.sm,
    color: colors.text3,
  },
  signatureButton: {
    flexDirection: 'row',
    backgroundColor: colors.purple,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reviewCard: {
    gap: spacing.md,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reviewLabel: {
    fontSize: fontSize.md,
    color: colors.text,
    flex: 1,
  },
  reviewStatus: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  confirmButton: {
    flexDirection: 'row',
    backgroundColor: colors.green,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  confirmButtonDisabled: {
    backgroundColor: colors.text3,
    opacity: 0.5,
  },
  confirmButtonText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
});
