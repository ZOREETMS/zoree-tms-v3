import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import { deleteLocation, toggleLocationStatus } from '../../shared/services/locationService';
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
  LocationDetail: { locationId: string };
};

interface Capability {
  key: string;
  label: string;
  icon: string;
}

const CAPABILITIES: Capability[] = [
  { key: 'liftgate', label: 'Liftgate Required', icon: 'arrow-up-circle-outline' },
  { key: 'hazmat', label: 'Hazmat Certified', icon: 'warning-outline' },
  { key: 'appointment_required', label: 'Appointment Required', icon: 'calendar-outline' },
  { key: 'twic', label: 'TWIC Card Required', icon: 'shield-checkmark-outline' },
  { key: 'inside_delivery', label: 'Inside Delivery', icon: 'enter-outline' },
];

export default function LocationDetailScreen() {
  const route = useRoute<RouteProp<ParamList, 'LocationDetail'>>();
  const navigation = useNavigation<any>();
  const { data, refreshData } = useData();
  const [busy, setBusy] = useState(false);

  const locationId = route.params?.locationId;

  const location = useMemo(() => {
    if (!locationId) return null;
    return data.locations.find(
      (l: any) => String(l.id) === String(locationId),
    );
  }, [data.locations, locationId]);

  /* ---------- empty state ---------- */
  if (!location) {
    return (
      <View style={styles.centered}>
        <Ionicons name="location-outline" size={48} color={colors.text3} />
        <Text style={styles.emptyText}>Location not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.link}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  /* ---------- derived ---------- */
  const fullAddress = [
    location.address,
    location.city,
    location.state,
    location.zip,
  ]
    .filter(Boolean)
    .join(', ');

  const hasCoords =
    location.latitude != null && location.longitude != null;

  const activeCaps = CAPABILITIES.filter(
    (cap) => location[cap.key] === true,
  );

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
          {location.name}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Basic info */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Location Information</Text>
          <InfoRow label="Name" value={location.name} />
          <InfoRow label="Address" value={fullAddress || null} />
          <InfoRow
            label="Customer"
            value={location.customer_name ?? location.customer}
          />
          <InfoRow
            label="Phone"
            value={location.phone ?? location.contact_phone}
          />
          {location.type ? (
            <View style={styles.typeRow}>
              <Text style={infoStyles.label}>Type</Text>
              <StatusBadge status={location.type} />
            </View>
          ) : null}
        </Card>

        {/* Capabilities */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Capabilities</Text>
          {CAPABILITIES.map((cap) => {
            const active = location[cap.key] === true;
            return (
              <View key={cap.key} style={styles.capRow}>
                <Ionicons
                  name={cap.icon as any}
                  size={18}
                  color={active ? colors.green : colors.text3}
                  style={{ marginRight: spacing.sm }}
                />
                <Text
                  style={[
                    styles.capLabel,
                    !active && styles.capInactive,
                  ]}
                >
                  {cap.label}
                </Text>
                <Ionicons
                  name={active ? 'checkmark-circle' : 'close-circle-outline'}
                  size={18}
                  color={active ? colors.green : colors.text3}
                />
              </View>
            );
          })}
        </Card>

        {/* Operating hours */}
        {location.operating_hours ? (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Operating Hours</Text>
            <Text style={styles.hoursText}>{location.operating_hours}</Text>
          </Card>
        ) : null}

        {/* Map placeholder */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Map</Text>
          <View style={styles.mapPlaceholder}>
            <Ionicons name="map-outline" size={40} color={colors.text3} />
            {hasCoords ? (
              <Text style={styles.coords}>
                {Number(location.latitude).toFixed(4)},{' '}
                {Number(location.longitude).toFixed(4)}
              </Text>
            ) : (
              <Text style={styles.coords}>Coordinates not available</Text>
            )}
          </View>
        </Card>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.accent }]}
            onPress={() => navigation.navigate('LocationForm', { locationId: location.id })}
          >
            <Ionicons name="create-outline" size={20} color={colors.accent} />
            <Text style={[styles.actionBtnText, { color: colors.accent }]}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.red }]}
            disabled={busy}
            onPress={() => {
              Alert.alert('Delete Location', `Delete "${location.name}"?`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    setBusy(true);
                    try {
                      await deleteLocation(location.id);
                      await refreshData();
                      navigation.goBack();
                    } catch (e: any) {
                      Alert.alert('Error', e.message);
                    } finally {
                      setBusy(false);
                    }
                  },
                },
              ]);
            }}
          >
            <Ionicons name="trash-outline" size={20} color={colors.red} />
            <Text style={[styles.actionBtnText, { color: colors.red }]}>Delete</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: spacing['5xl'] }} />
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
  typeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  capRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  capLabel: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text,
  },
  capInactive: {
    color: colors.text3,
  },
  hoursText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text,
    lineHeight: 22,
  },
  mapPlaceholder: {
    height: 180,
    backgroundColor: colors.bg3,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  coords: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    backgroundColor: colors.bg2,
  },
  actionBtnText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
});
