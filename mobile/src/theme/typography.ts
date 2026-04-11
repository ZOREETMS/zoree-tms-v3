import { Platform } from 'react-native';

/**
 * Typography scale matching the Zoree TMS web design system.
 * Uses system fonts on mobile (SF Pro on iOS, Roboto on Android).
 */
export const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

export const fontFamilyMono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

export const fontSize = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 28,
  '4xl': 34,
} as const;

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

export const lineHeight = {
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.75,
};
