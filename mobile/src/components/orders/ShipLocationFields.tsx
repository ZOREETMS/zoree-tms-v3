/**
 * ShipLocationFields — renders Name / City / State / ZIP as four
 * independent inputs for one side of an order (origin or destination).
 *
 * Why separate inputs (re-introduced 2026-05-11):
 *   The original mobile new-order form (pre-QA-#158) collected City +
 *   State per side as their own rows. QA #158 removed them because they
 *   looked duplicated against the Origin/Destination address picker
 *   directly above. The user has now asked for the inverse: Name +
 *   City + State + ZIP must all be separate, directly editable fields
 *   so a planner can correct a single component (e.g. tweak the state
 *   abbreviation) without re-typing the whole address. The picker
 *   stays — selecting a saved location auto-fills these inputs via
 *   OrderFormScreen.applyLocationSelection — but the fields are no
 *   longer derived from the composed picker value at render time.
 *
 * Persistence (see ordersService.buildOrderSavePayload):
 *   - Name  → orders.ship_from_name / orders.ship_to_name
 *   - ZIP   → orders.origin_zip / orders.dest_zip
 *   - City + State → composed into orders.origin / orders.dest as
 *                    "CITY, ST" so the planner / rate-matcher (which
 *                    still reads the composed string) keeps working.
 *
 * Pure presentation component per CLAUDE_RULES §1, §2: no business
 * logic, no API calls. Every value flows in via props and every edit
 * bubbles up via the typed onChange callbacks.
 */

import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';

export interface ShipLocationFieldsProps {
  /** Section heading rendered above the four inputs ("Ship From" / "Ship To"). */
  title: string;
  /** Location name (free text — e.g. "Dallas Warehouse"). */
  name: string;
  city: string;
  state: string;
  zip: string;
  onNameChange:  (next: string) => void;
  onCityChange:  (next: string) => void;
  onStateChange: (next: string) => void;
  onZipChange:   (next: string) => void;
}

export default function ShipLocationFields({
  title,
  name,
  city,
  state,
  zip,
  onNameChange,
  onCityChange,
  onStateChange,
  onZipChange,
}: ShipLocationFieldsProps) {
  // State input is uppercased + capped at 2 chars to match the
  // canonical 2-letter US code stored in the locations master and
  // composed into orders.origin / orders.dest. ZIP is digits-only,
  // capped at 5 so the numeric keyboard cannot produce a value the
  // composed-address parser would later truncate.
  const handleStateChange = (raw: string) => {
    const cleaned = raw.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
    onStateChange(cleaned);
  };
  const handleZipChange = (raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, '').slice(0, 5);
    onZipChange(cleaned);
  };

  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title.toUpperCase()}</Text>

      <Field
        label="Location Name"
        value={name}
        onChangeText={onNameChange}
        placeholder="e.g. Dallas Warehouse"
      />
      <Field
        label="City"
        value={city}
        onChangeText={onCityChange}
        placeholder="e.g. Dallas"
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Field
            label="State"
            value={state}
            onChangeText={handleStateChange}
            placeholder="TX"
            autoCapitalize="characters"
            maxLength={2}
          />
        </View>
        <View style={styles.flex}>
          <Field
            label="ZIP"
            value={zip}
            onChangeText={handleZipChange}
            placeholder="75207"
            keyboardType="numeric"
            maxLength={5}
          />
        </View>
      </View>
    </View>
  );
}

/* ───────── Sub-component ───────── */

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  maxLength,
  autoCapitalize,
}: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.text3}
        keyboardType={keyboardType || 'default'}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

/* ───────── Styles ───────── */

const styles = StyleSheet.create({
  group: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
  },
  groupTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.text2,
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  fieldWrap: { marginBottom: spacing.md },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
