import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import { CLASS_COLORS } from '../../shared/constants/itemConstants';

interface Props {
  item: any;
  onPress: (item: any) => void;
}

const ItemCard: React.FC<Props> = ({ item, onPress }) => {
  const cls = item.item_class || item.class || 'General';
  const clsColor = CLASS_COLORS[cls] || CLASS_COLORS.General;
  const weight = item.weight_unit ? `${item.weight_unit} lbs` : '--';
  const dims =
    item.len && item.wid && item.hgt ? `${item.len}x${item.wid}x${item.hgt}"` : '';

  return (
    <TouchableOpacity onPress={() => onPress(item)} activeOpacity={0.7}>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <Text style={styles.itemId} numberOfLines={1}>
            {item.id}
          </Text>
          <View style={[styles.classBadge, { backgroundColor: clsColor.bg }]}>
            <Text style={[styles.classBadgeText, { color: clsColor.text }]}>{cls}</Text>
          </View>
        </View>

        <Text style={styles.description} numberOfLines={2}>
          {item.description || item.desc || '--'}
        </Text>

        {item.customer ? (
          <Text style={styles.customer} numberOfLines={1}>
            {item.customer}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="scale-outline" size={12} color={colors.text3} />
            <Text style={styles.metaText}>{weight}</Text>
          </View>
          {dims ? (
            <View style={styles.metaItem}>
              <Ionicons name="resize-outline" size={12} color={colors.text3} />
              <Text style={styles.metaText}>{dims}</Text>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Text style={styles.metaText}>FC: {item.freight_class || item.fclass || '70'}</Text>
          </View>
        </View>

        {/* Special handling icons */}
        <View style={styles.flagsRow}>
          {item.hazmat && (
            <View style={[styles.flag, { backgroundColor: 'rgba(239,68,68,0.1)' }]}>
              <Text style={[styles.flagText, { color: colors.red }]}>HAZMAT</Text>
            </View>
          )}
          {item.fragile && (
            <View style={[styles.flag, { backgroundColor: 'rgba(245,158,11,0.1)' }]}>
              <Text style={[styles.flagText, { color: colors.yellow }]}>FRAGILE</Text>
            </View>
          )}
          {item.temp_ctrl && (
            <View style={[styles.flag, { backgroundColor: 'rgba(8,145,178,0.1)' }]}>
              <Text style={[styles.flagText, { color: colors.cyan }]}>TEMP</Text>
            </View>
          )}
          {item.status === 'Inactive' && (
            <View style={[styles.flag, { backgroundColor: 'rgba(107,114,128,0.1)' }]}>
              <Text style={[styles.flagText, { color: colors.text3 }]}>INACTIVE</Text>
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
  itemId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  classBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  classBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  description: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginBottom: spacing.xs,
  },
  customer: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  metaText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
  },
  flagsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  flag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  flagText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
});

export default React.memo(ItemCard);
