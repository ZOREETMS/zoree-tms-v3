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
  View,
} from 'react-native';
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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Home</Text>
        <Text style={styles.subtitle}>
          Zoree Transportation Management System
        </Text>
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
