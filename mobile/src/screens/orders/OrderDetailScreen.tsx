import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { DbApi, OrdersApi } from '../../lib/api';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import type { PlanningTabParamList } from '../../navigation/types';

type DetailRoute = RouteProp<PlanningTabParamList, 'OrderDetail'>;

export default function OrderDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<DetailRoute>();
  const { orderId } = route.params;

  const { data, refreshData } = useData();

  const [lines, setLines] = useState<any[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const order = useMemo(
    () => data.orders.find((o) => (o.id ?? o.order_id)?.toString() === orderId),
    [data.orders, orderId],
  );

  // Fetch order lines on mount
  useEffect(() => {
    if (!orderId || orderId === 'new') return;
    setLinesLoading(true);
    OrdersApi.lines(orderId)
      .then((res: any) => setLines(Array.isArray(res) ? res : []))
      .catch(() => setLines([]))
      .finally(() => setLinesLoading(false));
  }, [orderId]);

  const changeStatus = useCallback(
    async (newStatus: string) => {
      if (!order) return;
      const id = order.id ?? order.order_id;
      Alert.alert(
        'Confirm Status Change',
        `Change order status to "${newStatus}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Confirm',
            onPress: async () => {
              setUpdating(true);
              try {
                await DbApi.patch('orders', id, { status: newStatus });
                await refreshData();
              } catch (e: any) {
                Alert.alert('Error', e.message || 'Failed to update status');
              } finally {
                setUpdating(false);
              }
            },
          },
        ],
      );
    },
    [order, refreshData],
  );

  if (!order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFound}>Order not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const status = order.status || 'Unplanned';
  const readyDate = order.ready_date
    ? new Date(order.ready_date).toLocaleDateString()
    : '--';
  const dueDate = order.due_date
    ? new Date(order.due_date).toLocaleDateString()
    : '--';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {order.order_id || order.id}
          </Text>
        </View>
        <StatusBadge status={status} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Order Info Card */}
        <Card style={styles.infoCard}>
          <Text style={styles.sectionTitle}>Order Information</Text>

          <InfoRow label="Customer" value={order.customer_name || '--'} />
          <InfoRow
            label="Origin"
            value={order.origin_city || order.origin || '--'}
          />
          <InfoRow
            label="Destination"
            value={order.destination_city || order.destination || '--'}
          />
          <InfoRow label="Ready Date" value={readyDate} />
          <InfoRow label="Due Date" value={dueDate} />
          <InfoRow
            label="Weight"
            value={
              order.total_weight != null
                ? `${Number(order.total_weight).toLocaleString()} lbs`
                : '--'
            }
          />
          <InfoRow
            label="Pieces"
            value={
              order.total_pieces != null
                ? `${Number(order.total_pieces).toLocaleString()}`
                : '--'
            }
          />
        </Card>

        {/* Order Lines */}
        <Card style={styles.infoCard}>
          <Text style={styles.sectionTitle}>Order Lines</Text>
          {linesLoading ? (
            <ActivityIndicator color={colors.accent} style={styles.linesLoader} />
          ) : lines.length === 0 ? (
            <Text style={styles.emptyLines}>No line items</Text>
          ) : (
            lines.map((line, idx) => (
              <View
                key={line.id ?? idx}
                style={[styles.lineItem, idx < lines.length - 1 && styles.lineItemBorder]}
              >
                <View style={styles.lineItemHeader}>
                  <Text style={styles.lineItemName} numberOfLines={1}>
                    {line.item_name || line.description || `Line ${idx + 1}`}
                  </Text>
                  <Text style={styles.lineItemQty}>
                    {line.quantity != null ? `Qty: ${line.quantity}` : ''}
                  </Text>
                </View>
                {line.weight != null && (
                  <Text style={styles.lineItemMeta}>
                    Weight: {Number(line.weight).toLocaleString()} lbs
                  </Text>
                )}
              </View>
            ))
          )}
        </Card>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <ActionButton
            label="Edit"
            icon="create-outline"
            color={colors.accent}
            onPress={() => navigation.navigate('OrderDetail', { orderId: order.id, edit: true })}
            disabled={updating}
          />
          <ActionButton
            label="Plan"
            icon="git-merge-outline"
            color={colors.purple}
            onPress={() => changeStatus('Planned')}
            disabled={updating || status === 'Planned'}
          />
          <ActionButton
            label="Tender"
            icon="send-outline"
            color={colors.cyan}
            onPress={() => changeStatus('Tendered')}
            disabled={updating || status === 'Tendered'}
          />
          <ActionButton
            label="Cancel"
            icon="close-circle-outline"
            color={colors.red}
            onPress={() => changeStatus('Cancelled')}
            disabled={updating || status === 'Cancelled'}
          />
        </View>
      </ScrollView>

      {updating && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}
    </View>
  );
}

/* ---------- Reusable sub-components ---------- */

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  color,
  onPress,
  disabled,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { borderColor: color }, disabled && styles.actionBtnDisabled]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <Ionicons name={icon} size={20} color={disabled ? colors.text3 : color} />
      <Text style={[styles.actionBtnLabel, { color: disabled ? colors.text3 : color }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },
  notFound: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  backLink: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    marginRight: spacing.md,
    padding: spacing.xs,
  },
  headerCenter: {
    flex: 1,
    marginRight: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  infoCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  infoValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  linesLoader: {
    marginVertical: spacing.lg,
  },
  emptyLines: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  lineItem: {
    paddingVertical: spacing.md,
  },
  lineItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lineItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineItemName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  lineItemQty: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  lineItemMeta: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text3,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  actionBtn: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    backgroundColor: colors.bg2,
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionBtnLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
