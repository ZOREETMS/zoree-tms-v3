/**
 * DocumentViewerModal — slide-up sheet that shows a document's
 * fields, lets the user change its status, and delete the row.
 *
 * Mobile mirror of frontend/src/components/documents/DocumentViewerModal.jsx.
 * The web ships full print-style document templates (BOLDocument /
 * PODDocument / HazmatDocument / InvoiceDocument) for desktop
 * printing; on mobile we show the same data as a field list keyed
 * by document type. Status mutations and deletes go through
 * documentService so DataContext reload is the single refresh path.
 */

import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
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
  STATUS_BY_TYPE,
  removeDocument,
  updateDocumentStatus,
  type DocType,
} from '../../services/documentService';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface DocumentViewerModalProps {
  visible: boolean;
  document: any | null;
  onClose: () => void;
  /** Called after a successful save/delete so the caller can refresh. */
  onChanged?: () => void | Promise<void>;
}

export default function DocumentViewerModal({
  visible,
  document,
  onClose,
  onChanged,
}: DocumentViewerModalProps) {
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const typeKey: DocType = useMemo(() => {
    const t = String(document?.type || 'BOL') as DocType;
    return (STATUS_BY_TYPE as any)[t] ? t : 'BOL';
  }, [document]);

  const statusOptions = STATUS_BY_TYPE[typeKey];
  const currentStatus = pendingStatus || document?.status || 'Pending';

  async function handleSetStatus(next: string) {
    if (!document?.id) return;
    setPendingStatus(next);
    setBusy(true);
    try {
      await updateDocumentStatus(document.id, next);
      if (onChanged) await onChanged();
      onClose();
    } catch (e: any) {
      Alert.alert('Update failed', e?.message || 'Could not update status');
      setPendingStatus(null);
    } finally {
      setBusy(false);
    }
  }

  function handleDelete() {
    if (!document?.id) return;
    Alert.alert(
      'Delete Document',
      `Permanently delete ${document.id}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await removeDocument(document.id);
              if (onChanged) await onChanged();
              onClose();
            } catch (e: any) {
              Alert.alert('Delete failed', e?.message || 'Could not delete document');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  if (!document) return null;

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
              <Text style={styles.headerLabel}>{typeKey}</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {document.id}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => !busy && onClose()}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              disabled={busy}
            >
              <Ionicons name="close" size={24} color={colors.text2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {/* Common fields shown for every doc type. */}
            <SectionLabel label="Document" />
            <Row label="Type" value={typeKey} />
            <Row label="Status" value={String(currentStatus)} highlight />
            <Row label="Generated" value={document.generated || '--'} />
            <Row label="Shipment" value={document.ship || '--'} mono />
            <Row label="Carrier" value={document.carrier || '--'} />

            {/* BOL-specific fields. */}
            {typeKey === 'BOL' ? (
              <>
                <SectionLabel label="Bill of Lading" />
                <Row label="BOL Type" value={document.bolType || 'BOL'} />
                <Row label="Mode" value={document.mode || '--'} />
                <Row label="Origin" value={document.origin || '--'} />
                <Row label="Destination" value={document.dest || '--'} />
                <Row label="Pickup Date" value={document.pickupDate || '--'} />
                <Row label="Delivery Date" value={document.deliveryDate || '--'} />
                <Row label="Weight" value={document.weight ? `${document.weight} lbs` : '--'} />
                <Row label="Pieces" value={document.pieces != null ? String(document.pieces) : '--'} />
                <Row label="Incoterms" value={document.incoterms || '--'} />
                <Row
                  label="Linked Orders"
                  value={Array.isArray(document.orderIds) && document.orderIds.length > 0
                    ? document.orderIds.join(', ')
                    : '--'}
                  mono
                />
                {Array.isArray(document.lineItems) && document.lineItems.length > 0 ? (
                  <>
                    <SectionLabel label={`Line Items (${document.lineItems.length})`} />
                    {document.lineItems.map((line: any, idx: number) => (
                      <View key={idx} style={styles.lineRow}>
                        <Text style={styles.lineDesc} numberOfLines={2}>
                          {line.description || `Line ${idx + 1}`}
                        </Text>
                        <Text style={styles.lineMeta}>
                          {line.qty || line.qty_ordered || 0} ×{' '}
                          {line.unit_weight || 0}lb
                        </Text>
                      </View>
                    ))}
                  </>
                ) : null}
              </>
            ) : null}

            {/* POD-specific fields. */}
            {typeKey === 'POD' ? (
              <>
                <SectionLabel label="Proof of Delivery" />
                <Row label="Origin" value={document.origin || '--'} />
                <Row label="Destination" value={document.dest || '--'} />
                <Row label="Delivered On" value={document.deliveryDate || '--'} />
                <Row label="Weight" value={document.weight ? `${document.weight} lbs` : '--'} />
                <Row label="Pieces" value={document.pieces != null ? String(document.pieces) : '--'} />
                <Row
                  label="Linked Orders"
                  value={Array.isArray(document.orderIds) && document.orderIds.length > 0
                    ? document.orderIds.join(', ')
                    : '--'}
                  mono
                />
              </>
            ) : null}

            {/* Hazmat-specific fields. */}
            {typeKey === 'Hazmat' ? (
              <>
                <SectionLabel label="Hazmat Declaration" />
                <Row label="Origin" value={document.origin || '--'} />
                <Row label="Destination" value={document.dest || '--'} />
                <Row label="Mode" value={document.mode || '--'} />
                <Row label="Weight" value={document.weight ? `${document.weight} lbs` : '--'} />
                <Row label="Pieces" value={document.pieces != null ? String(document.pieces) : '--'} />
              </>
            ) : null}

            {/* Invoice-specific fields. */}
            {typeKey === 'Invoice' ? (
              <>
                <SectionLabel label="Commercial Invoice" />
                <Row label="Origin" value={document.origin || '--'} />
                <Row label="Destination" value={document.dest || '--'} />
                <Row label="Weight" value={document.weight ? `${document.weight} lbs` : '--'} />
                <Row label="Pieces" value={document.pieces != null ? String(document.pieces) : '--'} />
              </>
            ) : null}

            <SectionLabel label="Update Status" />
            <View style={styles.chipRow}>
              {statusOptions.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.chip,
                    currentStatus === s && styles.chipActive,
                    busy && styles.chipBusy,
                  ]}
                  onPress={() => !busy && currentStatus !== s && handleSetStatus(s)}
                  disabled={busy}
                  activeOpacity={0.7}
                >
                  {busy && pendingStatus === s ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Text style={[styles.chipText, currentStatus === s && styles.chipTextActive]}>
                      {s}
                    </Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.btn, styles.btnGhost]}
              onPress={() => !busy && onClose()}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Text style={styles.btnGhostText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnDanger, busy && styles.btnDisabled]}
              onPress={handleDelete}
              disabled={busy}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color={colors.red} />
              <Text style={styles.btnDangerText}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* ── Sub-components ── */

function SectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>;
}

function Row({
  label,
  value,
  highlight,
  mono,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  mono?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          highlight && styles.rowValueHighlight,
          mono && styles.rowValueMono,
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    flex: 1,
  },
  rowValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    flex: 2,
    textAlign: 'right',
  },
  rowValueHighlight: { color: colors.accent },
  rowValueMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lineDesc: { fontSize: fontSize.sm, color: colors.text, flex: 1 },
  lineMeta: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text3,
    marginLeft: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg2,
    minWidth: 80,
    alignItems: 'center',
  },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentGlow },
  chipBusy: { opacity: 0.6 },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
  },
  chipTextActive: { color: colors.accent },
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
  btnDanger: { borderWidth: 1, borderColor: colors.redDim, backgroundColor: 'transparent' },
  btnDangerText: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.red },
  btnDisabled: { opacity: 0.6 },
});
