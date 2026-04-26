/**
 * EditRateScreen — full create / edit form for a single rate row.
 *
 * Mirrors frontend/src/components/EditRateModal.jsx but rendered as a
 * native stack screen. Owns form state; delegates field rendering to
 * the section components and persistence to rateService.
 *
 * Routes here from RateManagementScreen via either:
 *   - FAB     → navigation.navigate('EditRate', { mode: 'create' })
 *   - Edit    → navigation.navigate('EditRate', { mode: 'edit', rateId })
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useData } from '../../state/DataContext';
import {
  applyRateFieldChange,
  buildInitialRateForm,
  buildRatePayload,
  saveRate,
  validateRateForm,
  type RateFormState,
} from '../../services/rateService';
import RateLaneSection from '../../components/rates/RateLaneSection';
import RateLocationSection from '../../components/rates/RateLocationSection';
import RatePricingSection from '../../components/rates/RatePricingSection';
import RateLogisticsSection from '../../components/rates/RateLogisticsSection';
import RateLtlSection from '../../components/rates/RateLtlSection';
import { colors, fontSize, fontWeight, spacing, borderRadius } from '../../theme';
import type { FinanceTabParamList } from '../../navigation/types';

type EditRateRoute = RouteProp<FinanceTabParamList, 'EditRate'>;

export default function EditRateScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<EditRateRoute>();
  const params = route.params || ({} as any);
  const isNew = params.mode === 'create' || !params.rateId;

  const { data, refreshData } = useData();

  // Look up the rate row when editing.
  const sourceRate = useMemo(() => {
    if (isNew) return null;
    return data.rates.find(
      (r: any) => (r.id ?? r.rate_id ?? r.lane)?.toString() === String(params.rateId),
    );
  }, [data.rates, isNew, params.rateId]);

  const [form, setForm] = useState<RateFormState>(() => buildInitialRateForm(sourceRate));
  const [busy, setBusy] = useState(false);

  // Re-seed when the underlying row arrives after the screen mounts (data
  // can finish loading after navigation).
  useEffect(() => {
    if (!isNew && sourceRate) {
      setForm(buildInitialRateForm(sourceRate));
    }
  }, [isNew, sourceRate]);

  const setField = useCallback(
    <K extends keyof RateFormState>(key: K, value: RateFormState[K]) => {
      setForm((f) => applyRateFieldChange(f, key, value));
    },
    [],
  );

  const existingLanes = useMemo(
    () => data.rates.map((r: any) => r.lane).filter(Boolean) as string[],
    [data.rates],
  );

  const handleSave = useCallback(async () => {
    const result = validateRateForm(form, { isNew, existingLanes });
    if (result.patchedForm) {
      // Lock the auto-generated lane back into form state so the user
      // sees what was saved if they navigate back.
      setForm(result.patchedForm);
    }
    if (!result.ok) {
      Alert.alert('Save failed', result.error || 'Please fix the highlighted fields and try again.');
      return;
    }
    setBusy(true);
    try {
      const payload = buildRatePayload(result.patchedForm || form);
      const sourceId = sourceRate?.id || sourceRate?.rate_id || null;
      await saveRate(sourceId, payload, isNew);
      await refreshData();
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save rate');
    } finally {
      setBusy(false);
    }
  }, [form, isNew, existingLanes, sourceRate, refreshData, navigation]);

  const title = isNew ? 'Add Rate' : `Edit Rate${form.lane ? ' — ' + form.lane : ''}`;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          disabled={busy}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <RateLaneSection
          form={form}
          onChange={setField}
          equipmentTypes={(data as any).equipmentTypes}
        />
        <RateLocationSection form={form} onChange={setField} />
        <RatePricingSection form={form} onChange={setField} carriers={data.carriers as any} />
        <RateLogisticsSection form={form} onChange={setField} />
        <RateLtlSection form={form} onChange={setField} />

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.btn, styles.btnGhost]}
            onPress={() => navigation.goBack()}
            disabled={busy}
            activeOpacity={0.7}
          >
            <Text style={styles.btnGhostText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
            onPress={handleSave}
            disabled={busy}
            activeOpacity={0.7}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color={colors.white} />
                <Text style={styles.btnPrimaryText}>Save Rate</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    padding: spacing.xs,
    marginRight: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  headerSpacer: {
    width: 24,
  },
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
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
  btnGhost: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhostText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  btnPrimaryText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
});
