/**
 * LanePreferencesScreen — Finance → Lane Preferences (mobile).
 *
 * QA #286: previously this screen rendered "Coming Soon" via the
 * PlaceholderScreen. We now show a real read-only view mirroring the
 * web Lane Preferences page (frontend/src/pages/LanePreferencesPage.jsx):
 *
 *   - KPI strip (Total Lanes / Preferred / Excluded / Unique Lanes).
 *   - Search across id, origin, destination, mode, customer, and the
 *     preferred + excluded carrier names.
 *   - List of LanePreferenceCard rows.
 *   - "+ Add Lane Preference" button surfaces an inline notice — create
 *     and edit are still web-only for now; mobile parity is the
 *     visibility layer (per QA #286 scope).
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import LanePreferenceCard from '../../components/lanes/LanePreferenceCard';
import LaneStatsGrid from '../../components/lanes/LaneStatsGrid';
import { useData } from '../../state/DataContext';
import { DbApi } from '../../shared/api';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

type EditingPref = {
  id?: string;
  origin: string;
  dest: string;
  mode: string;
  customer: string;
  priority: string;
};

const PRIORITY_CHOICES = ['Low', 'Medium', 'High'];
const MODE_CHOICES = ['TL', 'LTL', 'Parcel', 'Air', 'Rail'];

function emptyPref(): EditingPref {
  return { origin: '', dest: '', mode: 'TL', customer: '', priority: 'Medium' };
}

export default function LanePreferencesScreen() {
  const { data, loading, refreshData } = useData();
  const [search, setSearch] = useState('');
  // QA #324 — local create / edit modal state. Form is intentionally
  // narrow (origin / dest / mode / customer / priority) so users can
  // capture the core lane fields on mobile; preferred + excluded
  // carrier chips stay web-managed for now since they need the carrier
  // picker the web has and that surface isn't ported to mobile.
  const [editing, setEditing] = useState<EditingPref | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const list = Array.isArray(data.lanePreferences) ? data.lanePreferences : [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p: any) => {
      const fields = [
        p?.id,
        p?.origin,
        p?.dest || p?.destination,
        p?.mode,
        p?.customer,
        ...(Array.isArray(p?.preferred) ? p.preferred : []),
        ...(Array.isArray(p?.excluded) ? p.excluded : []),
      ];
      return fields.some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [data.lanePreferences, search]);

  const openCreate = useCallback(() => setEditing(emptyPref()), []);

  const openEdit = useCallback((pref: any) => {
    setEditing({
      id: pref?.id,
      origin: pref?.origin || '',
      dest: pref?.dest || pref?.destination || '',
      mode: pref?.mode || 'TL',
      customer: pref?.customer || '',
      priority: pref?.priority || 'Medium',
    });
  }, []);

  // QA #324 — save round-trips through DbApi (POST for new, PATCH for
  // existing). The lane_preferences table is in the API's ALLOWED list
  // and audited by genericTableAudit, so the change_history entry
  // lands automatically on the backend.
  const onSave = useCallback(async () => {
    if (!editing) return;
    const trimmed = {
      origin: editing.origin.trim(),
      dest: editing.dest.trim(),
      mode: editing.mode.trim() || 'TL',
      customer: editing.customer.trim() || null,
      priority: editing.priority || 'Medium',
    };
    if (!trimmed.origin || !trimmed.dest) {
      Alert.alert('Origin and destination are required.');
      return;
    }
    setSaving(true);
    try {
      if (editing.id) {
        await DbApi.patch('lane_preferences', editing.id, trimmed);
      } else {
        // Generate a stable id mirroring the web pattern: LP-{ts}.
        const newId = `LP-${Date.now().toString().slice(-8)}`;
        await DbApi.upsert('lane_preferences', { id: newId, ...trimmed, preferred: [], excluded: [] });
      }
      await refreshData();
      setEditing(null);
    } catch (err: any) {
      Alert.alert('Save failed', err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [editing, refreshData]);

  const onDelete = useCallback(
    (pref: any) => {
      if (!pref?.id) return;
      Alert.alert(
        'Delete lane preference?',
        `${pref.origin || '?'} → ${pref.dest || pref.destination || '?'} will be removed. This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await DbApi.remove('lane_preferences', pref.id);
                await refreshData();
              } catch (err: any) {
                Alert.alert('Delete failed', err?.message || String(err));
              }
            },
          },
        ],
      );
    },
    [refreshData],
  );

  const onRowLongPress = useCallback(
    (pref: any) => {
      // QA #324 — Edit / Disable / Delete row actions. The lane_preferences
      // table has no `disabled` column today; on web "Disable" is realised
      // as a row removal. Until a column is added we map Disable → Delete
      // with an explicit confirmation so the action is distinct from a
      // hard delete only in intent. Once the column lands here we'll patch
      // { disabled: true } instead.
      type Item = { label: string; run: () => void; destructive?: boolean };
      const items: Item[] = [
        { label: 'Edit', run: () => openEdit(pref) },
        { label: 'Delete', destructive: true, run: () => onDelete(pref) },
      ];
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [...items.map((i) => i.label), 'Cancel'],
            destructiveButtonIndex: items.findIndex((i) => i.destructive),
            cancelButtonIndex: items.length,
            title: 'Lane preference',
          },
          (idx) => {
            if (idx >= 0 && idx < items.length) items[idx].run();
          },
        );
      } else {
        Alert.alert(
          'Lane preference',
          `${pref?.origin || '?'} → ${pref?.dest || pref?.destination || '?'}`,
          [
            ...items.map((i) => ({
              text: i.label,
              style: i.destructive ? ('destructive' as const) : ('default' as const),
              onPress: i.run,
            })),
            { text: 'Cancel', style: 'cancel' as const },
          ],
        );
      }
    },
    [openEdit, onDelete],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Lane Preferences</Text>
          <Text style={styles.subtitle}>
            Preferred &amp; excluded carriers per lane
          </Text>
        </View>
        <TouchableOpacity
          onPress={openCreate}
          style={styles.addBtn}
          accessibilityRole="button"
          accessibilityLabel="Add lane preference">
          <Ionicons name="add" size={16} color={colors.white} />
          <Text style={styles.addText}>Add</Text>
        </TouchableOpacity>
      </View>

      <LaneStatsGrid lanePreferences={data.lanePreferences} />

      <View style={styles.searchWrap}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search by lane, mode, customer, carrier..."
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item, idx) => String(item?.id ?? `${item?.origin || ''}-${item?.dest || ''}-${idx}`)}
        renderItem={({ item }) => (
          <LanePreferenceCard
            pref={item}
            onPress={() => openEdit(item)}
            onLongPress={() => onRowLongPress(item)}
          />
        )}
        contentContainerStyle={
          filtered.length === 0 ? styles.emptyContainer : styles.listContent
        }
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refreshData}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="star-outline"
            title="No lane preferences"
            subtitle={
              search
                ? 'Try adjusting your search.'
                : 'Tap Add to create your first lane preference.'
            }
          />
        }
      />

      {/* QA #324 — minimal Add / Edit modal. Mode + Priority use chip
          selectors instead of a fully-fledged picker since both lists
          are short. Preferred / Excluded carriers stay web-managed for
          now (need the carrier picker). */}
      <Modal
        visible={editing !== null}
        animationType="slide"
        transparent
        onRequestClose={() => !saving && setEditing(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editing?.id ? 'Edit Lane Preference' : 'New Lane Preference'}
              </Text>
              <TouchableOpacity onPress={() => !saving && setEditing(null)} accessibilityRole="button">
                <Ionicons name="close" size={22} color={colors.text2} />
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Origin</Text>
            <TextInput
              style={styles.input}
              value={editing?.origin || ''}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, origin: v } : e))}
              placeholder="e.g. Chicago, IL"
              placeholderTextColor={colors.text3}
            />
            <Text style={styles.fieldLabel}>Destination</Text>
            <TextInput
              style={styles.input}
              value={editing?.dest || ''}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, dest: v } : e))}
              placeholder="e.g. Dallas, TX"
              placeholderTextColor={colors.text3}
            />
            <Text style={styles.fieldLabel}>Mode</Text>
            <View style={styles.chipRow}>
              {MODE_CHOICES.map((m) => {
                const active = editing?.mode === m;
                return (
                  <TouchableOpacity
                    key={m}
                    activeOpacity={0.7}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setEditing((e) => (e ? { ...e, mode: m } : e))}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{m}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.fieldLabel}>Customer</Text>
            <TextInput
              style={styles.input}
              value={editing?.customer || ''}
              onChangeText={(v) => setEditing((e) => (e ? { ...e, customer: v } : e))}
              placeholder="Optional"
              placeholderTextColor={colors.text3}
            />
            <Text style={styles.fieldLabel}>Priority</Text>
            <View style={styles.chipRow}>
              {PRIORITY_CHOICES.map((p) => {
                const active = editing?.priority === p;
                return (
                  <TouchableOpacity
                    key={p}
                    activeOpacity={0.7}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setEditing((e) => (e ? { ...e, priority: p } : e))}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{p}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => !saving && setEditing(null)}
                disabled={saving}
              >
                <Text style={styles.btnGhostText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, saving && { opacity: 0.6 }]}
                onPress={onSave}
                disabled={saving}
              >
                <Text style={styles.btnPrimaryText}>
                  {saving ? 'Saving…' : editing?.id ? 'Save' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.xs, color: colors.text3, marginTop: 2 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  addText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  searchWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing['5xl'] },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  // QA #324 — modal sheet + form styles.
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.bg2,
    minHeight: 44,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  chipTextActive: {
    color: colors.white,
    fontWeight: fontWeight.bold,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { backgroundColor: colors.bg2, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text2 },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.white },
});
