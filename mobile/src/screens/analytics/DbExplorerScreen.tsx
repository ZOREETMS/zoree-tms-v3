/**
 * DbExplorerScreen — QA P207 (2026-05-11).
 *
 * Honest mobile landing for the web's DB Explorer. The desktop
 * surface is a raw SQL editor + results grid + table sidebar — none
 * of which is a sensible mobile workflow (tiny screen + a keyboard
 * that hides syntax highlighting). Rather than ship a half-baked
 * mobile SQL editor, this screen surfaces:
 *
 *   - A clear note that DB Explorer is web-only by design
 *   - The three tables most planners hit on the web (orders,
 *     shipments, invoices) as quick-jump cards into the existing
 *     mobile read-side screens
 *   - A pointer to the web URL for full querying
 *
 * If a tenant later needs read-only saved queries on mobile, the
 * route is reserved (InsightsTabParamList.DbExplorer) and we can
 * swap this component for a Grid.js-backed viewer without touching
 * the navigator.
 */

import React from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>DB Explorer</Text>
        <Text style={styles.subtitle}>
          Raw SQL is a desktop workflow — these are the mobile-friendly views.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.noticeCard}>
          <View style={styles.noticeRow}>
            <Ionicons name="information-circle-outline" size={22} color={colors.accent} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.noticeTitle}>
                Open the web app for full querying
              </Text>
              <Text style={styles.noticeBody}>
                The web DB Explorer supports raw SQL, exports, and
                schema browsing. Use it for ad-hoc analysis; the
                shortcuts below cover the everyday reads.
              </Text>
            </View>
          </View>
        </Card>

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
                  <Text style={styles.linkDescription}>
                    {link.description}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.text3}
                />
              </View>
            </Card>
          </TouchableOpacity>
        ))}

        <Text style={styles.footnote}>
          Tip: long-press an Orders row for a quick-action menu, or
          pull-to-refresh any list to re-read from the server.
        </Text>
      </ScrollView>
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
  noticeCard: {
    marginBottom: spacing.lg,
    backgroundColor: 'rgba(37,99,235,0.08)',
    borderColor: 'rgba(37,99,235,0.25)',
    borderWidth: 1,
  },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  noticeTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: 2,
  },
  noticeBody: {
    fontSize: fontSize.sm,
    color: colors.text2,
    lineHeight: 18,
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
  footnote: {
    fontSize: fontSize.xs,
    color: colors.text3,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
