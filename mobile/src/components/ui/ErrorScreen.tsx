import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface ErrorScreenProps {
  message: string;
  onRetry: () => void;
}

const ErrorScreen: React.FC<ErrorScreenProps> = ({ message, onRetry }) => (
  <View style={styles.container}>
    <Ionicons name="alert-circle-outline" size={48} color={colors.red} />
    <Text style={styles.title}>Something went wrong</Text>
    <Text style={styles.message}>{message}</Text>
    <TouchableOpacity style={styles.button} onPress={onRetry} activeOpacity={0.7}>
      <Ionicons name="refresh-outline" size={18} color={colors.bg2} style={styles.buttonIcon} />
      <Text style={styles.buttonText}>Retry</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    paddingHorizontal: spacing['3xl'],
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    textAlign: 'center',
    lineHeight: fontSize.md * 1.5,
    marginBottom: spacing.xl,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  buttonIcon: {
    marginRight: spacing.sm,
  },
  buttonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.bg2,
  },
});

export default ErrorScreen;
