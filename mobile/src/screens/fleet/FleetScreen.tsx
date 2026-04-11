import React, { useMemo, useState } from 'react';
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
import EmptyState from '../../components/ui/EmptyState';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

// Seed data imported from shared fleet service patterns
const SEED_VEHICLES = [
  { unit: 'TRK-101', type: "Dry Van 53'", driver: 'James Wilson', location: 'Chicago, IL', dest: 'Dallas, TX', nextPM: '2026-03-15', milesYTD: 42180, status: 'In Transit' },
  { unit: 'TRK-102', type: "Dry Van 53'", driver: 'Maria Santos', location: 'Atlanta, GA', dest: 'Columbus, OH', nextPM: '2026-04-02', milesYTD: 38440, status: 'In Transit' },
  { unit: 'TRK-103', type: "Reefer 48'", driver: 'David Chen', location: 'Dallas, TX', dest: '\u2014', nextPM: '2026-03-20', milesYTD: 51200, status: 'Available' },
  { unit: 'TRK-104', type: "Flatbed 48'", driver: 'Unassigned', location: 'Columbus, OH', dest: '\u2014', nextPM: '2026-03-08', milesYTD: 29880, status: 'Maintenance' },
  { unit: 'TRK-105', type: "Dry Van 53'", driver: 'Linda Park', location: 'Los Angeles, CA', dest: 'Seattle, WA', nextPM: '2026-05-01', milesYTD: 61050, status: 'In Transit' },
  { unit: 'TRK-106', type: "Dry Van 53'", driver: 'Carlos Rivera', location: 'New York, NY', dest: '\u2014', nextPM: '2026-04-14', milesYTD: 33720, status: 'Available' },
  { unit: 'TRK-107', type: "Reefer 48'", driver: 'Amy Johnson', location: 'Seattle, WA', dest: 'Los Angeles, CA', nextPM: '2026-03-25', milesYTD: 44310, status: 'In Transit' },
  { unit: 'TRK-108', type: "Dry Van 53'", driver: 'Unassigned', location: 'Chicago, IL', dest: '\u2014', nextPM: '2026-03-10', milesYTD: 18900, status: 'Maintenance' },
  { unit: 'TRK-109', type: "Flatbed 48'", driver: 'Tom Bradley', location: 'Houston, TX', dest: '\u2014', nextPM: '2026-06-01', milesYTD: 27540, status: 'Available' },
  { unit: 'TRK-110', type: "Dry Van 53'", driver: 'Rachel Kim', location: 'Miami, FL', dest: 'Atlanta, GA', nextPM: '2026-04-18', milesYTD: 39760, status: 'In Transit' },
];

const SEED_DRIVERS = [
  { id: 'DRV-001', name: 'James Wilson', cdl: 'CDL-IL-1234567', cdlClass: 'Class A', vehicle: 'TRK-101', location: 'Chicago, IL', status: 'On Duty', hosToday: 9.5, endorsements: ['Hazmat', 'Tanker'] },
  { id: 'DRV-002', name: 'Maria Santos', cdl: 'CDL-GA-2345678', cdlClass: 'Class A', vehicle: 'TRK-102', location: 'Atlanta, GA', status: 'On Duty', hosToday: 7.2, endorsements: ['Doubles', 'Reefer'] },
  { id: 'DRV-003', name: 'David Chen', cdl: 'CDL-TX-3456789', cdlClass: 'Class A', vehicle: 'TRK-103', location: 'Dallas, TX', status: 'Available', hosToday: 0, endorsements: ['Reefer', 'Hazmat'] },
  { id: 'DRV-004', name: 'Linda Park', cdl: 'CDL-CA-4567890', cdlClass: 'Class A', vehicle: 'TRK-105', location: 'Los Angeles, CA', status: 'On Duty', hosToday: 8.4, endorsements: ['Flatbed'] },
  { id: 'DRV-005', name: 'Carlos Rivera', cdl: 'CDL-NY-5678901', cdlClass: 'Class A', vehicle: 'TRK-106', location: 'New York, NY', status: 'Available', hosToday: 0, endorsements: ['Tanker', 'Hazmat'] },
  { id: 'DRV-006', name: 'Amy Johnson', cdl: 'CDL-WA-6789012', cdlClass: 'Class A', vehicle: 'TRK-107', location: 'Seattle, WA', status: 'On Duty', hosToday: 10.2, endorsements: ['Reefer'] },
  { id: 'DRV-007', name: 'Tom Bradley', cdl: 'CDL-TX-7890123', cdlClass: 'Class A', vehicle: 'TRK-109', location: 'Houston, TX', status: 'Available', hosToday: 0, endorsements: ['Flatbed', 'Oversize'] },
  { id: 'DRV-008', name: 'Rachel Kim', cdl: 'CDL-FL-8901234', cdlClass: 'Class A', vehicle: 'TRK-110', location: 'Miami, FL', status: 'On Duty', hosToday: 7.5, endorsements: [] },
];

type TabKey = 'vehicles' | 'drivers';

