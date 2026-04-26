/**
 * GenerateDocumentModal — slide-up sheet for creating a new document
 * (BOL / POD / Hazmat / Invoice) for an existing shipment.
 *
 * Mobile mirror of the web's "Generate BOL" / equivalent flows. Uses
 * documentService.generateDocumentForShipment to build the payload
 * the same way the web does, then saveDocument to persist.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  DOC_TYPES,
  generateDocumentForShipment,
  saveDocument,
  type DocType,
} from '../../services/documentService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface GenerateDocumentModalProps {
  visible: boolean;
  /** Available shipments to pick from. */
  shipments?: Array<any>;
  onClose: () => void;
  onCreated?: (doc: any) => void | Promise<void>;
}

export default function GenerateDocumentModal({
  visible,
  shipments,
  onClose,
  onCreated,
}: GenerateDocumentModalProps) {
  const [type, setType] = useState<DocType>('BOL');
  const [shipmentId, setShipmentId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset form when modal opens.
  useEffect(() => {
    if (visible) {
      setType('BOL');
      setShipmentId('');
      setSearch('');
    }
  }, [visible]);

  const shipmentList = useMemo(() => (shipments || []) as any[], [shipments]);

  const filteredShipments = useMemo(() => {
    if (!search.trim()) return shipmentList;
    const q = search.toLowerCase();
    return shipmentList.filter((s) =>
      String(s.id || s.shipment_id || '').toLowerCase().includes(q)
      || String(s.carrier || '').toLowerCase().includes(q)
      || String(s.origin || '').toLowerCase().includes(q)
      || String(s.dest || s.destination || '').toLowerCase().includes(q),
    );
  }, [shipmentList, search]);

  const selectedShipment = useMemo(
    () => shipmentList.find((s) => String(s.id || s.shipment_id) === shipmentId),
    [shipmentList, shipmentId],
  );

  async function handleGenerate() {
    if (!selectedShipment) {
      Alert.alert('Pick a shipment', 'Select a shipment to generate the document for.');
      return;
    }
    setBusy(true);
    try {
      const orders = Array.isArray(selectedShipment.orders) ? selectedShipment.orders : [];
      const lineItems = Array.isArray(selectedShipment.line_items) ? selectedShipment.line_items : [];
      const doc = generateDocumentForShipment(type, selectedShipment, orders, lineItems);
      await saveDocument(doc);
      if (onCreated) await onCreated(doc);
      onClose();
    } catch (e: any) {
      Alert.alert('Generate failed', e?.message || 'Could not generate document');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={() => !busy && onClose()}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerLabel}>New</Text>
              <Text style={styles.headerTitle}>Generate Document</Text>
            </View>
            <TouchableOpacity
              onPress={() => !busy && onClose()}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              disabled={busy}
            >
              <Ionicons name="close" size={24} color={colors.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionLabel}>DOCUMENT TYPE</Text>
            <View style={styles.chipRow}>
              {DOC_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.chip, type === t && styles.chipActive]}
                  onPress={() => setType(t)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>FOR SHIPMENT</Text>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder="Search by shipment id, carrier, origin..."
              placeholderTextColor={colors.text3}
            />
            <View style={styles.shipmentsList}>
              {filteredShipments.length === 0 ? (
                <Text style={styles.emptyText}>
                  {shipmentList.length === 0
                    ? 'No shipments available — create one from the Shipments screen first.'
                    : 'No shipments match your search.'}
                </Text>
              ) : (
                filteredShipments.slice(0, 30).map((s) => {
                  const id = String(s.id || s.shipment_id);
                  const isSelected = id === shipmentId;
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[styles.shipmentRow, isSelected && styles.shipmentRowSelected]}
                      onPress={() => setShipmentId(id)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.shipmentId} numberOfLines={1}>{id}</Text>
                        <Text style={styles.shipmentMeta} numberOfLines={1}>
                          {(s.carrier || '--')} · {s.origin || '?'} → {s.dest || s.destination || '?'}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })
              )}
              {filteredShipments.length > 30 ? (
                <Text style={styles.emptyText}>
                  Showing first 30 of {filteredShipments.length} — refine search to see others.
                </Text>
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => !busy && onClose()}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={styles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, (busy || !selectedShipment) && styles.btnDisabled]}
              onPress={handleGenerate}
              disabled={busy || !selectedShipment}
              activeOpacity={0.7}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={18} color={colors.white} />
                  <Text style={styles.btnPrimaryText}>Generate {type}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: 2,
  },
  body: { padding: spacing.lg, paddingBottom: spacing.xl },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    minWidth: 70,
    alignItems: 'center',
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentGlow },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  chipTextActive: { color: colors.accent },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.bg2,
    marginBottom: spacing.sm,
  },
  shipmentsList: {
    backgroundColor: colors.bg2,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  shipmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  shipmentRowSelected: { backgroundColor: colors.accentGlow },
  shipmentId: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  shipmentMeta: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 2,
  },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.text3,
    textAlign: 'center',
    padding: spacing.md,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg2,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  btnGhost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  btnGhostText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnDisabled: { opacity: 0.6 },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
});
