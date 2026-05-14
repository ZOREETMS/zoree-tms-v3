/**
 * PackagingUnitCard — single packaging-unit row for the mobile Item
 * Master's Packaging Units tab (QA #270 parity with the web
 * Item Master's "Packaging Units" tab).
 *
 * Fields surfaced (matches the web table columns):
 *   - id + type badge
 *   - description
 *   - dimensions (L × W × H, inches)
 *   - capacity (lbs)
 *   - status flag
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface Props {
  unit: any;
  onPress?: (unit: any) => void;
}

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  Carton: { bg: 'rgba(37,99,235,0.10)', text: colors.accent },
  Pallet: { bg: 'rgba(124,58,237,0.10)', text: colors.purple },
  Drum:   { bg: 'rgba(8,145,178,0.10)',  text: colors.cyan },
  IBC:    { bg: 'rgba(8,145,178,0.10)',  text: colors.cyan },
  Crate:  { bg: 'rgba(5,150,105,0.10)',  text: colors.green },
  Bag:    { bg: 'rgba(217,119,6,0.10)',  text: colors.yellow },
  Roll:   { bg: 'rgba(220,38,38,0.10)',  text: colors.red },
  Tote:   { bg: 'rgba(100,116,139,0.10)', text: colors.text2 },
};

function typeColor(type: string) {
  return TYPE_COLORS[type] || { bg: 'rgba(100,116,139,0.10)', text: colors.text2 };
}

const PackagingUnitCard: React.FC<Props> = ({ unit, onPress }) => {
  const tc = typeColor(unit.type || 'Carton');
  const dims =
    unit.length && unit.width && unit.height
      ? `${unit.length} × ${unit.width} × ${unit.height}"`
      : '--';
  const cap = unit.capacity ? `${unit.capacity} lbs` : '--';

  return (
    <TouchableOpacity
      onPress={() => onPress?.(unit)}
      activeOpacity={onPress ? 0.7 : 1}>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <Text style={styles.id} numberOfLines={1}>
            {unit.id || '--'}
          </Text>
          <View style={[styles.badge, { backgroundColor: tc.bg }]}>
            <Text style={[styles.badgeText, { color: tc.text }]}>
              {unit.type || 'Carton'}
            </Text>
          </View>
        </View>

        <Text style={styles.description} numberOfLines={2}>
          {unit.description || unit.desc || '--'}
        </Text>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="resize-outline" size={12} color={colors.text3} />
            <Text style={styles.metaText}>{dims}</Text>
          </View>
          <View style={styles.metaItem}>
            <Ionicons name="scale-outline" size={12} color={colors.text3} />
            <Text style={styles.metaText}>{cap}</Text>
          </View>
          {unit.status && (
            <View
              style={[
                styles.statusFlag,
                unit.status === 'Inactive'
                  ? styles.statusInactive
                  : styles.statusActive,
              ]}>
              <Text
                style={[
                  styles.statusText,
                  unit.status === 'Inactive'
                    ? styles.statusTextInactive
                    : styles.statusTextActive,
                ]}>
                {unit.status}
              </Text>
            </View>
          )}
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  id: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: fontSize.xs,
    color: colors.text3,
  },
  statusFlag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginLeft: 'auto',
  },
  statusActive: { backgroundColor: 'rgba(5,150,105,0.10)' },
  statusInactive: { backgroundColor: 'rgba(100,116,139,0.10)' },
  statusText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  statusTextActive: { color: colors.green },
  statusTextInactive: { color: colors.text2 },
});

export default React.memo(PackagingUnitCard);
