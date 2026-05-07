/**
 * CreateLocationModal — small modal that captures Name/City/State/Zip
 * and persists a new row to the locations master via
 * services/locationsService.createLocation. Used by OrderFormScreen so
 * a user who can't find their pickup/dropoff in the picker can add it
 * inline (QA bug #114) without leaving the New Order flow.
 *
 * Component contract (CLAUDE_RULES §2 — small/single-purpose):
 *  - No knowledge of orders or where it's used
 *  - No knowledge of the form state above
 *  - Owns its own input state; exits via onCreated(loc) or onClose()
 *
 * The screen is responsible for refreshing DataContext so the new row
 * appears in the dropdown — we just hand back the created location.
 */

import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import { createLocation, validateNewLocation } from '../../services/locationsService';

export interface CreateLocationModalProps {
  visible: boolean;
  /** Fired when the new row is persisted - caller refreshes DataContext + selects the new value. */
  onCreated: (loc: any) => void;
  onClose: () => void;
  /** Pre-fills Name when set (e.g. user typed "Toronto DC" in the picker query). */
  initialName?: string;
  /** Modal title override - defaults to "Add Location". */
  title?: string;
}

export default function CreateLocationModal({
  visible,
  onCreated,
  onClose,
  initialName = '',
  title = 'Add Location',
}: CreateLocationModalProps) {
  const [name, setName] = useState(initialName);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset whenever the modal hides / shows so a previous half-typed
  // entry doesn't leak into the next open.
  React.useEffect(() => {
    if (visible) {
      setName(initialName || '');
      setCity('');
      setState('');
      setZip('');
      setSaving(false);
    }
  }, [visible, initialName]);

  const handleSave = async () => {
    if (saving) return;
    const input = { name, city, state, zip };
    const errors = validateNewLocation(input);
    if (errors.length) {
      Alert.alert('Check the form', errors.join('\n'));
      return;
    }
    setSaving(true);
    try {
      const created = await createLocation(input);
      onCreated(created);
    } catch (e: any) {
      Alert.alert('Could not save location', e?.message || 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{title}</Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
              disabled={saving}
            >
              <Ionicons name="close" size={24} color={colors.text2} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Field
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Dallas DC"
              autoCapitalize="words"
            />
            <Field
              label="City"
              value={city}
              onChangeText={setCity}
              placeholder="e.g. Dallas"
              autoCapitalize="words"
            />
            <View style={styles.row}>
              <View style={styles.flex}>
                <Field
                  label="State"
                  value={state}
                  onChangeText={(v) => setState(v.toUpperCase())}
                  placeholder="TX"
                  maxLength={2}
                  autoCapitalize="characters"
                />
              </View>
              <View style={styles.flex}>
                <Field
                  label="ZIP"
                  value={zip}
                  onChangeText={setZip}
                  placeholder="75207"
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>
            <Text style={styles.hint}>
              At least a Name or City is required. State must be a 2-letter
              code; ZIP must be 5 digits.
            </Text>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={onClose}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.btnPrimaryText}>Save Location</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  ...props
}: any) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.text3}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.lg,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  body: {
    padding: spacing.lg,
  },
  fieldWrap: { marginBottom: spacing.md },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg2,
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
  hint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  btn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnSecondary: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
  btnDisabled: { opacity: 0.6 },
});
