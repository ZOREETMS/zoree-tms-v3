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
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SearchBar from '../../components/ui/SearchBar';
import EmptyState from '../../components/ui/EmptyState';
import LanePreferenceCard from '../../components/lanes/LanePreferenceCard';
import LaneStatsGrid from '../../components/lanes/LaneStatsGrid';
import { useData } from '../../state/DataContext';
import { colors, fontSize, fontWeight, spacing } from '../../theme';

export default function LanePreferencesScreen() {
  const { data, loading, refreshData } = useData();
  const [search, setSearch] = useState('');

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

  const onAdd = useCallback(() => {
    // QA #286 — create-flow not yet ported to mobile. Web is still
    // SSOT for new/edit; mobile gives the user a clear hint rather
    // than navigating into a broken form.
    Alert.alert(
      'Add Lane Preference',
      'Creating and editing lane preferences is currently web-only. Use the Zoree web app to add a new lane preference; the entry will appear here on the next refresh.',
    );
  }, []);

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
          onPress={onAdd}
          style={styles.addBtn}
          accessibilityRole="button"
          accessibilityLabel="Add lane preference (web-only)">
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
        renderItem={({ item }) => <LanePreferenceCard pref={item} />}
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
                : 'Add preferred or excluded carriers per lane from the Zoree web app.'
            }
          />
        }
      />
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
});
