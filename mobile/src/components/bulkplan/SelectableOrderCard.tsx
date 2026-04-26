import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface Props {
  order: any;
  selected: boolean;
  onToggle: (id: string) => void;
  /**
   * Optional edit handler. When provided, an edit pencil shows on the
   * card so the user can adjust the order before bulk-planning. Web
   * parity: bulk-plan/OrderEditModal.jsx flow.
   */
  onEdit?: (order: any) => void;
}

const SelectableOrderCard: React.FC<Props> = ({ order, selected, onToggle, onEdit }) => {
  const weight = order.weight != null ? `${Number(order.weight).toLocaleString()} lbs` : '--';
  const pieces = order.pieces != null ? `${Number(order.pieces).toLocaleString()} pcs` : '';

  return (
    <TouchableOpacity
      onPress={() => onToggle(order.id)}
      activeOpacity={0.7}
      style={styles.wrapper}
    >
      <Card style={[styles.card, selected && styles.cardSelected]}>
        <View style={styles.row}>
          {/* Checkbox */}
          <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
            {selected && <Ionicons name="checkmark" size={14} color={colors.white} />}
          </View>

          {/* Content */}
          <View style={styles.content}>
            <View style={styles.topRow}>
              <Text style={styles.orderId} numberOfLines={1}>
                {order.order_id || order.id}
              </Text>
              <Text style={styles.customer} numberOfLines={1}>
                {order.customer || '--'}
              </Text>
            </View>

            <View style={styles.laneRow}>
              <Ionicons name="location-outline" size={12} color={colors.text3} />
              <Text style={styles.laneText} numberOfLines={1}>
                {order.origin || '--'}
              </Text>
              <Ionicons name="arrow-forward" size={10} color={colors.text3} />
              <Text style={styles.laneText} numberOfLines={1}>
                {order.destination || '--'}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Text style={styles.meta}>{weight}</Text>
              {pieces ? <Text style={styles.meta}>{pieces}</Text> : null}
            </View>
          </View>

          {/* Edit pencil — only when caller wires it. Stop propagation so
              tapping the pencil doesn't also toggle selection. */}
          {onEdit ? (
            <TouchableOpacity
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              onPress={(e) => {
                e.stopPropagation();
                onEdit(order);
              }}
              style={styles.editBtn}
              activeOpacity={0.6}
            >
              <Ionicons name="create-outline" size={18} color={colors.text2} />
            </TouchableOpacity>
          ) : null}
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  wrapper: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  card: { padding: spacing.md },
  cardSelected: {
    backgroundColor: 'rgba(37,99,235,0.06)',
    borderColor: colors.accent,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  checkboxSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  content: { flex: 1 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  orderId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  customer: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginLeft: spacing.sm,
    flex: 1,
    textAlign: 'right',
  },
  laneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  laneText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    flexShrink: 1,
  },
  metaRow: { flexDirection: 'row', gap: spacing.md },
  meta: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    color: colors.text3,
  },
  editBtn: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
});

export default React.memo(SelectableOrderCard);
