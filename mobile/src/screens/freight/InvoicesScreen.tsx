import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  Alert,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import useInvoices from '../../shared/hooks/useInvoices';
import { formatCurrency } from '../../shared/utils/formatters';
import {
  approveInvoice,
  deleteInvoice,
  disputeInvoice,
} from '../../services/invoiceService';
import KpiCard from '../../components/ui/KpiCard';
import Card from '../../components/ui/Card';
import SearchBar from '../../components/ui/SearchBar';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import StatusFilter from '../../components/common/StatusFilter';
import InvoiceFormModal from '../../components/invoices/InvoiceFormModal';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const INVOICE_STATUSES = ['All', 'Pending', 'Approved', 'Disputed'];

export default function InvoicesScreen() {
  const { data, loading, refreshData } = useData();
  const {
    filtered,
    stats,
    carriers,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    carrierFilter,
    setCarrierFilter,
  } = useInvoices(data.invoices);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  /** Resolve a stable id we can pass to the API + use for busy tracking. */
  const idOf = useCallback(
    (inv: any) => String(inv.id || inv.invoice_id || inv.num || ''),
    [],
  );

  const handleApprove = useCallback(
    (inv: any) => {
      Alert.alert('Approve Invoice', `Approve ${inv.num || idOf(inv)}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setBusyId(idOf(inv));
            try {
              await approveInvoice(inv);
              await refreshData();
            } catch (e: any) {
              Alert.alert('Approve failed', e?.message || 'Could not approve invoice');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [refreshData, idOf],
  );

  const handleDispute = useCallback(
    (inv: any) => {
      Alert.alert('Dispute Invoice', `Mark ${inv.num || idOf(inv)} as disputed?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dispute',
          style: 'destructive',
          onPress: async () => {
            setBusyId(idOf(inv));
            try {
              await disputeInvoice(inv);
              await refreshData();
            } catch (e: any) {
              Alert.alert('Dispute failed', e?.message || 'Could not dispute invoice');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [refreshData, idOf],
  );

  const handleDelete = useCallback(
    (inv: any) => {
      Alert.alert(
        'Delete Invoice',
        `Permanently delete ${inv.num || idOf(inv)}? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setBusyId(idOf(inv));
              try {
                await deleteInvoice(inv);
                await refreshData();
              } catch (e: any) {
                Alert.alert('Delete failed', e?.message || 'Could not delete invoice');
              } finally {
                setBusyId(null);
              }
            },
          },
        ],
      );
    },
    [refreshData, idOf],
  );

  const activeStatus =
    statusFilter === '' ? 'All' : statusFilter;

  const handleStatusSelect = useCallback(
    (status: string) => {
      setStatusFilter(status === 'All' ? '' : status);
    },
    [setStatusFilter],
  );

  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      const rowBusy = busyId === idOf(item);
      return (
        <Card style={styles.invoiceCard}>
          <View style={styles.invoiceHeader}>
            <View style={styles.invoiceInfo}>
              <Text style={styles.invoiceNum}>{item.num || item.id}</Text>
              <Text style={styles.invoiceCarrier} numberOfLines={1}>
                {item.carrier || 'Unknown Carrier'}
              </Text>
            </View>
            <StatusBadge status={item.status || 'Pending'} />
          </View>

          <View style={styles.invoiceDetails}>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Amount</Text>
              <Text style={styles.detailValue}>
                ${(item.amount || 0).toLocaleString()}
              </Text>
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>Date</Text>
              <Text style={styles.detailValue}>
                {item.date
                  ? new Date(item.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'N/A'}
              </Text>
            </View>
            {item.variance !== undefined && item.variance !== 0 && (
              <View style={styles.detailCol}>
                <Text style={styles.detailLabel}>Variance</Text>
                <Text
                  style={[
                    styles.detailValue,
                    {
                      color: item.variance > 0 ? colors.red : colors.green,
                    },
                  ]}
                >
                  {item.variance > 0 ? '+' : ''}${item.variance.toLocaleString()}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.invoiceActions}>
            {item.status === 'Pending' && (
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnApprove, rowBusy && styles.actionBtnBusy]}
                  activeOpacity={0.7}
                  onPress={() => handleApprove(item)}
                  disabled={rowBusy}
                >
                  <Ionicons name="checkmark" size={16} color={colors.green} />
                  <Text style={[styles.actionBtnText, { color: colors.green }]}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnDispute, rowBusy && styles.actionBtnBusy]}
                  activeOpacity={0.7}
                  onPress={() => handleDispute(item)}
                  disabled={rowBusy}
                >
                  <Ionicons name="close" size={16} color={colors.red} />
                  <Text style={[styles.actionBtnText, { color: colors.red }]}>Dispute</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnEdit, rowBusy && styles.actionBtnBusy]}
              activeOpacity={0.7}
              onPress={() => setEditingInvoice(item)}
              disabled={rowBusy}
            >
              <Ionicons name="create-outline" size={16} color={colors.accent} />
              <Text style={[styles.actionBtnText, { color: colors.accent }]}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDelete, rowBusy && styles.actionBtnBusy]}
              activeOpacity={0.7}
              onPress={() => handleDelete(item)}
              disabled={rowBusy}
            >
              <Ionicons name="trash-outline" size={16} color={colors.red} />
              <Text style={[styles.actionBtnText, { color: colors.red }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </Card>
      );
    },
    [busyId, idOf, handleApprove, handleDispute, handleDelete],
  );

  const keyExtractor = useCallback(
    (item: any) => (item.num || item.id || '').toString(),
    [],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Freight Invoices</Text>
          <Text style={styles.count}>
            {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <KpiCard
              label="Total"
              value={data.invoices.length}
              icon="document-text-outline"
              color={colors.accent}
            />
          </View>
          <View style={styles.statItem}>
            <KpiCard
              label="Pending"
              value={formatCurrency(stats.pendingTotal)}
              icon="time-outline"
              color={colors.yellow}
              subtitle={`${stats.pendingCount} invoices`}
            />
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <KpiCard
              label="Approved"
              value={formatCurrency(stats.approvedTotal)}
              icon="checkmark-circle-outline"
              color={colors.green}
              subtitle={`${stats.approvedCount} invoices`}
            />
          </View>
          <View style={styles.statItem}>
            <KpiCard
              label="Disputed"
              value={formatCurrency(stats.disputedTotal)}
              icon="alert-circle-outline"
              color={colors.red}
              subtitle={`${stats.disputedCount} invoices`}
            />
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search invoices..."
          />
        </View>

        {/* Status Filter */}
        <StatusFilter
          statuses={INVOICE_STATUSES}
          active={activeStatus}
          onSelect={handleStatusSelect}
        />

        {/* Invoice List */}
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={
            filtered.length === 0 ? styles.emptyContainer : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={refreshData}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title="No invoices found"
              subtitle={
                search || statusFilter
                  ? 'Try adjusting your search or filter.'
                  : 'Invoices will appear here.'
              }
            />
          }
        />

        {/* New-invoice FAB. */}
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
          onPress={() => setCreating(true)}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </TouchableOpacity>

        <InvoiceFormModal
          visible={creating}
          onClose={() => setCreating(false)}
          carriers={data.carriers as any}
          shipments={data.shipments as any}
          onSaved={async () => {
            await refreshData();
          }}
        />
        <InvoiceFormModal
          visible={!!editingInvoice}
          invoice={editingInvoice}
          onClose={() => setEditingInvoice(null)}
          carriers={data.carriers as any}
          shipments={data.shipments as any}
          onSaved={async () => {
            await refreshData();
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  count: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  statItem: {
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingTop: spacing.xs,
    paddingBottom: spacing['5xl'],
  },
  emptyContainer: {
    flexGrow: 1,
  },
  invoiceCard: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  invoiceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  invoiceInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  invoiceNum: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  invoiceCarrier: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  invoiceDetails: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.xl,
  },
  detailCol: {},
  detailLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  detailValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  invoiceActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.bg3,
  },
  actionBtn: {
    flex: 1,
    minWidth: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  actionBtnApprove: {
    borderColor: colors.greenDim,
    backgroundColor: colors.greenDim,
  },
  actionBtnDispute: {
    borderColor: colors.redDim,
    backgroundColor: colors.redDim,
  },
  actionBtnEdit: {
    borderColor: colors.accentGlow,
    backgroundColor: colors.accentGlow,
  },
  actionBtnDelete: {
    borderColor: colors.redDim,
    backgroundColor: 'transparent',
  },
  actionBtnBusy: {
    opacity: 0.5,
  },
  actionBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing['3xl'],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
