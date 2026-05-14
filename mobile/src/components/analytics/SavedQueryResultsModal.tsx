/**
 * SavedQueryResultsModal — full-screen overlay that renders the rows
 * returned by a SavedQuery (QA #297).
 *
 * Mobile DB Explorer doesn't have a desktop-style results grid. Instead
 * each row is rendered as a card with the saved query's column spec —
 * compact, scrollable, and readable on a phone.
 */

import React from 'react';
import {
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import { exportRowsAsCsv } from '../../services/csvExport';
import type { SavedQuery } from '../../screens/analytics/dbExplorerQueries';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

interface Props {
  query: SavedQuery | null;
  rows: any[];
  onClose: () => void;
}

const SavedQueryResultsModal: React.FC<Props> = ({ query, rows, onClose }) => {
  if (!query) return null;

  return (
    <Modal
      visible={!!query}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{query.label}</Text>
            <Text style={styles.subtitle}>
              {rows.length} row{rows.length !== 1 ? 's' : ''} · {query.table}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              exportRowsAsCsv(rows, query.columns, {
                title: query.label,
                filename: `${query.id}.csv`,
              })
            }
            style={styles.exportBtn}
            accessibilityLabel="Export results as CSV">
            <Ionicons name="download-outline" size={18} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {/* Results */}
        <FlatList
          data={rows}
          keyExtractor={(row, idx) => String(row?.id ?? row?.lane ?? idx)}
          contentContainerStyle={
            rows.length === 0 ? styles.emptyWrap : styles.listContent
          }
          renderItem={({ item }) => (
            <Card style={styles.rowCard}>
              {query.columns.map((c) => {
                const val = c.value ? c.value(item) : item?.[c.key];
                return (
                  <View key={c.key} style={styles.colRow}>
                    <Text style={styles.colHeader}>{c.header}</Text>
                    <Text style={styles.colValue} numberOfLines={2}>
                      {val == null || val === '' ? '—' : String(val)}
                    </Text>
                  </View>
                );
              })}
            </Card>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="No matching rows"
              subtitle="The query ran but the current data set has nothing to show."
            />
          }
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
  },
  exportBtn: {
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  emptyWrap: { flex: 1, justifyContent: 'center' },
  rowCard: {
    marginBottom: spacing.sm,
  },
  colRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: spacing.md,
  },
  colHeader: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    flex: 0.4,
  },
  colValue: {
    fontSize: fontSize.sm,
    color: colors.text,
    flex: 0.6,
    textAlign: 'right',
  },
});

export default SavedQueryResultsModal;
