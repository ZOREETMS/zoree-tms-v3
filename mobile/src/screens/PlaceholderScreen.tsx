import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight } from '../theme';

interface Props {
  title: string;
  icon?: string;
}

/**
 * Generic placeholder screen for features not yet implemented.
 * Shows the screen name with an icon and "Coming Soon" label.
 */
export default function PlaceholderScreen({ title, icon = '🚧' }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Coming Soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: 24,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.text2,
  },
});
