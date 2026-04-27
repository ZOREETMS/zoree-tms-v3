import React, { useMemo } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import StatusBadge from '../../components/ui/StatusBadge';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import { useData } from '../../state/DataContext';
// Local hook copy lives in the mobile tree; the workspace `shared/`
// folder also has one for the web app — they're identical, but the
// in-tree path is what Metro resolves without a custom alias.
import useCustomerPortal from '../../shared/hooks/useCustomerPortal';
import InviteCustomerModal from '../../components/customer/InviteCustomerModal';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function CustomerPortalScreen() {
  const { data } = useData();

  const {
    stats,
    customerList,
    visibilityRows,
    search,
    setSearch,
    handleShareTracking,
    handleShareCustomer,
    inviteModalOpen,
    setInviteModalOpen,
    handleInvite,
  } = useCustomerPortal(data.shipments, data.orders);

  const filteredCustomers = useMemo(() => {
    if (!search.trim()) return customerList;
    const q = search.toLowerCase();
    return customerList.filter(
      (c: any) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q),
    );
  }, [customerList, search]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Customer Portal</Text>
          <TouchableOpacity
            style={styles.inviteButton}
            activeOpacity={0.7}
            onPress={() => setInviteModalOpen(true)}>
            <Ionicons name="person-add-outline" size={16} color={colors.white} />
            <Text style={styles.inviteButtonText}>Invite Customer</Text>
          </TouchableOpacity>
        </View>

        {/* Portal Stats */}
        <View style={styles.kpiRow}>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Active Shipments"
              value={stats.activeShipments ?? 0}
              icon="cube-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Customers with Access"
              value={stats.customersWithAccess ?? 0}
              icon="people-outline"
              color={colors.green}
            />
          </View>
          <View style={styles.kpiItem}>
            <KpiCard
              label="Tracking Links Shared"
              value={stats.trackingLinksShared ?? 0}
              icon="link-outline"
              color={colors.purple}
            />
          </View>
        </View>

        {/* Search */}
        <View style={styles.section}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search customers..."
          />
        </View>

        {/* Customer Access List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Customer Access</Text>
          {filteredCustomers.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="No customers found"
              subtitle="Invite customers to give them portal access."
            />
          ) : (
            filteredCustomers.map((customer: any, index: number) => (
              <Card
                key={customer.id || customer.name || index}
                style={styles.customerCard}>
                <View style={styles.customerRow}>
                  <View style={styles.customerAvatar}>
                    <Ionicons
                      name="business-outline"
                      size={20}
                      color={colors.accent}
                    />
                  </View>
                  <View style={styles.customerInfo}>
                    <Text style={styles.customerName} numberOfLines={1}>
                      {customer.company || customer.name || 'Unknown'}
                    </Text>
                    <Text style={styles.customerMeta}>
                      {customer.shipmentCount ?? 0} shipment
                      {(customer.shipmentCount ?? 0) !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <StatusBadge
                    status={customer.status || 'Active'}
                  />
                </View>
                <View style={styles.customerActions}>
                  <TouchableOpacity
                    style={styles.actionButton}
                    activeOpacity={0.7}
                    onPress={() =>
                      handleShareCustomer(customer.company || customer.name)
                    }>
                    <Ionicons
                      name="share-outline"
                      size={14}
                      color={colors.accent}
                    />
                    <Text style={styles.actionButtonText}>
                      Share Tracking Link
                    </Text>
                  </TouchableOpacity>
                </View>
              </Card>
            ))
          )}
        </View>

        {/* Visibility Management */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Visibility Management</Text>
          <Text style={styles.sectionSubtitle}>
            Control what customers can see for each shipment.
          </Text>
          {visibilityRows.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>
                No shipments require visibility configuration.
              </Text>
            </Card>
          ) : (
            visibilityRows.slice(0, 10).map((row: any, index: number) => (
              <Card key={row.id || index} style={styles.visibilityCard}>
                <View style={styles.visibilityHeader}>
                  <Text style={styles.visibilityId}>{row.id}</Text>
                  <StatusBadge status={row.status || 'Active'} />
                </View>
                <View style={styles.visibilityMeta}>
                  <View style={styles.visibilityRoute}>
                    <Ionicons
                      name="location-outline"
                      size={14}
                      color={colors.text3}
                    />
                    <Text style={styles.visibilityRouteText} numberOfLines={1}>
                      {row.originShort || 'Origin'} → {row.destShort || 'Dest'}
                    </Text>
                  </View>
                  <Text style={styles.visibilityCustomer}>
                    {row.customer || 'N/A'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.actionButton}
                  activeOpacity={0.7}
                  onPress={() =>
                    handleShareTracking(row.id, row.customer)
                  }>
                  <Ionicons name="eye-outline" size={14} color={colors.accent} />
                  <Text style={styles.actionButtonText}>Share Tracking</Text>
                </TouchableOpacity>
              </Card>
            ))
          )}
        </View>
      </ScrollView>

      <InviteCustomerModal
        visible={!!inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        onSubmit={async (invite) => {
          await handleInvite(invite);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['5xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  inviteButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  kpiRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  kpiItem: {
    flex: 1,
  },
  section: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sectionSubtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginBottom: spacing.md,
  },
  customerCard: {
    marginBottom: spacing.sm,
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customerAvatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accentGlow,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  customerInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  customerName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  customerMeta: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: 2,
  },
  customerActions: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.accentGlow,
  },
  actionButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
  visibilityCard: {
    marginBottom: spacing.sm,
  },
  visibilityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  visibilityId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  visibilityMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  visibilityRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  visibilityRouteText: {
    fontSize: fontSize.sm,
    color: colors.text2,
    flex: 1,
  },
  visibilityCustomer: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
    marginLeft: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.text2,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
