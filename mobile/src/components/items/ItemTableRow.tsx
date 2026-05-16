/**
 * ItemTableRow — dense row variant of ItemCard for the Table view.
 *
 * QA #318: the web Item Master has a Table / Card view toggle. The
 * mobile catalog only renders ItemCard (rich, multi-line). This
 * companion row collapses each item to a single tappable line with
 * id, description, class chip, and weight — the columns the web table
 * leads with. Keeping it in its own file means the Table view can
 * evolve (add more columns, sortable headers) without touching
 * ItemCard.
 *
 * Tap behaviour mirrors ItemCard so callers swap renderItem without
 * any other change.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface Props {
  item: any;
  onPress: (item: any) => void;
}

const ItemTableRow: React.FC<Props> = ({ item, onPress }) => {
  const description = item.description ?? item.desc ?? '';
  const klass = item.item_class ?? item.class ?? 'General';
  const weight = item.weight_unit ?? item.weight ?? null;
  const nmfc = item.nmfc ?? '';
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => onPress(item)}
      style={styles.row}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.id} numberOfLines={1}>{String(item.id)}</Text>
        <Text style={styles.desc} numberOfLines={1}>{description || '—'}</Text>
      </View>
      <View style={styles.meta}>
        <View style={styles.classChip}>
          <Text style={styles.classText}>{klass}</Text>
        </View>
        <Text style={styles.weight}>{weight != null ? `${weight} lb` : nmfc || '—'}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.text3} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  id: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontFamily: 'monospace',
  },
  desc: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  meta: {
    alignItems: 'flex-end',
    gap: 2,
  },
  classChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.accentGlow,
  },
  classText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  weight: {
    fontSize: fontSize.xs,
    color: colors.text3,
  },
});

export default ItemTableRow;
