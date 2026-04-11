import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { deleteItem, toggleItemStatus } from '../../shared/services/itemService';
import { CLASS_COLORS } from '../../shared/constants/itemConstants';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

type DetailRoute = RouteProp<{ ItemDetail: { itemId: string } }, 'ItemDetail'>;

export default function ItemDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<DetailRoute>();
  const { itemId } = route.params;
  const { data, refreshData } = useData();
  const [busy, setBusy] = useState(false);

  const item = useMemo(
    () => data.items.find((i: any) => String(i.id) === String(itemId)),
    [data.items, itemId],
  );

  if (!item) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>Item not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const cls = item.item_class || item.class || 'General';
  const clsColor = CLASS_COLORS[cls as keyof typeof CLASS_COLORS] || CLASS_COLORS.General;
  const dims = item.len && item.wid && item.hgt ? `${item.len} x ${item.wid} x ${item.hgt}"` : '--';

  const handleDelete = () => {
    Alert.alert('Delete Item', `Delete "${item.id}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteItem(item.id);
            await refreshData();
            navigation.goBack();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally { setBusy(false); }
        },
      },
    ]);
  };

  const handleToggleStatus = async () => {
    setBusy(true);
    try {
      await toggleItemStatus(item);
      await refreshData();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{item.id}</Text>
        <StatusBadge status={item.status || 'Active'} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Item Information */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Item Information</Text>
          <InfoRow label="Description" value={item.description || item.desc} />
          <InfoRow label="Customer" value={item.customer} />
          <View style={styles.classRow}>
            <Text style={styles.infoLabel}>Class</Text>
            <View style={[styles.classBadge, { backgroundColor: clsColor.bg }]}>
              <Text style={[styles.classBadgeText, { color: clsColor.text }]}>{cls}</Text>
            </View>
          </View>
          <InfoRow label="NMFC" value={item.nmfc} />
          <InfoRow label="Freight Class" value={item.freight_class || item.fclass} />
          <InfoRow label="Packaging" value={item.pkg} />
        </Card>

        {/* Physical Properties */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Physical Properties</Text>
          <InfoRow label="Weight per Unit" value={item.weight_unit ? `${item.weight_unit} lbs` : null} />
          <InfoRow label="Value per Unit" value={item.value_unit ? `$${Number(item.value_unit).toLocaleString()}` : null} />
          <InfoRow label="Dimensions (L x W x H)" value={dims} />
          <InfoRow label="Units per Pallet" value={item.units_per_pallet ? String(item.units_per_pallet) : null} />
          <InfoRow label="Stack Height" value={item.stack ? String(item.stack) : null} />
        </Card>

        {/* Special Handling */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Special Handling</Text>
          <FlagRow label="Hazmat" active={!!item.hazmat} />
          {item.hazmat && (
            <>
              <InfoRow label="UN Number" value={item.un} />
              <InfoRow label="Hazmat Class" value={item.haz_class} />
            </>
          )}
          <FlagRow label="Fragile" active={!!item.fragile} />
          <FlagRow label="Temperature Controlled" active={!!item.temp_ctrl} />
          <FlagRow label="Top Load Only" active={!!item.top_load} />
        </Card>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.accent }]}
            onPress={() => navigation.navigate('ItemForm', { itemId: item.id })}
            disabled={busy}
          >
            <Ionicons name="create-outline" size={20} color={colors.accent} />
            <Text style={[styles.actionBtnText, { color: colors.accent }]}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.yellow }]}
            onPress={handleToggleStatus}
            disabled={busy}
          >
            <Ionicons name={item.status === 'Active' ? 'pause-outline' : 'play-outline'} size={20} color={colors.yellow} />
            <Text style={[styles.actionBtnText, { color: colors.yellow }]}>
              {item.status === 'Active' ? 'Deactivate' : 'Activate'}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: colors.red, marginHorizontal: spacing.lg, marginTop: spacing.sm }]}
          onPress={handleDelete}
          disabled={busy}
        >
          <Ionicons name="trash-outline" size={20} color={colors.red} />
          <Text style={[styles.actionBtnText, { color: colors.red }]}>Delete</Text>
        </TouchableOpacity>

        <View style={{ height: spacing['5xl'] }} />
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value || '\u2014'}</Text>
    </View>
  );
}

function FlagRow({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Ionicons
        name={active ? 'checkmark-circle' : 'close-circle-outline'}
        size={18}
        color={active ? colors.green : colors.text3}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  emptyText: { fontSize: fontSize.lg, color: colors.text3 },
  link: { fontSize: fontSize.md, color: colors.accent, marginTop: spacing.md, fontWeight: fontWeight.semibold },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    backgroundColor: colors.bg2, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { marginRight: spacing.md, padding: spacing.xs },
  headerTitle: { flex: 1, fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, marginRight: spacing.sm },
  scroll: { padding: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text, marginBottom: spacing.md,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  infoLabel: { fontSize: fontSize.md, fontWeight: fontWeight.medium, color: colors.text2 },
  infoValue: { fontSize: fontSize.md, fontWeight: fontWeight.regular, color: colors.text, flex: 1, textAlign: 'right', marginLeft: spacing.md },
  classRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  classBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: borderRadius.sm },
  classBadgeText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: spacing.md, borderRadius: borderRadius.md,
    borderWidth: 1.5, backgroundColor: colors.bg2,
  },
  actionBtnText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
});
