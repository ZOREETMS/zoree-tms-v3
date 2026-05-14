import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { DbApi } from '../../lib/api';
import Card from '../../components/ui/Card';
import StatusBadge from '../../components/ui/StatusBadge';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

type ParamList = {
  CarrierDetail: { carrierId: string };
};

export default function CarrierDetailScreen() {
  const route = useRoute<RouteProp<ParamList, 'CarrierDetail'>>();
  const navigation = useNavigation<any>();
  const { data, refreshData } = useData();
  const [deleting, setDeleting] = useState(false);

  const carrierId = route.params?.carrierId;

  const carrier = useMemo(() => {
    if (!carrierId || carrierId === '__new__') return null;
    return data.carriers.find((c: any) => String(c.id) === String(carrierId));
  }, [data.carriers, carrierId]);

  const handleDelete = useCallback(() => {
    if (!carrier) return;
    Alert.alert(
      'Delete Carrier',
      `Are you sure you want to delete ${carrier.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await DbApi.remove('carriers', carrier.id);
              await refreshData();
              navigation.goBack();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to delete carrier');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }, [carrier, refreshData, navigation]);

  const handleEdit = useCallback(() => {
    // QA #279 — carrier edit form is not yet ported to mobile; the
    // backend supports the upsert but there's no RN form. Be honest
    // about the gap so the admin knows to use web for the field-level
    // edits (status / OTD source / equipment types).
    Alert.alert(
      'Edit Carrier',
      'Carrier editing is currently web-only. Open the Zoree web app to edit carrier details; changes will appear here on the next refresh.',
    );
  }, []);

  /* ---------- empty state ---------- */
  if (!carrier) {
    // QA #279 — the FAB from CarriersScreen routes here with
    // carrierId === '__new__'. Without a mobile-side create form we
    // need to make the path honest: tell the user create is web-only
    // rather than rendering "Carrier not found" which made the FAB
    // look broken.
    const isNew = carrierId === '__new__';
    return (
      <View style={styles.centered}>
        <Ionicons
          name={isNew ? 'add-circle-outline' : 'business-outline'}
          size={48}
          color={colors.text3}
        />
        <Text style={styles.emptyText}>
          {isNew ? 'Add Carrier' : 'Carrier not found'}
        </Text>
        {isNew ? (
          <Text
            style={[
              styles.emptyText,
              { fontSize: 13, color: colors.text3, marginTop: 4 },
            ]}>
            Creating a new carrier is currently web-only. New rows will
            sync to mobile on the next refresh.
          </Text>
        ) : null}
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  /* ---------- derived values ---------- */
  const certifications: string[] = carrier.certifications ?? carrier.endorsements ?? [];
  const otdPct = carrier.otd_percentage ?? carrier.otd_pct;
  const claimRatio = carrier.claim_ratio;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {carrier.name}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Info card */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Carrier Information</Text>
          <InfoRow label="Name" value={carrier.name} />
          <InfoRow label="MC Number" value={carrier.mc_number} />
          <InfoRow label="DOT Number" value={carrier.dot_number} />
          <InfoRow
            label="Contact"
            value={carrier.contact_name ?? carrier.contact}
          />
          <InfoRow
            label="Phone"
            value={carrier.phone ?? carrier.contact_phone}
          />
          <InfoRow
            label="Email"
            value={carrier.email ?? carrier.contact_email}
          />
        </Card>

        {/* Certifications */}
        {certifications.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>
              Certifications / Endorsements
            </Text>
            <View style={styles.certList}>
              {certifications.map((cert: string, idx: number) => (
                <View key={idx} style={styles.certBadge}>
                  <Ionicons
                    name="checkmark-circle"
                    size={14}
                    color={colors.green}
                    style={{ marginRight: spacing.xs }}
                  />
                  <Text style={styles.certText}>{cert}</Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {/* Performance metrics */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Performance Metrics</Text>
          <View style={styles.metricsRow}>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>On-Time Delivery</Text>
              {otdPct != null ? (
                <Text style={styles.metricValue}>
                  {Math.round(otdPct)}%
                </Text>
              ) : (
                <Text style={styles.metricNA}>N/A</Text>
              )}
              {otdPct != null && (
                <StatusBadge
                  status={
                    otdPct >= 95
                      ? 'Active'
                      : otdPct >= 85
                        ? 'Planned'
                        : otdPct >= 70
                          ? 'Warning'
                          : 'Error'
                  }
                />
              )}
            </View>
            <View style={styles.metricBox}>
              <Text style={styles.metricLabel}>Claim Ratio</Text>
              {claimRatio != null ? (
                <Text style={styles.metricValue}>
                  {(claimRatio * 100).toFixed(1)}%
                </Text>
              ) : (
                <Text style={styles.metricNA}>N/A</Text>
              )}
            </View>
          </View>
        </Card>

        {/* Action buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.editBtn}
            activeOpacity={0.8}
            onPress={handleEdit}
          >
            <Ionicons name="create-outline" size={20} color={colors.white} />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteBtn}
            activeOpacity={0.8}
            onPress={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator size="small" color={colors.red} />
            ) : (
              <>
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={colors.red}
                />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

/* ---------- helper component ---------- */
function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={infoStyles.row}>
      <Text style={infoStyles.label}>{label}</Text>
      <Text style={infoStyles.value}>{value ?? '\u2014'}</Text>
    </View>
  );
}

const infoStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text2,
  },
  value: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
    maxWidth: '60%',
  },
});

/* ---------- main styles ---------- */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  emptyText: {
    fontSize: fontSize.md,
    color: colors.text3,
    marginTop: spacing.md,
  },
  link: {
    fontSize: fontSize.md,
    color: colors.accent,
    marginTop: spacing.md,
    fontWeight: fontWeight.semibold,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backBtn: {
    marginRight: spacing.md,
    padding: spacing.xs,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  certList: {
    gap: spacing.sm,
  },
  certBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  certText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  metricBox: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    textAlign: 'center',
  },
  metricValue: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  metricNA: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
    color: colors.text3,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  editBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  deleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.redDim,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  deleteBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.red,
  },
});
