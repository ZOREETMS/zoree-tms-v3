/**
 * DbExplorerScreen — mobile DB Explorer.
 *
 * History:
 *   - QA P207 (2026-05-11): originally a landing page only. Raw SQL on
 *     a phone is impractical, so we redirected planners to the web app
 *     for full querying.
 *   - QA #297 (2026-05-14): planners wanted SOME mobile data-explorer
 *     surface so they don't have to context-switch. Compromise: a
 *     small library of pre-baked "Saved Queries" that run as plain JS
 *     filters against the already-loaded DataContext. No SQL parser,
 *     no syntax highlighting — just one tap to see "Unplanned Orders",
 *     "Top Lanes", etc., with CSV export from the results modal.
 *
 * The earlier "Common tables" quick-jumps (Orders / Shipments /
 * Invoices) are kept — they cover the "I want to see this in the real
 * detail screen" flow.
 */

import React, { useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import SavedQueryResultsModal from '../../components/analytics/SavedQueryResultsModal';
import { useData } from '../../state/DataContext';
import {
  SAVED_QUERIES,
  type SavedQuery,
} from './dbExplorerQueries';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

interface QuickLink {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  drawer: string;
  screen: string;
}

const QUICK_LINKS: QuickLink[] = [
  {
    title: 'Orders',
    description: 'Browse the orders table with filters and search.',
    icon: 'receipt-outline',
    drawer: 'PlanningTab',
    screen: 'Orders',
  },
  {
    title: 'Shipments',
    description: 'All shipments with status, carrier, and cost.',
    icon: 'cube-outline',
    drawer: 'PlanningTab',
    screen: 'Shipments',
  },
  {
    title: 'Freight Invoices',
    description: 'Invoice ledger with tolerance + approval state.',
    icon: 'document-text-outline',
    drawer: 'FinanceTab',
    screen: 'FreightInvoices',
  },
];

export default function DbExplorerScreen() {
  const navigation = useNavigation<any>();
  const { data } = useData();
  const [active, setActive] = useState<SavedQuery | null>(null);

  const activeRows = useMemo(
    () => (active ? active.run(data) : []),
    [active, data],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>DB Explorer</Text>
        <Text style={styles.subtitle}>
          Saved queries that run against your live data — no SQL required.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Saved Queries — QA #297. */}
        <Text style={styles.sectionTitle}>Saved Queries</Text>
        {SAVED_QUERIES.map((q) => {
          const count = q.run(data).length;
          return (
            <TouchableOpacity
              key={q.id}
              activeOpacity={0.7}
              onPress={() => setActive(q)}>
              <Card style={styles.linkCard}>
                <View style={styles.linkRow}>
                  <View style={styles.linkIcon}>
                    <Ionicons name="search-outline" size={20} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.linkTitle}>{q.label}</Text>
                    <Text style={styles.linkDescription}>{q.description}</Text>
                  </View>
                  <View style={styles.countPill}>
                    <Text style={styles.countText}>{count}</Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}

        {/* Quick-jumps to the existing detail screens. */}
        <Text style={styles.sectionTitle}>Common tables</Text>
        {QUICK_LINKS.map((link) => (
          <TouchableOpacity
            key={link.title}
            activeOpacity={0.7}
            onPress={() =>
              navigation.navigate(link.drawer, { screen: link.screen })
            }>
            <Card style={styles.linkCard}>
              <View style={styles.linkRow}>
                <View style={styles.linkIcon}>
                  <Ionicons name={link.icon} size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTitle}>{link.title}</Text>
                  <Text style={styles.linkDescription}>{link.description}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.text3} />
              </View>
            </Card>
          </TouchableOpacity>
        ))}

        <Text style={styles.footnote}>
          Need raw SQL or ad-hoc joins? The web DB Explorer remains the
          desktop home for free-form querying.
        </Text>
      </ScrollView>

      <SavedQueryResultsModal
        query={active}
        rows={activeRows}
        onClose={() => setActive(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: spacing.xs,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  linkCard: { marginBottom: spacing.md },
  linkRow: { flexDirection: 'row', alignItems: 'center' },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(37,99,235,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  linkTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  linkDescription: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  countPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(37,99,235,0.12)',
    marginLeft: spacing.sm,
  },
  countText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  footnote: {
    fontSize: fontSize.xs,
    color: colors.text3,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
