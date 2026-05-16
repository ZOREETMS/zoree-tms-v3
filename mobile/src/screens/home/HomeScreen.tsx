/**
 * HomeScreen — mobile Home (Overview → Home).
 *
 * QA #268: previously this screen rendered the "Coming Soon"
 * PlaceholderScreen because the mobile drawer entry was wired before
 * the real screen existed. We now mirror the web HomePage
 * (frontend/src/pages/HomePage.jsx):
 *
 *   1. Header: title + module-search input.
 *   2. KPI row: Active Shipments, Open Orders, Delayed Loads, Savings.
 *   3. Module directory grouped into six sections (Planning, Rate &
 *      Contract, Execution, Master Data, Finance & Compliance,
 *      Intelligence / Admin) — each tile navigates into the relevant
 *      drawer tab + nested screen.
 *
 * The search box filters across label/description/section.
 */

import React, { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useData } from '../../state/DataContext';
import HomeKpiRow from '../../components/home/HomeKpiRow';
import HomeModuleCard from '../../components/home/HomeModuleCard';
import {
  HOME_MODULE_SECTIONS,
  HomeModuleSection,
  HomeModuleItem,
} from './homeModules';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

function filterSections(
  sections: HomeModuleSection[],
  query: string,
): HomeModuleSection[] {
  const q = query.trim().toLowerCase();
  if (!q) return sections;
  return sections
    .map((sec) => ({
      ...sec,
      items: sec.items.filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          it.description.toLowerCase().includes(q) ||
          sec.section.toLowerCase().includes(q),
      ),
    }))
    .filter((sec) => sec.items.length > 0);
}

