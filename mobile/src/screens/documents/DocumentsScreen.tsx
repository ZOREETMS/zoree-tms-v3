import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  Share,
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
import EmptyState from '../../components/ui/EmptyState';
import DocumentViewerModal from '../../components/documents/DocumentViewerModal';
import GenerateDocumentModal from '../../components/documents/GenerateDocumentModal';
import FilterDropdown from '../../components/common/FilterDropdown';
import {
  computeDocStats,
  fetchDocuments,
} from '../../services/documentService';
import { useData } from '../../state/DataContext';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

// Seed data from shared document service
const SEED_DOCUMENTS = [
  { id: 'BOL-2024-1840', type: 'BOL', ship: 'SHP-2024-1840', carrier: 'Swift Transport', generated: '2026-02-28', status: 'Signed' },
  { id: 'POD-2024-1840', type: 'POD', ship: 'SHP-2024-1840', carrier: 'Swift Transport', generated: '2026-03-03', status: 'Received' },
  { id: 'BOL-2024-1841', type: 'BOL', ship: 'SHP-2024-1841', carrier: 'Old Dominion', generated: '2026-03-01', status: 'Signed' },
  { id: 'BOL-2024-1844', type: 'BOL', ship: 'SHP-2024-1844', carrier: 'Werner Enterprises', generated: '2026-03-02', status: 'Pending' },
  { id: 'POD-2024-1841', type: 'POD', ship: 'SHP-2024-1841', carrier: 'Old Dominion', generated: '2026-03-04', status: 'Received' },
  { id: 'BOL-2024-1845', type: 'BOL', ship: 'SHP-2024-1845', carrier: 'Schneider National', generated: '2026-03-03', status: 'Signed' },
  { id: 'BOL-2024-1848', type: 'BOL', ship: 'SHP-2024-1848', carrier: 'XPO Logistics', generated: '2026-03-04', status: 'Signed' },
  { id: 'HZM-2024-1851', type: 'Hazmat', ship: 'SHP-2024-1851', carrier: 'JB Hunt', generated: '2026-03-05', status: 'Filed' },
  { id: 'INV-COM-1840', type: 'Invoice', ship: 'SHP-2024-1840', carrier: 'Swift Transport', generated: '2026-03-03', status: 'Sent' },
  { id: 'BOL-2024-1849', type: 'BOL', ship: 'SHP-2024-1849', carrier: 'Swift Transport', generated: '2026-03-05', status: 'Pending' },
  { id: 'BOL-2024-1843', type: 'BOL', ship: 'SHP-2024-1843', carrier: 'FedEx Freight', generated: '2026-03-01', status: 'Signed' },
  { id: 'POD-2024-1843', type: 'POD', ship: 'SHP-2024-1843', carrier: 'FedEx Freight', generated: '2026-03-04', status: 'Received' },
];

const TYPE_FILTERS = ['All', 'BOL', 'POD', 'Invoice', 'Hazmat'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

const DOC_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  BOL: 'document-text-outline',
  POD: 'receipt-outline',
  Invoice: 'cash-outline',
  Hazmat: 'warning-outline',
};

