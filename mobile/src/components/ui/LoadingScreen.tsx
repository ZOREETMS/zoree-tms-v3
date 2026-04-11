import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../../theme';

const LoadingScreen: React.FC = () => (
  <View style={styles.container}>
    <ActivityIndicator size="large" color={colors.accent} />
    <Text style={styles.text}>Loading...</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  text: {
    marginTop: spacing.md,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
});

export default LoadingScreen;
