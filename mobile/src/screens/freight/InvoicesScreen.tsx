import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import useInvoices from '../../shared/hooks/useInvoices';
import { ensureUiInvoice } from '../../shared/services/invoiceService';
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
import { exportRowsAsCsv } from '../../services/csvExport';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

const INVOICE_STATUSES = ['All', 'Pending', 'Approved', 'Disputed'];

export default function InvoicesScreen() {
  const { data, loading, refreshData } = useData();
  const uiInvoices = useMemo(
    () => (data.invoices || []).map(ensureUiInvoice).filter(Boolean),
    [data.invoices],
  );
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
  } = useInvoices(uiInvoices);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const idOf = useCallback(
    (inv: any) => String(inv.id || inv.invoice_id || inv.num || ''),
    [],
  );

  const handleApprove = useCallback((inv: any) => {
    Alert.alert('Approve Invoice', 'Approve ' + (inv.num || idOf(inv)) + '?', [
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
  }, [refreshData, idOf]);

  const handleDispute = useCallback((inv: any) => {
    Alert.alert('Dispute Invoice', 'Mark ' + (inv.num || idOf(inv)) + ' as disputed?', [
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
  }, [refreshData, idOf]);

  const handleDelete = useCallback((inv: any) => {
    Alert.alert(
      'Delete Invoice',
      'Permanently delete ' + (inv.num || idOf(inv)) + '? This cannot be undone.',
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
  }, [refreshData, idOf]);

  const activeStatus = statusFilter === '' ? 'All' : statusFilter;

  const handleStatusSelect = useCallback((status: string) => {
    setStatusFilter(status === 'All' ? '' : status);
  }, [setStatusFilter]);

  const renderItem = useCallback(({ item }: { item: any }) => {
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
                ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : 'N/A'}
            </Text>
          </View>
        </View>
        <View style={styles.invoiceActions}>
          {item.status === 'Pending' && (
            <>
              <TouchableOpacity
                style={[styles.rowActionBtn, styles.rowActionBtnApprove, rowBusy && styles.rowActionBtnBusy]}
                activeOpacity={0.7}
                onPress={() => handleApprove(item)}
                disabled={rowBusy}
              >
                <Ionicons name="checkmark" size={16} color={colors.green} />
                <Text style={[styles.rowActionBtnText, { color: colors.green }]}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rowActionBtn, styles.rowActionBtnDispute, rowBusy && styles.rowActionBtnBusy]}
                activeOpacity={0.7}
                onPress={() => handleDispute(item)}
                disabled={rowBusy}
              >
                <Ionicons name="close" size={16} color={colors.red} />
                <Text style={[styles.rowActionBtnText, { color: colors.red }]}>Dispute</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity
            style={[styles.rowActionBtn, styles.rowActionBtnEdit, rowBusy && styles.rowActionBtnBusy]}
            activeOpacity={0.7}
            onPress={() => setEditingInvoice(item)}
            disabled={rowBusy}
          >
            <Ionicons name="create-outline" size={16} color={colors.accent} />
            <Text style={[styles.rowActionBtnText, { color: colors.accent }]}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.rowActionBtn, styles.rowActionBtnDelete, rowBusy && styles.rowActionBtnBusy]}
            activeOpacity={0.7}
            onPress={() => handleDelete(item)}
            disabled={rowBusy}
          >
            <Ionicons name="trash-outline" size={16} color={colors.red} />
            <Text style={[styles.rowActionBtnText, { color: colors.red }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </Card>
    );
  }, [busyId, idOf, handleApprove, handleDispute, handleDelete]);

  const keyExtractor = useCallback(
    (item: any) => (item.num || item.id || '').toString(),
    [],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Freight Invoices</Text>
            <Text style={styles.count}>
              {filtered.length} invoice{filtered.length !== 1 ? 's' : ''}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                'Import Invoices',
                'Invoice OCR + CSV import is currently web-only. Use the Zoree web app to bulk-import; results will appear here on the next refresh.',
              )
            }
            style={[styles.toolbarBtn, { marginRight: spacing.sm }]}
            accessibilityRole="button">
            <Ionicons name="cloud-upload-outline" size={16} color={colors.accent} />
            <Text style={styles.toolbarText}>Import</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              exportRowsAsCsv(
                filtered,
                [
                  { key: 'num',     header: 'Invoice #' },
                  { key: 'carrier', header: 'Carrier' },
                  { key: 'shipId',  header: 'Shipment' },
                  { key: 'amount',  header: 'Amount' },
                  { key: 'agreed',  header: 'Agreed' },
                  { key: 'status',  header: 'Status' },
                  { key: 'date',    header: 'Date' },
                ],
                { title: 'Freight Invoices', filename: 'invoices.csv' },
              )
            }
            style={styles.toolbarBtn}
            accessibilityRole="button"
            accessibilityLabel="Export invoices as CSV">
            <Ionicons name="download-outline" size={16} color={colors.accent} />
            <Text style={styles.toolbarText}>Export</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <KpiCard label="Total" value={data.invoices.length} icon="document-text-outline" color={colors.accent} />
          </View>
          <View style={styles.statItem}>
            <KpiCard label="Pending" value={formatCurrency(stats.pendingTotal)} icon="time-outline" color={colors.yellow} subtitle={stats.pendingCount + ' invoices'} />
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <KpiCard label="Approved" value={formatCurrency(stats.approvedTotal)} icon="checkmark-circle-outline" color={colors.green} subtitle={stats.approvedCount + ' invoices'} />
          </View>
          <View style={styles.statItem}>
            <KpiCard label="Disputed" value={formatCurrency(stats.disputedTotal)} icon="alert-circle-outline" color={colors.red} subtitle={stats.disputedCount + ' invoices'} />
          </View>
        </View>

        <View style={styles.searchContainer}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search invoices..." />
        </View>

        <StatusFilter statuses={INVOICE_STATUSES} active={activeStatus} onSelect={handleStatusSelect} />

        {carriers && carriers.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carrierRow}
            style={styles.carrierScroll}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setCarrierFilter('')}
              style={[styles.carrierChip, !carrierFilter && styles.carrierChipActive]}>
              <Text style={[styles.carrierLabel, !carrierFilter && styles.carrierLabelActive]}>All Carriers</Text>
            </TouchableOpacity>
            {carriers.map((c: string) => (
              <TouchableOpacity
                key={'car-' + c}
                activeOpacity={0.7}
                onPress={() => setCarrierFilter(c)}
                style={[styles.carrierChip, carrierFilter === c && styles.carrierChipActive]}>
                <Text style={[styles.carrierLabel, carrierFilter === c && styles.carrierLabelActive]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshData} tintColor={colors.accent} colors={[colors.accent]} />}
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title="No invoices found"
              subtitle={search || statusFilter ? 'Try adjusting your search or filter.' : 'Invoices will appear here.'}
            />
          }
        />

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
          onSaved={async () => { await refreshData(); }}
        />
        <InvoiceFormModal
          visible={!!editingInvoice}
          invoice={editingInvoice}
          onClose={() => setEditingInvoice(null)}
          carriers={data.carriers as any}
          shipments={data.shipments as any}
          onSaved={async () => { await refreshData(); }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  toolbarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  toolbarText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.accent },
  carrierScroll: { flexGrow: 0, marginBottom: spacing.sm },
  carrierRow: {
    paddingHorizontal: spacing.lg,
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
  carrierChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  carrierLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.text2 },
  carrierLabelActive: { color: colors.white },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  count: { fontSize: fontSize.sm, fontWeight: fontWeight.regular, color: colors.text2, marginTop: spacing.xs },
  statsRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.md, marginTop: spacing.sm },
  statItem: { flex: 1 },
  searchContainer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  listContent: { paddingTop: spacing.xs, paddingBottom: spacing['5xl'] },
  emptyContainer: { flexGrow: 1 },
  invoiceCard: { marginHorizontal: spacing.lg, marginBottom: spacing.sm },
  invoiceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  invoiceInfo: { flex: 1, marginRight: spacing.md },
  invoiceNum: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  invoiceCarrier: { fontSize: fontSize.sm, fontWeight: fontWeight.regular, color: colors.text2, marginTop: spacing.xs },
  invoiceDetails: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.xl },
  detailCol: {},
  detailLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.text3, textTransform: 'uppercase', marginBottom: spacing.xs },
  detailValue: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  invoiceActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.bg3,
  },
  rowActionBtn: {
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
  rowActionBtnApprove: { borderColor: colors.greenDim, backgroundColor: colors.greenDim },
  rowActionBtnDispute: { borderColor: colors.redDim, backgroundColor: colors.redDim },
  rowActionBtnEdit:    { borderColor: colors.accentGlow, backgroundColor: colors.accentGlow },
  rowActionBtnDelete:  { borderColor: colors.redDim, backgroundColor: 'transparent' },
  rowActionBtnBusy: { opacity: 0.5 },
  rowActionBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
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
