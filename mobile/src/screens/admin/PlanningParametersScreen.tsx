/**
 * PlanningParametersScreen — admin surface for tenant-level planning
 * configuration. Two sections:
 *
 *   1. Feature toggles (planning_parameters table) — yes/no flags
 *      that drive the planner's behavior.
 *   2. Dock loading durations (dock_loading_durations table) — per-mode
 *      default loading window minutes.
 *
 * Mobile mirror of frontend/src/pages/PlanningParametersPage.jsx +
 * frontend/src/components/planning-parameters/DockDurationsSection.jsx.
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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import {
  fetchParameters,
  updateParameter,
  type PlanningParameter,
} from '../../services/planningParametersService';
import {
  DURATION_OPTIONS,
  fetchDurations,
  updateDuration,
  type DockDurationRow,
} from '../../services/dockLoadingDurationsService';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function PlanningParametersScreen() {
  const [params, setParams] = useState<PlanningParameter[]>([]);
  const [durations, setDurations] = useState<DockDurationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingParamId, setSavingParamId] = useState<string | null>(null);
  const [savingDurationMode, setSavingDurationMode] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d] = await Promise.all([fetchParameters(), fetchDurations()]);
      setParams(p);
      setDurations(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleToggleParam = useCallback(
    async (param: PlanningParameter) => {
      const next = !param.enabled;
      setSavingParamId(param.id);
      try {
        await updateParameter(param.id, next);
        // Optimistically update so the UI reflects without a full reload.
        setParams((prev) =>
          prev.map((p) => (p.id === param.id ? { ...p, enabled: next } : p)),
        );
      } catch (e: any) {
        Alert.alert('Update failed', e?.message || 'Could not update parameter');
      } finally {
        setSavingParamId(null);
      }
    },
    [],
  );

  const handleSetDuration = useCallback(
    async (row: DockDurationRow, minutes: number) => {
      setSavingDurationMode(row.mode);
      try {
        await updateDuration(row.mode, { duration_minutes: minutes });
        setDurations((prev) =>
          prev.map((r) => (r.mode === row.mode ? { ...r, duration_minutes: minutes } : r)),
        );
      } catch (e: any) {
        Alert.alert('Update failed', e?.message || 'Could not update duration');
      } finally {
        setSavingDurationMode(null);
      }
    },
    [],
  );

  const handleToggleDurationEnabled = useCallback(
    async (row: DockDurationRow) => {
      const next = !row.enabled;
      setSavingDurationMode(row.mode);
      try {
        await updateDuration(row.mode, { enabled: next });
        setDurations((prev) =>
          prev.map((r) => (r.mode === row.mode ? { ...r, enabled: next } : r)),
        );
      } catch (e: any) {
        Alert.alert('Update failed', e?.message || 'Could not toggle row');
      } finally {
        setSavingDurationMode(null);
      }
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={loadAll}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <View style={styles.header}>
          <Ionicons name="options-outline" size={24} color={colors.accent} />
          <Text style={styles.title}>Planning Parameters</Text>
        </View>
        <Text style={styles.subtitle}>
          Enable or disable planning features and tune dock loading defaults.
          Changes take effect immediately for all future planning operations.
        </Text>

        {/* Feature toggles */}
        <Text style={styles.sectionTitle}>Feature Toggles</Text>
        {params.length === 0 ? (
          <Card style={styles.card}>
            <EmptyState
              icon="options-outline"
              title="No parameters configured"
              subtitle="Planning parameters appear here once seeded for the tenant."
            />
          </Card>
        ) : (
          params.map((p) => {
            const busy = savingParamId === p.id;
            return (
              <Card key={p.id} style={styles.card}>
                <View style={styles.paramRow}>
                  <View style={styles.paramInfo}>
                    <Text style={styles.paramLabel}>{p.label}</Text>
                    {p.description ? (
                      <Text style={styles.paramDesc}>{p.description}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.toggle,
                      p.enabled ? styles.toggleOn : styles.toggleOff,
                      busy && styles.toggleBusy,
                    ]}
                    onPress={() => !busy && handleToggleParam(p)}
                    disabled={busy}
                    activeOpacity={0.7}
                  >
                    {busy ? (
                      <ActivityIndicator
                        size="small"
                        color={p.enabled ? colors.green : colors.text3}
                      />
                    ) : (
                      <Text
                        style={[
                          styles.toggleText,
                          { color: p.enabled ? colors.green : colors.red },
                        ]}
                      >
                        {p.enabled ? 'Yes' : 'No'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </Card>
            );
          })
        )}

        {/* Dock loading durations */}
        <Text style={styles.sectionTitle}>Dock Loading Durations</Text>
        <Text style={styles.sectionHint}>
          Default loading-window minutes per mode. Per-appointment overrides on
          the dock scheduling page still take precedence — these are only
          defaults for new shipments.
        </Text>
        {durations.length === 0 ? (
          <Card style={styles.card}>
            <EmptyState
              icon="time-outline"
              title="No mode rows"
              subtitle="Dock duration rows appear here once seeded for the tenant."
            />
          </Card>
        ) : (
          durations.map((row) => {
            const busy = savingDurationMode === row.mode;
            return (
              <Card key={row.mode} style={styles.card}>
                <View style={styles.durationHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.paramLabel}>
                      {row.label || row.mode}
                    </Text>
                    <Text style={styles.paramDesc}>
                      Mode: <Text style={styles.modeMono}>{row.mode}</Text>
                      {row.enabled === false ? '  ·  Currently disabled (using fallback)' : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.toggle,
                      row.enabled !== false ? styles.toggleOn : styles.toggleOff,
                      busy && styles.toggleBusy,
                    ]}
                    onPress={() => !busy && handleToggleDurationEnabled(row)}
                    disabled={busy}
                    activeOpacity={0.7}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color={colors.text2} />
                    ) : (
                      <Text
                        style={[
                          styles.toggleText,
                          { color: row.enabled !== false ? colors.green : colors.red },
                        ]}
                      >
                        {row.enabled !== false ? 'On' : 'Off'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>DEFAULT MINUTES</Text>
                <View style={styles.chipRow}>
                  {DURATION_OPTIONS.map((m) => {
                    const active = Number(row.duration_minutes) === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        style={[
                          styles.minChip,
                          active && styles.minChipActive,
                          busy && styles.toggleBusy,
                        ]}
                        onPress={() => !busy && !active && handleSetDuration(row, m)}
                        disabled={busy}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.minChipText,
                            active && styles.minChipTextActive,
                          ]}
                        >
                          {m}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionHint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  card: { marginBottom: spacing.sm },
  paramRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  paramInfo: { flex: 1 },
  paramLabel: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  paramDesc: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
    lineHeight: 16,
  },
  modeMono: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  toggle: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    minWidth: 70,
    alignItems: 'center',
  },
  toggleOn: {
    backgroundColor: colors.greenDim,
    borderColor: colors.greenDim,
  },
  toggleOff: {
    backgroundColor: colors.redDim,
    borderColor: colors.redDim,
  },
  toggleBusy: { opacity: 0.6 },
  toggleText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  durationHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  minChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    minWidth: 56,
    alignItems: 'center',
  },
  minChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
  },
  minChipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  minChipTextActive: { color: colors.accent },
});