export default function FleetScreen() {
  const [activeTab, setActiveTab] = useState<TabKey>('vehicles');

  const vehicleKpis = useMemo(() => {
    const total = SEED_VEHICLES.length;
    const available = SEED_VEHICLES.filter((v) => v.status === 'Available').length;
    const inTransit = SEED_VEHICLES.filter((v) => v.status === 'In Transit').length;
    const maintenance = SEED_VEHICLES.filter((v) => v.status === 'Maintenance').length;
    return { total, available, inTransit, maintenance };
  }, []);

  const driverKpis = useMemo(() => {
    const total = SEED_DRIVERS.length;
    const available = SEED_DRIVERS.filter((d) => d.status === 'Available').length;
    const onDuty = SEED_DRIVERS.filter((d) => d.status === 'On Duty').length;
    const offDuty = SEED_DRIVERS.filter((d) => d.status === 'Off Duty').length;
    return { total, available, onDuty, offDuty };
  }, []);

  const renderVehicle = ({ item }: { item: typeof SEED_VEHICLES[0] }) => (
    <Card style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleRow}>
          <Ionicons name="bus-outline" size={18} color={colors.accent} />
          <Text style={styles.itemTitle}>{item.unit}</Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Type</Text>
          <Text style={styles.detailValue}>{item.type}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Driver</Text>
          <Text style={styles.detailValue}>{item.driver}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Location</Text>
          <Text style={styles.detailValue}>{item.location}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Miles YTD</Text>
          <Text style={styles.detailValue}>{item.milesYTD.toLocaleString()}</Text>
        </View>
      </View>
    </Card>
  );

  const renderDriver = ({ item }: { item: typeof SEED_DRIVERS[0] }) => (
    <Card style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleRow}>
          <Ionicons name="person-outline" size={18} color={colors.accent} />
          <Text style={styles.itemTitle}>{item.name}</Text>
        </View>
        <StatusBadge status={item.status} />
      </View>
      <View style={styles.itemDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>CDL</Text>
          <Text style={styles.detailValue}>{item.cdl}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Class</Text>
          <Text style={styles.detailValue}>{item.cdlClass}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Vehicle</Text>
          <Text style={styles.detailValue}>{item.vehicle}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>HOS Today</Text>
          <Text style={styles.detailValue}>{item.hosToday}h</Text>
        </View>
        {item.endorsements.length > 0 && (
          <View style={styles.endorsementsRow}>
            <Text style={styles.detailLabel}>Endorsements</Text>
            <View style={styles.endorsementTags}>
              {item.endorsements.map((e) => (
                <View key={e} style={styles.endorsementTag}>
                  <Text style={styles.endorsementText}>{e}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="car-sport-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Fleet</Text>
        </View>

        {/* KPI cards */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kpiRow}
          style={styles.kpiScroll}
        >
          {activeTab === 'vehicles' ? (
            <>
              <KpiCard label="Total Vehicles" value={vehicleKpis.total} icon="bus-outline" color={colors.accent} />
              <KpiCard label="Available" value={vehicleKpis.available} icon="checkmark-circle-outline" color={colors.green} />
              <KpiCard label="In Transit" value={vehicleKpis.inTransit} icon="navigate-outline" color={colors.cyan} />
              <KpiCard label="Maintenance" value={vehicleKpis.maintenance} icon="construct-outline" color={colors.yellow} />
            </>
          ) : (
            <>
              <KpiCard label="Total Drivers" value={driverKpis.total} icon="people-outline" color={colors.accent} />
              <KpiCard label="Available" value={driverKpis.available} icon="checkmark-circle-outline" color={colors.green} />
              <KpiCard label="On Duty" value={driverKpis.onDuty} icon="time-outline" color={colors.cyan} />
              <KpiCard label="Off Duty" value={driverKpis.offDuty} icon="moon-outline" color={colors.text3} />
            </>
          )}
        </ScrollView>

        {/* Tab switcher */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'vehicles' && styles.tabActive]}
            onPress={() => setActiveTab('vehicles')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="bus-outline"
              size={18}
              color={activeTab === 'vehicles' ? colors.accent : colors.text2}
            />
            <Text style={[styles.tabLabel, activeTab === 'vehicles' && styles.tabLabelActive]}>
              Vehicles ({SEED_VEHICLES.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'drivers' && styles.tabActive]}
            onPress={() => setActiveTab('drivers')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="people-outline"
              size={18}
              color={activeTab === 'drivers' ? colors.accent : colors.text2}
            />
            <Text style={[styles.tabLabel, activeTab === 'drivers' && styles.tabLabelActive]}>
              Drivers ({SEED_DRIVERS.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* List */}
        {activeTab === 'vehicles' ? (
          <FlatList
            data={SEED_VEHICLES}
            renderItem={renderVehicle}
            keyExtractor={(item) => item.unit}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <EmptyState icon="bus-outline" title="No vehicles" subtitle="Vehicle data will appear here." />
            }
          />
        ) : (
          <FlatList
            data={SEED_DRIVERS}
            renderItem={renderDriver}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <EmptyState icon="people-outline" title="No drivers" subtitle="Driver data will appear here." />
            }
          />
        )}
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
  kpiScroll: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  kpiRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.lg,
    padding: spacing.xs,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
  },
  tabActive: {
    backgroundColor: colors.bg2,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  tabLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  tabLabelActive: {
    color: colors.accent,
    fontWeight: fontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['5xl'],
    flexGrow: 1,
  },
  itemCard: {
    marginBottom: spacing.md,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  itemTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  itemDetails: {
    gap: spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: fontSize.sm,
    color: colors.text2,
  },
  detailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  endorsementsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  endorsementTags: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  endorsementTag: {
    backgroundColor: colors.accentGlow,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  endorsementText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
});
