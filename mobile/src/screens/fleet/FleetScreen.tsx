import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  FlatList,
  RefreshControl,
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
import DriverFormModal from '../../components/fleet/DriverFormModal';
import VehicleFormModal from '../../components/fleet/VehicleFormModal';
import MasterTabSwitch from '../../components/common/MasterTabSwitch';
import { useData } from '../../state/DataContext';
import { deleteDriver, deleteVehicle } from '../../services/fleetService';
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
  const { data, loading, refreshData } = useData();
  const [activeTab, setActiveTab] = useState<TabKey>('vehicles');
  const [editingDriver, setEditingDriver] = useState<any | null>(null);
  const [creatingDriver, setCreatingDriver] = useState(false);
  const [busyDriverId, setBusyDriverId] = useState<string | null>(null);
  const [editingVehicle, setEditingVehicle] = useState<any | null>(null);
  const [creatingVehicle, setCreatingVehicle] = useState(false);
  const [busyVehicleUnit, setBusyVehicleUnit] = useState<string | null>(null);

  /**
   * Drivers come from the API via DataContext when available; fall back
   * to the in-file seed list when the table is empty (fresh tenant or
   * preview build with no backend).
   */
  const drivers = useMemo<any[]>(
    () => (Array.isArray(data.drivers) && data.drivers.length > 0 ? data.drivers : SEED_DRIVERS),
    [data.drivers],
  );
  const driversBackedByApi = Array.isArray(data.drivers) && data.drivers.length > 0;

  /**
   * Vehicles use the same DataContext-or-seed pattern as drivers. The
   * vehicles list endpoint landed alongside the equipment master, so
   * `data.vehicles` arrives empty (not undefined) on a fresh tenant.
   */
  const vehicles = useMemo<any[]>(
    () => {
      const fromCtx = (data as any).vehicles;
      return Array.isArray(fromCtx) && fromCtx.length > 0 ? fromCtx : SEED_VEHICLES;
    },
    [(data as any).vehicles],
  );
  const vehiclesBackedByApi = Array.isArray((data as any).vehicles) && (data as any).vehicles.length > 0;

  const vehicleKpis = useMemo(() => {
    const total = vehicles.length;
    const available = vehicles.filter((v: any) => v.status === 'Available').length;
    const inTransit = vehicles.filter((v: any) => v.status === 'In Transit').length;
    const maintenance = vehicles.filter((v: any) => v.status === 'Maintenance').length;
    return { total, available, inTransit, maintenance };
  }, [vehicles]);

  const driverKpis = useMemo(() => {
    const total = drivers.length;
    const available = drivers.filter((d: any) => d.status === 'Available').length;
    const onDuty = drivers.filter((d: any) => d.status === 'On Duty').length;
    const offDuty = drivers.filter((d: any) => d.status === 'Off Duty').length;
    return { total, available, onDuty, offDuty };
  }, [drivers]);

  const handleDeleteVehicle = useCallback(
    (v: any) => {
      Alert.alert(
        'Delete Vehicle',
        `Permanently delete ${v.unit}? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setBusyVehicleUnit(v.unit);
              try {
                await deleteVehicle(v.unit);
                await refreshData();
              } catch (e: any) {
                Alert.alert('Delete failed', e?.message || 'Could not delete vehicle');
              } finally {
                setBusyVehicleUnit(null);
              }
            },
          },
        ],
      );
    },
    [refreshData],
  );

  const handleDeleteDriver = useCallback(
    (driver: any) => {
      Alert.alert(
        'Delete Driver',
        `Permanently delete ${driver.name || driver.id}? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              setBusyDriverId(driver.id);
              try {
                await deleteDriver(driver.id);
                await refreshData();
              } catch (e: any) {
                Alert.alert('Delete failed', e?.message || 'Could not delete driver');
              } finally {
                setBusyDriverId(null);
              }
            },
          },
        ],
      );
    },
    [refreshData],
  );

  const renderVehicle = ({ item }: { item: any }) => {
    const milesYTD = item.milesYTD ?? item.miles_ytd ?? 0;
    const rowBusy = busyVehicleUnit === item.unit;
    return (
      <Card style={styles.itemCard}>
        <View style={styles.itemHeader}>
          <View style={styles.itemTitleRow}>
            <Ionicons name="bus-outline" size={18} color={colors.accent} />
            <Text style={styles.itemTitle}>{item.unit}</Text>
          </View>
          <StatusBadge status={item.status || 'Available'} />
        </View>
        <View style={styles.itemDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Type</Text>
            <Text style={styles.detailValue}>{item.type || '--'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Driver</Text>
            <Text style={styles.detailValue}>{item.driver || 'Unassigned'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Location</Text>
            <Text style={styles.detailValue}>{item.location || '--'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Miles YTD</Text>
            <Text style={styles.detailValue}>{Number(milesYTD).toLocaleString()}</Text>
          </View>
        </View>

        {vehiclesBackedByApi ? (
          <View style={styles.driverActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnEdit, rowBusy && styles.actionBtnBusy]}
              onPress={() => setEditingVehicle(item)}
              disabled={rowBusy}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={16} color={colors.accent} />
              <Text style={[styles.actionBtnText, { color: colors.accent }]}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDelete, rowBusy && styles.actionBtnBusy]}
              onPress={() => handleDeleteVehicle(item)}
              disabled={rowBusy}
              activeOpacity={0.7}
            >
              {rowBusy ? (
                <ActivityIndicator size="small" color={colors.red} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color={colors.red} />
                  <Text style={[styles.actionBtnText, { color: colors.red }]}>Delete</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </Card>
    );
  };

  const renderDriver = ({ item }: { item: any }) => {
    const endorsements: string[] = Array.isArray(item.endorsements)
      ? item.endorsements
      : typeof item.endorsements === 'string'
        ? item.endorsements.split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];
    const cdlClass = item.cdlClass || item.cdl_class || '--';
    const vehicle = item.vehicle || item.assigned_vehicle || '--';
    const hosToday = item.hosToday ?? item.hos_today ?? 0;
    const rowBusy = busyDriverId === item.id;

    return (
      <Card style={styles.itemCard}>
        <View style={styles.itemHeader}>
          <View style={styles.itemTitleRow}>
            <Ionicons name="person-outline" size={18} color={colors.accent} />
            <Text style={styles.itemTitle}>{item.name}</Text>
          </View>
          <StatusBadge status={item.status || 'Available'} />
        </View>
        <View style={styles.itemDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>CDL</Text>
            <Text style={styles.detailValue}>{item.cdl || item.cdl_number || '--'}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Class</Text>
            <Text style={styles.detailValue}>{cdlClass}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Vehicle</Text>
            <Text style={styles.detailValue}>{vehicle}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>HOS Today</Text>
            <Text style={styles.detailValue}>{hosToday}h</Text>
          </View>
          {endorsements.length > 0 && (
            <View style={styles.endorsementsRow}>
              <Text style={styles.detailLabel}>Endorsements</Text>
              <View style={styles.endorsementTags}>
                {endorsements.map((e) => (
                  <View key={e} style={styles.endorsementTag}>
                    <Text style={styles.endorsementText}>{e}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Action row — only when drivers are API-backed (no point
            offering Edit/Delete on read-only seed rows). */}
        {driversBackedByApi ? (
          <View style={styles.driverActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnEdit, rowBusy && styles.actionBtnBusy]}
              onPress={() => setEditingDriver(item)}
              disabled={rowBusy}
              activeOpacity={0.7}
            >
              <Ionicons name="create-outline" size={16} color={colors.accent} />
              <Text style={[styles.actionBtnText, { color: colors.accent }]}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnDelete, rowBusy && styles.actionBtnBusy]}
              onPress={() => handleDeleteDriver(item)}
              disabled={rowBusy}
              activeOpacity={0.7}
            >
              {rowBusy ? (
                <ActivityIndicator size="small" color={colors.red} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color={colors.red} />
                  <Text style={[styles.actionBtnText, { color: colors.red }]}>Delete</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </Card>
    );
  };

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

        {/* Tab switcher — QA #282 swaps the custom two-button row for
            the shared MasterTabSwitch (same component the Item Master
            uses) so toggle styling is consistent across the app. */}
        <View style={styles.tabContainerRow}>
          <MasterTabSwitch
            tabs={[
              { key: 'vehicles', label: `Vehicles (${vehicles.length})` },
              { key: 'drivers',  label: `Drivers (${drivers.length})` },
            ]}
            active={activeTab}
            onSelect={(k) => setActiveTab(k as TabKey)}
          />
        </View>

        {/* List */}
        {activeTab === 'vehicles' ? (
          <FlatList
            data={vehicles}
            renderItem={renderVehicle}
            keyExtractor={(item: any) => String(item.unit)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={refreshData}
                tintColor={colors.accent}
                colors={[colors.accent]}
              />
            }
            ListEmptyComponent={
              <EmptyState icon="bus-outline" title="No vehicles" subtitle="Vehicle data will appear here." />
            }
          />
        ) : (
          <FlatList
            data={drivers}
            renderItem={renderDriver}
            keyExtractor={(item: any) => String(item.id)}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={refreshData}
                tintColor={colors.accent}
                colors={[colors.accent]}
              />
            }
            ListEmptyComponent={
              <EmptyState icon="people-outline" title="No drivers" subtitle="Driver data will appear here." />
            }
          />
        )}

        {/* FAB — opens the right modal for the active tab. */}
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
          onPress={() => {
            if (activeTab === 'drivers') setCreatingDriver(true);
            else setCreatingVehicle(true);
          }}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </TouchableOpacity>

        <DriverFormModal
          visible={creatingDriver}
          onClose={() => setCreatingDriver(false)}
          onSaved={async () => {
            await refreshData();
          }}
        />
        <DriverFormModal
          visible={!!editingDriver}
          driver={editingDriver}
          onClose={() => setEditingDriver(null)}
          onSaved={async () => {
            await refreshData();
          }}
        />
        <VehicleFormModal
          visible={creatingVehicle}
          equipmentTypes={(data as any).equipmentTypes}
          drivers={drivers}
          onClose={() => setCreatingVehicle(false)}
          onSaved={async () => {
            await refreshData();
          }}
        />
        <VehicleFormModal
          visible={!!editingVehicle}
          vehicle={editingVehicle}
          equipmentTypes={(data as any).equipmentTypes}
          drivers={drivers}
          onClose={() => setEditingVehicle(null)}
          onSaved={async () => {
            await refreshData();
          }}
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
  kpiScroll: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  kpiRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  // QA #282 — old tabContainer styling is retained for layout context
  // but the active toggle is now rendered via MasterTabSwitch (see
  // tabContainerRow wrapper).
  tabContainerRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
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
