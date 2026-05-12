/**
 * mobile/src/components/shipments/ShipmentActionFooter.tsx
 *
 * Reusable action footer for the Shipment Detail screen. Mirrors the
 * web `ShipmentDetailModal` action footer 1:1:
 *
 *   - Tender to Carrier       (Planned / Tender Rejected)
 *   - Withdraw Tender         (Tendered)
 *   - Change Carrier          (Planned / Tendered / Tender Rejected / In Transit)
 *   - Dock schedule           (always)
 *   - Invoice                 (always)
 *   - Documents               (always)
 *   - Contact Carrier         (always)
 *   - Send to WMS             (Tender Accepted / Confirmed / In Transit / Delivered)
 *
 * The component is a dumb renderer — visibility comes from `status`
 * (already resolved by `effectiveShipmentStatus` in the parent screen)
 * and every press fires a typed callback the screen owns. No API calls
 * here; per CLAUDE_RULES §1 / §3 / §4 those live in the service layer.
 */

import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

export interface ShipmentActionFooterProps {
  /** Effective status (run shipment row through effectiveShipmentStatus). */
  status: string;
  /** Disable all buttons while a long-running action is in flight. */
  busy?: boolean;
  /** Set on the specific button that owns the in-flight spinner. */
  busyAction?:
    | 'tender'
    | 'withdraw'
    | 'changeCarrier'
    | 'invoice'
    | 'dock'
    | 'documents'
    | 'contact'
    | 'wms'
    | null;
  onTender: () => void;
  onWithdraw: () => void;
  onChangeCarrier: () => void;
  onDockSchedule: () => void;
  onInvoice: () => void;
  onDocuments: () => void;
  onContactCarrier: () => void;
  onSendToWms: () => void;
}

const TENDER_STATUSES = new Set(['Planned', 'Tender Rejected']);
const CHANGE_CARRIER_STATUSES = new Set([
  'Planned',
  'Tendered',
  'Tender Rejected',
  'In Transit',
]);
const TENDER_ACCEPTED_STATUSES = new Set([
  'Tender Accepted',
  'Confirmed',
  'In Transit',
  'Delivered',
]);

const ShipmentActionFooter: React.FC<ShipmentActionFooterProps> = ({
  status,
  busy = false,
  busyAction = null,
  onTender,
  onWithdraw,
  onChangeCarrier,
  onDockSchedule,
  onInvoice,
  onDocuments,
  onContactCarrier,
  onSendToWms,
}) => {
  const showTender = TENDER_STATUSES.has(status);
  const showWithdraw = status === 'Tendered';
  const showChangeCarrier = CHANGE_CARRIER_STATUSES.has(status);
  const showSendToWms = TENDER_ACCEPTED_STATUSES.has(status);

  const renderButton = (
    key: ShipmentActionFooterProps['busyAction'],
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    onPress: () => void,
    variant: 'primary' | 'secondary' | 'warning',
  ) => {
    const isThisBusy = busyAction === key;
    const disabled = busy && !isThisBusy ? false : busy && isThisBusy;
    const variantStyle =
      variant === 'primary'
        ? styles.primaryBtn
        : variant === 'warning'
        ? styles.warningBtn
        : styles.secondaryBtn;
    const labelStyle =
      variant === 'secondary' ? styles.secondaryLabel : styles.primaryLabel;
    return (
      <TouchableOpacity
        key={key || label}
        onPress={onPress}
        disabled={busy}
        activeOpacity={0.8}
        style={[styles.btn, variantStyle, busy && styles.btnDisabled]}
      >
        {isThisBusy ? (
          <ActivityIndicator
            size="small"
            color={variant === 'secondary' ? colors.text : colors.white}
          />
        ) : (
          <Ionicons
            name={icon}
            size={16}
            color={variant === 'secondary' ? colors.text : colors.white}
          />
        )}
        <Text style={[styles.btnLabel, labelStyle]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.footer}>
      {showTender &&
        renderButton('tender', 'Tender to Carrier', 'send-outline', onTender, 'primary')}
      {showWithdraw &&
        renderButton(
          'withdraw',
          'Withdraw Tender',
          'arrow-undo-outline',
          onWithdraw,
          'warning',
        )}
      {showChangeCarrier &&
        renderButton(
          'changeCarrier',
          'Change Carrier',
          'swap-horizontal-outline',
          onChangeCarrier,
          'secondary',
        )}
      {renderButton(
        'dock',
        'Dock schedule',
        'business-outline',
        onDockSchedule,
        'secondary',
      )}
      {renderButton('invoice', 'Invoice', 'receipt-outline', onInvoice, 'secondary')}
      {renderButton(
        'documents',
        'Documents',
        'document-text-outline',
        onDocuments,
        'secondary',
      )}
      {renderButton(
        'contact',
        'Contact Carrier',
        'mail-outline',
        onContactCarrier,
        'secondary',
      )}
      {showSendToWms &&
        renderButton(
          'wms',
          'Send to WMS',
          'paper-plane-outline',
          onSendToWms,
          'secondary',
        )}
    </View>
  );
};

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
    minHeight: 40,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
  },
  secondaryBtn: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  warningBtn: {
    backgroundColor: '#EA580C',
  },
  btnLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  primaryLabel: {
    color: colors.white,
  },
  secondaryLabel: {
    color: colors.text,
  },
});

export default ShipmentActionFooter;
