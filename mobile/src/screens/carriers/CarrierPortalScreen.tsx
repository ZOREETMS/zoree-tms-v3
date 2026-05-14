/**
 * CarrierPortalScreen — tender list + accept/reject for the active
 * portal carrier. Mobile mirror of frontend/src/pages/CarrierPortalPage.jsx
 * + TenderCard.jsx.
 *
 * The "active carrier" is settable inline via a chip picker built
 * from `data.carriers` + the carrier names that appear on shipments.
 * No backend "current user" plumbing on mobile yet — pick the carrier
 * for the session and the screen filters to those tenders.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import KpiCard from '../../components/ui/KpiCard';
import TenderRespondModal from '../../components/carriers/TenderRespondModal';
import { useData } from '../../state/DataContext';
import {
  DEFAULT_PORTAL_CARRIER,
  buildPersistedTenderResponses,
  effectiveShipmentStatus,
  getUniqueCarrierNames,
  pickActiveTenders,
  type TenderResponse,
} from '../../services/carrierPortalService';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function CarrierPortalScreen() {
  const { data, loading, refreshData } = useData() as any;
  const [activeCarrier, setActiveCarrier] = useState<string>(DEFAULT_PORTAL_CARRIER);
  const [respondingShipment, setRespondingShipment] = useState<any | null>(null);

  /**
   * Carrier chips: dedupe across the carriers master + names that appear
   * on shipments so a brand-new shipment row's carrier is selectable
   * even if the master entry is missing.
   */
  const carrierOptions = useMemo<string[]>(() => {
    const fromMaster: string[] = (data.carriers || [])
      .map((c: any) => (typeof c === 'string' ? c : c?.name))
      .filter(Boolean);
    const fromShipments = getUniqueCarrierNames(data.shipments || []);
    const seen = new Map<string, string>();
    [...fromMaster, ...fromShipments].forEach((n) => {
      const key = String(n || '').toLowerCase().trim();
      if (key && !seen.has(key)) seen.set(key, n);
    });
    const list = [...seen.values()];
    if (!list.includes(DEFAULT_PORTAL_CARRIER)) list.unshift(DEFAULT_PORTAL_CARRIER);
    return list.sort((a, b) => a.localeCompare(b));
  }, [data.carriers, data.shipments]);

  const tenders = useMemo(
    () => pickActiveTenders(data.shipments || [], activeCarrier),
    [data.shipments, activeCarrier],
  );

  const responses = useMemo(
    () => buildPersistedTenderResponses(tenders),
    [tenders],
  );

  const stats = useMemo(() => {
    let pending = 0;
    let accepted = 0;
    let rejected = 0;
    for (const s of tenders) {
      const eff = effectiveShipmentStatus(s);
      if (eff === 'Tender Accepted') accepted++;
      else if (eff === 'Tender Rejected') rejected++;
      else pending++;
    }
    return { pending, accepted, rejected, total: tenders.length };
  }, [tenders]);

  const handleResponded = useCallback(async () => {
    await refreshData?.();
  }, [refreshData]);

  // Resolve the order rows linked to a shipment (for the accept-cascade).
  const resolveOrders = useCallback(
    (shipment: any): any[] => {
      const ids: string[] = Array.isArray(shipment?.order_ids) ? shipment.order_ids : [];
      if (ids.length === 0) return [];
      const orderById = new Map<string, any>();
      for (const o of (data.orders || [])) {
        const id = o.id || o.order_id;
        if (id) orderById.set(String(id), o);
      }
      return ids.map((id) => orderById.get(String(id))).filter(Boolean);
    },
    [data.orders],
  );

  const renderTender = useCallback(
    ({ item }: { item: any }) => {
      const eff = effectiveShipmentStatus(item);
      const responded = responses[item.id];
      const isPending = eff === 'Tendered' && !responded;
      return (
        <Card style={styles.tenderCard}>
          <View style={styles.tenderHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tenderId} numberOfLines={1}>{item.id}</Text>
              <Text style={styles.tenderCarrier} numberOfLines={1}>
                {item.carrier || activeCarrier}
              </Text>
            </View>
            <StatusBadge status={eff} />
          </View>

          <View style={styles.tenderRoute}>
            <Ionicons name="location-outline" size={14} color={colors.text3} />
            <Text style={styles.tenderText} numberOfLines={1}>{item.origin || '?'}</Text>
            <Ionicons name="arrow-forward" size={12} color={colors.text3} />
            <Text style={styles.tenderText} numberOfLines={1}>{item.dest || '?'}</Text>
          </View>

          <View style={styles.tenderMeta}>
            <Meta label="Mode" value={item.mode || '--'} />
            <Meta
              label="Pickup"
              value={item.pickup_date || item.pickupDate || '--'}
            />
            <Meta
              label="Weight"
              value={item.weight ? `${Number(item.weight).toLocaleString()} lb` : '--'}
            />
          </View>

          {responded ? (
            <View style={styles.respondedRow}>
              <Ionicons
                name={responded.action === 'accept' ? 'checkmark-circle' : 'close-circle'}
                size={14}
                color={responded.action === 'accept' ? colors.green : colors.red}
              />
              <Text style={styles.respondedText}>
                {responded.action === 'accept' ? 'Accepted' : 'Rejected'}
                {responded.respondedAt ? ` · ${responded.respondedAt}` : ''}
                {responded.proNumber ? ` · PRO ${responded.proNumber}` : ''}
                {responded.rejectReason ? ` · ${responded.rejectReason}` : ''}
              </Text>
            </View>
          ) : null}

          {isPending ? (
            <View style={styles.respondRow}>
              <TouchableOpacity
                style={[styles.respondBtn, styles.respondBtnPrimary]}
                onPress={() => setRespondingShipment(item)}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark" size={16} color={colors.white} />
                <Text style={styles.respondBtnText}>Respond</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </Card>
      );
    },
    [responses, activeCarrier],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Ionicons name="swap-horizontal-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Carrier Portal</Text>
        </View>
        <Text style={styles.subtitle}>
          Tenders waiting on a response from the active carrier.
          Pick the carrier below; accept or reject each tender to update the planner.
        </Text>

        {/* Active carrier picker */}
        <Text style={styles.sectionLabel}>ACTIVE CARRIER</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carrierRow}
          style={styles.carrierScroll}
        >
          {carrierOptions.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.carrierChip, activeCarrier === c && styles.carrierChipActive]}
              onPress={() => setActiveCarrier(c)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.carrierChipText,
                activeCarrier === c && styles.carrierChipTextActive,
              ]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Stats — 2x2 grid on narrow phones (QA #280). */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiCell}>
            <KpiCard label="Total" value={String(stats.total)} icon="list-outline" color={colors.accent} />
          </View>
          <View style={styles.kpiCell}>
            <KpiCard label="Pending" value={String(stats.pending)} icon="time-outline" color={colors.yellow} />
          </View>
          <View style={styles.kpiCell}>
            <KpiCard label="Accepted" value={String(stats.accepted)} icon="checkmark-circle-outline" color={colors.green} />
          </View>
          <View style={styles.kpiCell}>
            <KpiCard label="Rejected" value={String(stats.rejected)} icon="close-circle-outline" color={colors.red} />
          </View>
        </View>

        {/* Tender list */}
        <FlatList
          data={tenders}
          renderItem={renderTender}
          keyExtractor={(item: any) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={!!loading}
              onRefresh={refreshData}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            loading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : (
              <EmptyState
                icon="mail-open-outline"
                title="No tenders"
                subtitle={`No active tenders for ${activeCarrier} right now.`}
              />
            )
          }
        />

        <TenderRespondModal
          visible={!!respondingShipment}
          shipment={respondingShipment}
          orders={respondingShipment ? resolveOrders(respondingShipment) : []}
          onClose={() => setRespondingShipment(null)}
          onResponded={handleResponded}
        />
      </View>
    </SafeAreaView>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaCol}>
      <Text style={styles.metaLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  carrierScroll: { flexGrow: 0, marginBottom: spacing.md },
  carrierRow: {
    paddingHorizontal: spacing.lg,
    // QA #280 — extra right padding stops the last carrier chip from
    // looking clipped on narrow phones.
    paddingRight: spacing.xl,
    gap: spacing.sm,
  },
  carrierChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  carrierChipActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  carrierChipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  carrierChipTextActive: { color: colors.white },
  kpiRow: {
    flexDirection: 'row',
    // QA #280 — let the 4 KPI cards wrap to 2x2 on narrow phones
    // instead of cramming them into a single row where each cell is
    // ~80px wide. Web has horizontal space to spare; mobile does not.
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  kpiCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['5xl'],
    flexGrow: 1,
  },
  loadingWrap: { padding: spacing.xl, alignItems: 'center' },
  tenderCard: { marginBottom: spacing.sm },
  tenderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tenderId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  tenderCarrier: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    marginTop: 2,
  },
  tenderRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tenderText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
    flexShrink: 1,
  },
  tenderMeta: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  metaCol: {},
  metaLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  respondedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  respondedText: {
    fontSize: fontSize.xs,
    color: colors.text2,
    flex: 1,
  },
  respondRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  respondBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  respondBtnPrimary: { backgroundColor: colors.accent },
  respondBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
});
