import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

interface CarrierCardProps {
  carrier: any;
}

function otdLabel(otd?: number): string {
  if (otd == null) return 'N/A';
  if (otd >= 95) return 'Excellent';
  if (otd >= 85) return 'Good';
  if (otd >= 70) return 'Fair';
  return 'Poor';
}

/**
 * QA #279 — when otd_percentage is missing (most rows in the seed data
 * + many real-world tenants until performance has been computed), the
 * old `otdStatus()` returned 'Inactive', which made every carrier
 * appear inactive in the list. Use the carrier's own `status` field
 * when present, fall back to the OTD-derived label only when both are
 * missing, and treat null OTD as Active rather than Inactive (an
 * unrated carrier is not the same as a disabled one).
 */
function carrierBadgeStatus(carrier: any): string {
  const explicit = carrier?.status || carrier?.active_status;
  if (explicit) return String(explicit);
  const otd = carrier?.otd_percentage ?? carrier?.otd_pct;
  if (otd == null) return 'Active';
  if (otd >= 95) return 'Active';
  if (otd >= 85) return 'Planned';
  if (otd >= 70) return 'Warning';
  return 'Error';
}

const CarrierCard: React.FC<CarrierCardProps> = ({ carrier }) => {
  const navigation = useNavigation<any>();

  const handlePress = () => {
    navigation.navigate('CarrierDetail', { carrierId: carrier.id });
  };

  const otdPct = carrier.otd_percentage ?? carrier.otd_pct;
  const equipmentTypes: string[] = carrier.equipment_types ?? [];
  const contactName = carrier.contact_name ?? carrier.contact ?? '';
  const phone = carrier.phone ?? carrier.contact_phone ?? '';

  return (
    <TouchableOpacity activeOpacity={0.7} onPress={handlePress}>
      <Card style={styles.card}>
        {/* Row 1 — name + OTD badge */}
        <View style={styles.topRow}>
          <View style={styles.nameBlock}>
            <Text style={styles.name} numberOfLines={1}>
              {carrier.name}
            </Text>
            {carrier.mc_number ? (
              <Text style={styles.mc}>MC# {carrier.mc_number}</Text>
            ) : null}
          </View>

          <StatusBadge
            status={
              otdPct != null
                ? `${otdLabel(otdPct)} ${Math.round(otdPct)}%`
                : carrierBadgeStatus(carrier)
            }
          />
        </View>

        {/* Row 2 — contact info */}
        {(contactName || phone) ? (
          <View style={styles.contactRow}>
            <Ionicons
              name="person-outline"
              size={14}
              color={colors.text3}
              style={styles.contactIcon}
            />
            <Text style={styles.contactText} numberOfLines={1}>
              {[contactName, phone].filter(Boolean).join('  \u00B7  ')}
            </Text>
          </View>
        ) : null}

        {/* Row 3 — equipment types */}
        {equipmentTypes.length > 0 ? (
          <View style={styles.equipmentRow}>
            <Ionicons
              name="cube-outline"
              size={14}
              color={colors.text3}
              style={styles.contactIcon}
            />
            {equipmentTypes.map((eq: string) => (
              <View key={eq} style={styles.equipBadge}>
                <Text style={styles.equipText}>{eq}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  nameBlock: {
    flex: 1,
    marginRight: spacing.md,
  },
  name: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  mc: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    marginTop: 2,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  contactIcon: {
    marginRight: spacing.xs,
  },
  contactText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.regular,
    color: colors.text2,
    flex: 1,
  },
  equipmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  equipBadge: {
    backgroundColor: colors.bg4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    marginRight: spacing.xs,
    marginBottom: 2,
  },
  equipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.accent,
  },
});

export default CarrierCard;
