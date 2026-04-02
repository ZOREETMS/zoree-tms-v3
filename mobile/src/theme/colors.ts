/**
 * Zoree TMS color palette — extracted from styles.css :root variables.
 * Single source of truth for all colors in the mobile app.
 */
export const colors = {
  // Backgrounds
  bg: '#F8FAFC',
  bg2: '#FFFFFF',
  bg3: '#F8FAFC',
  bg4: '#EFF6FF',

  // Borders
  border: '#E2E8F0',
  border2: '#CBD5E1',

  // Text
  text: '#0F172A',
  text2: '#64748B',
  text3: '#94A3B8',

  // Brand / Accent
  accent: '#2563EB',
  accent2: '#1D4ED8',
  accentGlow: 'rgba(37,99,235,0.08)',

  // Status colors
  green: '#059669',
  greenDim: 'rgba(5,150,105,0.10)',
  yellow: '#D97706',
  yellowDim: 'rgba(217,119,6,0.10)',
  red: '#DC2626',
  redDim: 'rgba(220,38,38,0.10)',

  // Others
  cyan: '#0891B2',
  purple: '#7C3AED',
  white: '#FFFFFF',
  black: '#000000',

  // Login / Dark theme
  loginBg: '#0F172A',
  loginCard: 'rgba(20,32,62,0.92)',
  loginAccent: '#6C5CE7',
  loginGradientStart: '#4F46E5',
  loginGradientEnd: '#6C5CE7',
} as const;

/**
 * Status badge color mappings matching web app patterns.
 */
export const statusColors: Record<string, { bg: string; color: string }> = {
  // Order statuses
  Unplanned: { bg: colors.yellowDim, color: colors.yellow },
  Planned: { bg: colors.accentGlow, color: colors.accent },
  Consolidated: { bg: 'rgba(139,92,246,0.1)', color: colors.purple },
  Tendered: { bg: 'rgba(8,145,178,0.1)', color: colors.cyan },
  Delivered: { bg: colors.greenDim, color: colors.green },
  Cancelled: { bg: '#F3F4F6', color: '#374151' },

  // Shipment statuses
  'In Transit': { bg: colors.accentGlow, color: colors.accent },
  'Picked Up': { bg: 'rgba(8,145,178,0.1)', color: colors.cyan },

  // Generic
  Active: { bg: colors.greenDim, color: colors.green },
  Inactive: { bg: '#F3F4F6', color: '#374151' },
  Warning: { bg: colors.yellowDim, color: colors.yellow },
  Error: { bg: colors.redDim, color: colors.red },

  // Invoice / Audit
  Approved: { bg: '#D1FAE5', color: '#064E3B' },
  Pending: { bg: '#FEF9C3', color: '#713F12' },
  Disputed: { bg: '#FEE2E2', color: '#7F1D1D' },
  'On Hold': { bg: '#FFF7ED', color: '#7C2D12' },
};
