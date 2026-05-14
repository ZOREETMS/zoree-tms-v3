/**
 * DockSchedulingScreen — date-filtered list of dock appointments
 * grouped by door, with per-card edit + FAB to create.
 *
 * Mobile mirror of frontend/src/pages/DockSchedulingPage.jsx + DockGrid.jsx.
 * The web app shows a calendar-grid layout; mobile is space-constrained
 * so we render each door as its own section with appointment cards.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import KpiCard from '../../components/ui/KpiCard';
import StatusBadge from '../../components/ui/StatusBadge';
import EmptyState from '../../components/ui/EmptyState';
import AppointmentFormModal from '../../components/dock/AppointmentFormModal';
import {
  computeDockStats,
  fetchAppointments,
  groupByDoor,
} from '../../services/dockSchedulingService';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function DockSchedulingScreen() {
  const [date, setDate] = useState<string>(todayIso());
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchAppointments(date);
      setAppointments(rows);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => computeDockStats(appointments), [appointments]);
  const grouped = useMemo(() => groupByDoor(appointments), [appointments]);

  function shiftDate(deltaDays: number) {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + deltaDays);
    setDate(d.toISOString().slice(0, 10));
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Ionicons name="calendar-outline" size={24} color={colors.accent} />
        <Text style={styles.title}>Dock Scheduling</Text>
      </View>

      {/* Date picker row */}
      <View style={styles.dateRow}>
        <TouchableOpacity
          onPress={() => shiftDate(-1)}
          style={styles.dateNavBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color={colors.text2} />
        </TouchableOpacity>
        <TextInput
          style={styles.dateInput}
          value={date}
          onChangeText={setDate}
          onBlur={load}
          placeholder="YYYY-MM-DD"
          keyboardType="numeric"
        />
        <TouchableOpacity
          onPress={() => shiftDate(1)}
          style={styles.dateNavBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.text2} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setDate(todayIso())}
          style={styles.todayBtn}
          activeOpacity={0.7}
        >
          <Text style={styles.todayBtnText}>Today</Text>
        </TouchableOpacity>
      </View>

      {/* KPIs — QA #281 layout: wrap to 2x2 on narrow phones so the
          cards don't get crushed into 80px slivers. */}
      <View style={styles.kpiRow}>
        <View style={styles.kpiCell}>
          <KpiCard label="Total" value={String(stats.total)} icon="calendar-outline" color={colors.accent} />
        </View>
        <View style={styles.kpiCell}>
          <KpiCard label="Scheduled" value={String(stats.scheduled)} icon="time-outline" color={colors.cyan} />
        </View>
        <View style={styles.kpiCell}>
          <KpiCard label="In Progress" value={String(stats.inProgress)} icon="play-circle-outline" color={colors.yellow} />
        </View>
        <View style={styles.kpiCell}>
          <KpiCard label="Done" value={String(stats.completed)} icon="checkmark-circle-outline" color={colors.green} />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        {grouped.length === 0 || appointments.length === 0 ? (
          loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <Card style={styles.emptyCard}>
              <EmptyState
                icon="calendar-outline"
                title="No appointments"
                subtitle={`Nothing scheduled for ${date}. Tap + to add the first appointment.`}
              />
            </Card>
          )
        ) : (
          grouped.map(([door, list]) => (
            <View key={door} style={styles.doorBlock}>
              <View style={styles.doorHeader}>
                <Ionicons name="enter-outline" size={16} color={colors.accent} />
                <Text style={styles.doorTitle}>{door}</Text>
                <Text style={styles.doorCount}>
                  {list.length} appt{list.length === 1 ? '' : 's'}
                </Text>
              </View>
              {list.length === 0 ? (
                <Card style={styles.openSlotCard}>
                  <Text style={styles.openSlotText}>Open — no appointments</Text>
                </Card>
              ) : (
                list.map((appt: any) => (
                  <TouchableOpacity
                    key={appt.id}
                    activeOpacity={0.7}
                    onPress={() => setEditing(appt)}
                  >
                    <Card style={styles.apptCard}>
                      <View style={styles.apptRow}>
                        <View style={styles.flex1}>
                          <View style={styles.apptTitleRow}>
                            <View style={[styles.typeBadge, typeColor(appt.type)]}>
                              <Text style={[styles.typeBadgeText, typeTextColor(appt.type)]}>
                                {String(appt.type || '').toUpperCase()}
                              </Text>
                            </View>
                            <Text style={styles.apptCarrier} numberOfLines={1}>
                              {appt.carrier || 'Carrier TBD'}
                            </Text>
                          </View>
                          <Text style={styles.apptMeta}>
                            🕐 {appt.start} · {appt.duration} min
                            {appt.shipment_id || appt.shipmentId
                              ? `  ·  📦 ${appt.shipment_id || appt.shipmentId}`
                              : ''}
                          </Text>
                          {appt.notes ? (
                            <Text style={styles.apptNotes} numberOfLines={2}>
                              {appt.notes}
                            </Text>
                          ) : null}
                        </View>
                        <StatusBadge status={appt.status || 'Scheduled'} />
                      </View>
                    </Card>
                  </TouchableOpacity>
                ))
              )}
            </View>
          ))
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => setCreating(true)}
      >
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      <AppointmentFormModal
        visible={creating}
        defaultDate={date}
        onClose={() => setCreating(false)}
        onSaved={async () => { await load(); }}
      />
      <AppointmentFormModal
        visible={!!editing}
        appointment={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => { await load(); }}
      />
    </SafeAreaView>
  );
}

/* Type badge color helpers — mirrors APPT_TYPE_COLORS on the web. */
function typeColor(type: string) {
  switch (type) {
    case 'Inbound': return { backgroundColor: colors.accentGlow };
    case 'Outbound': return { backgroundColor: colors.greenDim };
    case 'Cross-Dock': return { backgroundColor: 'rgba(124,58,237,0.12)' };
    default: return { backgroundColor: colors.bg3 };
  }
}
function typeTextColor(type: string) {
  switch (type) {
    case 'Inbound': return { color: colors.accent };
    case 'Outbound': return { color: colors.green };
    case 'Cross-Dock': return { color: colors.purple };
    default: return { color: colors.text2 };
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  dateNavBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.bg2,
    textAlign: 'center',
  },
  todayBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  todayBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.accent,
  },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  kpiCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  loadingWrap: { padding: spacing.xl, alignItems: 'center' },
  emptyCard: { paddingVertical: spacing.xl },
  doorBlock: { marginBottom: spacing.md },
  doorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  doorTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    flex: 1,
  },
  doorCount: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.text3,
  },
  openSlotCard: {
    backgroundColor: colors.bg3,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  openSlotText: {
    fontSize: fontSize.xs,
    color: colors.text3,
    fontStyle: 'italic',
  },
  apptCard: { marginBottom: spacing.sm },
  apptRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  flex1: { flex: 1 },
  apptTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  typeBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  apptCarrier: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 1,
  },
  apptMeta: {
    fontSize: fontSize.xs,
    color: colors.text2,
    marginTop: 2,
  },
  apptNotes: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.xs,
    fontStyle: 'italic',
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