export default function DocumentsScreen() {
  const { data } = useData();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [generating, setGenerating] = useState(false);

  /**
   * Fetch documents from the backend. Falls back to seeds when the
   * table is empty so the screen still demos cleanly on a fresh tenant.
   */
  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchDocuments();
      setDocs(rows.length > 0 ? rows : SEED_DOCUMENTS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  const filtered = useMemo(() => {
    if (typeFilter === 'All') return docs;
    return docs.filter((d) => d.type === typeFilter);
  }, [typeFilter, docs]);

  const stats = useMemo(() => {
    const s = computeDocStats(docs);
    return {
      total: s.total,
      bols: s.bolsGenerated,
      pods: s.podsReceived,
      pending: docs.filter((d) => d.status === 'Pending').length,
    };
  }, [docs]);

  const docsBackedByApi = docs !== SEED_DOCUMENTS;

  // QA #327 — Send action surfaces the document metadata through the
  // OS share sheet so users can email/forward a BOL ref to a carrier
  // or customer without leaving the screen. Full PDF attachment lives
  // in DocumentViewerModal; this fast-path covers the common "send the
  // BOL number to the driver" use case.
  const onSend = useCallback((doc: any) => {
    const body = [
      `Document: ${doc.id}`,
      `Type: ${doc.type}`,
      `Shipment: ${doc.ship}`,
      `Carrier: ${doc.carrier}`,
      `Status: ${doc.status}`,
      `Date: ${doc.generated}`,
    ].join('\n');
    Share.share({ title: doc.id, message: body, subject: doc.id });
  }, []);

  const renderDocument = useCallback(
    ({ item }: { item: any }) => (
      <Card style={styles.docCard}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => docsBackedByApi && setViewing(item)}
          // Only seeded rows can't be opened — they don't have backing
          // DB data so status updates / deletes would fail.
          disabled={!docsBackedByApi}
        >
          <View style={styles.docHeader}>
            <View style={styles.docTitleRow}>
              <Ionicons
                name={DOC_TYPE_ICONS[item.type] || 'document-outline'}
                size={18}
                color={colors.accent}
              />
              <Text style={styles.docId}>{item.id}</Text>
            </View>
            <StatusBadge status={item.status} />
          </View>
          <View style={styles.docDetails}>
            <View style={styles.docDetailRow}>
              <Text style={styles.docLabel}>Type</Text>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{item.type}</Text>
              </View>
            </View>
            <View style={styles.docDetailRow}>
              <Text style={styles.docLabel}>Shipment</Text>
              <Text style={styles.docValue}>{item.ship}</Text>
            </View>
            <View style={styles.docDetailRow}>
              <Text style={styles.docLabel}>Carrier</Text>
              <Text style={styles.docValue}>{item.carrier}</Text>
            </View>
            <View style={styles.docDetailRow}>
              <Text style={styles.docLabel}>Date</Text>
              <Text style={styles.docValue}>{item.generated}</Text>
            </View>
          </View>
        </TouchableOpacity>
        {/* QA #327 — explicit View + Send actions (web parity). View
            opens the existing DocumentViewerModal where users can edit
            status / metadata; Send opens the OS share sheet so they
            can forward the document reference to a carrier or driver. */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnView]}
            activeOpacity={0.7}
            onPress={() => docsBackedByApi && setViewing(item)}
            disabled={!docsBackedByApi}
          >
            <Ionicons name="eye-outline" size={14} color={docsBackedByApi ? colors.accent : colors.text3} />
            <Text style={[styles.actionBtnText, { color: docsBackedByApi ? colors.accent : colors.text3 }]}>View</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnSend]}
            activeOpacity={0.7}
            onPress={() => onSend(item)}
          >
            <Ionicons name="paper-plane-outline" size={14} color={colors.white} />
            <Text style={[styles.actionBtnText, { color: colors.white }]}>Send</Text>
          </TouchableOpacity>
        </View>
      </Card>
    ),
    [docsBackedByApi, onSend],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Header — QA #289 renames the page title to "Documents & BOL"
            to align with the drawer label and the web sidebar.
            QA #327 adds the descriptive subtitle so the page reads the
            same as the web page banner. */}
        <View style={styles.header}>
          <Ionicons name="folder-open-outline" size={24} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Documents &amp; BOL</Text>
            <Text style={styles.subtitle}>
              BOLs, PODs, invoices and hazmat filings for every shipment
            </Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{filtered.length}</Text>
          </View>
        </View>

        {/* Stats cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kpiRow}
          style={styles.kpiScroll}
        >
          <KpiCard label="Total Documents" value={stats.total} icon="documents-outline" color={colors.accent} />
          <KpiCard label="BOLs Generated" value={stats.bols} icon="document-text-outline" color={colors.green} />
          <KpiCard label="PODs Received" value={stats.pods} icon="receipt-outline" color={colors.cyan} />
          <KpiCard label="Pending" value={stats.pending} icon="time-outline" color={colors.yellow} />
        </ScrollView>

        {/* Generate document button — opens picker for type + shipment. */}
        <TouchableOpacity
          style={styles.generateButton}
          activeOpacity={0.7}
          onPress={() => setGenerating(true)}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.white} />
          <Text style={styles.generateButtonText}>Generate Document</Text>
        </TouchableOpacity>

        {/* QA #327 — type filter is now a dropdown so the active option
            stays visible on narrow phones instead of scrolling out of
            the chip row. */}
        <FilterDropdown
          label="Filter by Type"
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as TypeFilter)}
          options={TYPE_FILTERS as unknown as string[]}
          modalTitle="Filter Documents by Type"
        />

        {/* Document list */}
        <FlatList
          data={filtered}
          renderItem={renderDocument}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={loadDocs}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-outline"
              title="No documents found"
              subtitle="Try adjusting the type filter."
            />
          }
        />

        <DocumentViewerModal
          visible={!!viewing}
          document={viewing}
          onClose={() => setViewing(null)}
          onChanged={loadDocs}
        />
        <GenerateDocumentModal
          visible={generating}
          shipments={data.shipments as any}
          onClose={() => setGenerating(false)}
          onCreated={loadDocs}
        />
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
  },
  countBadge: {
    backgroundColor: colors.accentGlow,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  countText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  kpiScroll: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  kpiRow: {
    paddingHorizontal: spacing.lg,
    // QA #289 — extra right padding so the last KPI card / chip
    // isn't visually clipped at the edge of horizontal scrollers.
    paddingRight: spacing.xl,
    gap: spacing.md,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accent,
  },
  generateButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  chipScroll: { flexGrow: 0, marginBottom: spacing.sm },
  chipRow: {
    paddingHorizontal: spacing.lg,
    paddingRight: spacing.xl,
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  chipLabelActive: { color: colors.white },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing['5xl'],
    flexGrow: 1,
  },
  docCard: { marginBottom: spacing.sm },
  docHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  docTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  docId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    flex: 1,
  },
  docDetails: { gap: spacing.xs },
  docDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  docLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
    textTransform: 'uppercase',
  },
  docValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  typeBadge: {
    backgroundColor: colors.accentGlow,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  typeBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  docCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  docCtaText: {
    fontSize: fontSize.xs,
    color: colors.text3,
    fontWeight: fontWeight.medium,
  },
  // QA #327 — per-row action buttons (View + Send only).
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  actionBtnView: {
    borderColor: colors.accent,
    backgroundColor: 'transparent',
  },
  actionBtnSend: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  actionBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