export default function HomeScreen() {
  const navigation = useNavigation<any>();
  const { data, loading, refreshData } = useData();
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () => filterSections(HOME_MODULE_SECTIONS, search),
    [search],
  );

  // QA #315 — Zoree AI Insights, derived inline from the loaded data
  // rather than calling out to a dedicated InsightsCard. Each row is
  // a one-line nudge with a count + a tap target that drills into the
  // relevant screen, mirroring the spirit of the web InsightsCard.
  const insights = useMemo(() => {
    const orders = Array.isArray(data.orders) ? data.orders : [];
    const shipments = Array.isArray(data.shipments) ? data.shipments : [];
    const unplanned = orders.filter((o: any) => (o.status || '').toLowerCase() === 'unplanned').length;
    const delayed = shipments.filter((s: any) => {
      const status = String(s.status || '').toLowerCase();
      // Delayed = anything still moving past its due date.
      const due = s.due_date || s.dueDate || s.eta;
      if (!due) return false;
      const t = new Date(due).getTime();
      return Number.isFinite(t) && t < Date.now() && status !== 'delivered' && status !== 'cancelled';
    }).length;
    const tendered = shipments.filter((s: any) => (s.status || '').toLowerCase() === 'tendered').length;
    const out: { icon: keyof typeof Ionicons.glyphMap; tone: string; text: string; tab?: string; screen?: string }[] = [];
    if (unplanned > 0) {
      out.push({
        icon: 'flash-outline',
        tone: colors.accent,
        text: `${unplanned} unplanned order${unplanned === 1 ? '' : 's'} ready to plan`,
        tab: 'PlanningTab',
        screen: 'Orders',
      });
    }
    if (tendered > 0) {
      out.push({
        icon: 'send-outline',
        tone: colors.cyan,
        text: `${tendered} shipment${tendered === 1 ? '' : 's'} awaiting carrier confirmation`,
        tab: 'PlanningTab',
        screen: 'Shipments',
      });
    }
    if (delayed > 0) {
      out.push({
        icon: 'alert-circle-outline',
        tone: colors.red,
        text: `${delayed} shipment${delayed === 1 ? '' : 's'} past their due date`,
        tab: 'ExecutionTab',
        screen: 'LiveTracking',
      });
    }
    if (out.length === 0) {
      out.push({ icon: 'sparkles-outline', tone: colors.green, text: 'All clear — no urgent items right now.' });
    }
    return out;
  }, [data.orders, data.shipments]);

  // QA #315 — Recent Activity: most recent shipment + order events.
  // Falls back to created_at and ID-based sorting when timestamps are
  // missing on legacy seed rows.
  const recentActivity = useMemo(() => {
    const ts = (r: any) =>
      new Date(r.updated_at || r.updatedAt || r.created_at || r.createdAt || 0).getTime() || 0;
    const items: { id: string; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; t: number; tab: string; screen: string }[] = [];
    (data.shipments || []).slice(0, 50).forEach((s: any) => {
      items.push({
        id: `ship-${s.id}`,
        label: `Shipment ${s.id}`,
        sub: `${s.status || 'Planned'} · ${s.carrier_name || s.carrier || 'no carrier'}`,
        icon: 'cube-outline',
        t: ts(s),
        tab: 'PlanningTab',
        screen: 'Shipments',
      });
    });
    (data.orders || []).slice(0, 50).forEach((o: any) => {
      items.push({
        id: `ord-${o.id}`,
        label: `Order ${o.id}`,
        sub: `${o.status || 'Unplanned'} · ${o.customer || 'no customer'}`,
        icon: 'receipt-outline',
        t: ts(o),
        tab: 'PlanningTab',
        screen: 'Orders',
      });
    });
    return items.sort((a, b) => b.t - a.t).slice(0, 6);
  }, [data.shipments, data.orders]);

  const onSelectModule = (item: HomeModuleItem) => {
    // Mirror the drawer's nested navigation pattern. initial:false
    // ensures we land on the requested screen, not the stack's
    // initialRoute.
    navigation.navigate(item.tab as never, {
      screen: item.screen,
      initial: false,
    } as never);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={refreshData} />
      }>
      {/* Header — QA #315 adds the "+ Create Shipment" primary action
          so the mobile home screen mirrors the web HomePage header
          (frontend/src/pages/HomePage.jsx:131-135). */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Home</Text>
          <Text style={styles.subtitle}>
            Zoree Transportation Management System
          </Text>
        </View>
        <TouchableOpacity
          style={styles.createShipmentBtn}
          activeOpacity={0.85}
          onPress={() =>
            navigation.navigate('PlanningTab' as never, {
              screen: 'Shipments',
              initial: false,
              params: { openCreate: true },
            } as never)
          }
          accessibilityRole="button"
          accessibilityLabel="Create shipment"
        >
          <Ionicons name="add" size={18} color={colors.white} />
          <Text style={styles.createShipmentText}>Create Shipment</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search modules..."
        placeholderTextColor={colors.text3}
        style={styles.search}
        returnKeyType="search"
        accessibilityLabel="Search modules"
      />

      {/* KPIs */}
      <HomeKpiRow shipments={data.shipments} orders={data.orders} />

      {/* QA #315 — Zoree AI Insights. Inline derivation keeps the home
          screen free of an InsightsCard component dependency; each row
          drills into the screen relevant to that nudge. */}
      <View style={styles.cardBlock}>
        <View style={styles.cardHeader}>
          <Ionicons name="sparkles" size={16} color={colors.accent} />
          <Text style={styles.cardTitle}>Zoree AI Insights</Text>
        </View>
        {insights.map((ins, idx) => (
          <TouchableOpacity
            key={`ins-${idx}`}
            style={styles.insightRow}
            activeOpacity={0.7}
            onPress={() => {
              if (ins.tab && ins.screen) {
                navigation.navigate(ins.tab as never, { screen: ins.screen, initial: false } as never);
              }
            }}
            disabled={!ins.tab}
          >
            <Ionicons name={ins.icon} size={18} color={ins.tone} />
            <Text style={styles.insightText}>{ins.text}</Text>
            {ins.tab ? <Ionicons name="chevron-forward" size={14} color={colors.text3} /> : null}
          </TouchableOpacity>
        ))}
      </View>

      {/* QA #315 — Recent Activity card. Pulls the most recent
          shipments + orders, sorted by updated/created timestamps. */}
      <View style={styles.cardBlock}>
        <View style={styles.cardHeader}>
          <Ionicons name="time-outline" size={16} color={colors.accent} />
          <Text style={styles.cardTitle}>Recent Activity</Text>
        </View>
        {recentActivity.length === 0 ? (
          <Text style={styles.activityEmpty}>No recent activity yet.</Text>
        ) : (
          recentActivity.map((row) => (
            <TouchableOpacity
              key={row.id}
              style={styles.activityRow}
              activeOpacity={0.7}
              onPress={() =>
                navigation.navigate(row.tab as never, { screen: row.screen, initial: false } as never)
              }
            >
              <Ionicons name={row.icon} size={18} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityLabel} numberOfLines={1}>{row.label}</Text>
                <Text style={styles.activitySub} numberOfLines={1}>{row.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.text3} />
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Modules */}
      <View style={styles.modulesSection}>
        <Text style={styles.sectionTitle}>All Modules</Text>
        <Text style={styles.sectionSub}>
          Browse all product capabilities by function
        </Text>

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No modules match your search
            </Text>
          </View>
        ) : (
          filtered.map((section) => (
            <View key={section.section} style={styles.sectionBlock}>
              <Text style={styles.sectionHeader}>{section.section}</Text>
              <View style={styles.grid}>
                {section.items.map((item) => (
                  <View
                    key={`${item.tab}.${item.screen}`}
                    style={styles.gridCell}>
                    <HomeModuleCard
                      icon={item.icon}
                      label={item.label}
                      description={item.description}
                      onPress={() => onSelectModule(item)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    marginBottom: spacing.xs,
  },
  // QA #315 — header row + Create Shipment button + insight/activity cards.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  createShipmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.accent,
  },
  createShipmentText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  cardBlock: {
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  insightText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  activityLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  activitySub: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
  },
  activityEmpty: {
    fontSize: fontSize.sm,
    color: colors.text3,
    fontStyle: 'italic',
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: 2,
  },
  search: {
    height: 44,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    fontSize: fontSize.sm,
    color: colors.text,
  },
  modulesSection: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  sectionSub: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginBottom: spacing.sm,
  },
  sectionBlock: {
    marginTop: spacing.md,
  },
  sectionHeader: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gridCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.text3,
  },
});
