import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
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
import EmptyState from '../../components/ui/EmptyState';
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');

  const filtered = useMemo(() => {
    if (typeFilter === 'All') return SEED_DOCUMENTS;
    return SEED_DOCUMENTS.filter((d) => d.type === typeFilter);
  }, [typeFilter]);

  const stats = useMemo(() => {
    const total = SEED_DOCUMENTS.length;
    const bols = SEED_DOCUMENTS.filter((d) => d.type === 'BOL').length;
    const pods = SEED_DOCUMENTS.filter((d) => d.type === 'POD').length;
    const pending = SEED_DOCUMENTS.filter((d) => d.status === 'Pending').length;
    return { total, bols, pods, pending };
  }, []);

  const handleGenerateBOL = () => {
    Alert.alert(
      'Generate BOL',
      'This would generate a new Bill of Lading for a selected shipment.',
      [{ text: 'OK' }],
    );
  };

  const renderDocument = useCallback(
    ({ item }: { item: typeof SEED_DOCUMENTS[0] }) => (
      <Card style={styles.docCard}>
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
      </Card>
    ),
    [],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="folder-open-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Documents</Text>
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

        {/* Generate BOL button */}
        <TouchableOpacity
          style={styles.generateButton}
          activeOpacity={0.7}
          onPress={handleGenerateBOL}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.white} />
          <Text style={styles.generateButtonText}>Generate BOL</Text>
        </TouchableOpacity>

        {/* Type filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}
        >
          {TYPE_FILTERS.map((t) => (
            <TouchableOpacity
              key={t}
              activeOpacity={0.7}
              onPress={() => setTypeFilter(t)}
              style={[styles.chip, typeFilter === t && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, typeFilter === t && styles.chipLabelActive]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Document list */}
        <FlatList
          data={filtered}
          renderItem={renderDocument}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <EmptyState
              icon="document-outline"
              title="No documents found"
              subtitle="Try adjusting the type filter."
            />
          }
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
    flex: 1,
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
    gap: spacing.md,
  },
  generateButton: {
    flexDirection: 'row',
    backgroundColor: colors.accent,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  generateButtonText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  chipScroll: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  chipRow: {
    paddingHorizontal: spacing.lg,
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
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  chipLabelActive: {
    color: colors.white,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing['5xl'],
    flexGrow: 1,
  },
  docCard: {
    marginBottom: spacing.md,
  },
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
  },
  docId: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  docDetails: {
    gap: spacing.xs,
  },
  docDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  docLabel: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
  docValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
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
});
