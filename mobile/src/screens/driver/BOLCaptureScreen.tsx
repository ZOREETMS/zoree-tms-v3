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
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function BOLCaptureScreen() {
  const [hasImage, setHasImage] = useState(false);

  const handleCameraCapture = () => {
    // Placeholder: actual camera integration requires native setup (expo-camera or react-native-camera)
    Alert.alert(
      'Camera Placeholder',
      'Camera capture requires native setup with expo-camera or react-native-camera. This is a placeholder for the capture flow.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Simulate Capture',
          onPress: () => setHasImage(true),
        },
      ],
    );
  };

  const handleGallerySelect = () => {
    // Placeholder: actual image picker requires expo-image-picker or react-native-image-picker
    Alert.alert(
      'Gallery Placeholder',
      'Gallery selection requires expo-image-picker or react-native-image-picker. This is a placeholder for the selection flow.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Simulate Selection',
          onPress: () => setHasImage(true),
        },
      ],
    );
  };

  const handleRetake = () => {
    setHasImage(false);
  };

  const handleSubmit = () => {
    if (!hasImage) {
      Alert.alert('No Image', 'Please capture or select a BOL image first.');
      return;
    }
    Alert.alert(
      'Confirm Submission',
      'Submit this Bill of Lading photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          onPress: () => {
            Alert.alert('Success', 'BOL photo submitted successfully.');
            setHasImage(false);
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="document-text-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>BOL Capture</Text>
        </View>

        {/* Instructions */}
        <Card style={styles.instructionCard}>
          <Ionicons name="information-circle-outline" size={22} color={colors.accent} />
          <Text style={styles.instructionText}>
            Capture Bill of Lading
          </Text>
          <Text style={styles.instructionSubtext}>
            Take a clear photo of the Bill of Lading document. Ensure all text is legible and the entire document is visible in the frame.
          </Text>
        </Card>

        {/* Preview area */}
        <View style={styles.previewContainer}>
          {hasImage ? (
            <View style={styles.previewImage}>
              <Ionicons name="image" size={64} color={colors.green} />
              <Text style={styles.previewText}>BOL Image Captured</Text>
              <Text style={styles.previewSubtext}>Image preview placeholder</Text>
              <TouchableOpacity style={styles.retakeButton} onPress={handleRetake} activeOpacity={0.7}>
                <Ionicons name="refresh" size={18} color={colors.accent} />
                <Text style={styles.retakeText}>Retake</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.previewPlaceholder}>
              <Ionicons name="image-outline" size={64} color={colors.text3} />
              <Text style={styles.placeholderText}>No image captured</Text>
              <Text style={styles.placeholderSubtext}>
                Use the camera or gallery buttons below
              </Text>
            </View>
          )}
        </View>

        {/* Action buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={styles.captureButton}
            activeOpacity={0.7}
            onPress={handleCameraCapture}
          >
            <Ionicons name="camera" size={28} color={colors.white} />
            <Text style={styles.captureButtonText}>Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.galleryButton}
            activeOpacity={0.7}
            onPress={handleGallerySelect}
          >
            <Ionicons name="images" size={28} color={colors.accent} />
            <Text style={styles.galleryButtonText}>Gallery</Text>
          </TouchableOpacity>
        </View>

        {/* Submit button */}
        <TouchableOpacity
          style={[styles.submitButton, !hasImage && styles.submitButtonDisabled]}
          activeOpacity={0.7}
          disabled={!hasImage}
          onPress={handleSubmit}
        >
          <Ionicons name="cloud-upload-outline" size={22} color={colors.white} />
          <Text style={styles.submitButtonText}>Submit BOL</Text>
        </TouchableOpacity>
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
  instructionCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  instructionText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  instructionSubtext: {
    fontSize: fontSize.sm,
    color: colors.text2,
    textAlign: 'center',
    lineHeight: fontSize.sm * 1.6,
  },
  previewContainer: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  previewPlaceholder: {
    height: 280,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  placeholderText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  placeholderSubtext: {
    fontSize: fontSize.sm,
    color: colors.text3,
  },
  previewImage: {
    height: 280,
    backgroundColor: colors.greenDim,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.green,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.green,
  },
  previewSubtext: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
  retakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  retakeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  actionButtons: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  captureButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  captureButtonText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  galleryButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  galleryButtonText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  submitButton: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    backgroundColor: colors.green,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  submitButtonDisabled: {
    backgroundColor: colors.text3,
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
});
