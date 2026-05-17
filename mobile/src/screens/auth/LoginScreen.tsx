import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../../state/AuthContext';
import { API_BASE } from '../../config/env';
import { updateApiBase } from '../../lib/api';
import { storage } from '../../lib/storage';
import {
  borderRadius,
  colors,
  fontSize,
  fontWeight,
  spacing,
} from '../../theme';

export default function LoginScreen() {
  const auth = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Mobile session-expiry fix (2026-05-16): AuthContext writes a
  // one-shot 'zoree_session_expired' flag when api() forces a logout
  // after a 401 the refresh hook couldn't recover. Pick it up on first
  // paint, surface a friendly notice, then consume the flag so it
  // doesn't show up after a normal sign-out -> sign-in cycle.
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(
    () => storage.getItem('zoree_session_expired') === '1',
  );
  useEffect(() => {
    if (sessionExpiredNotice) {
      storage.removeItem('zoree_session_expired').catch(() => {});
    }
  }, [sessionExpiredNotice]);

  // Advanced: API endpoint override (for tunnel URL changes)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [apiEndpoint, setApiEndpoint] = useState(
    storage.getItem('zoree_api_base') || API_BASE || '',
  );
  const [apiSaved, setApiSaved] = useState(false);

  async function handleSaveApi() {
    const trimmed = (apiEndpoint || '').trim();
    if (!trimmed) {
      setError('Please enter an API endpoint.');
      return;
    }
    try {
      await updateApiBase(trimmed);
      setError('');
      setApiSaved(true);
      setTimeout(() => setApiSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || 'Failed to save endpoint.');
    }
  }

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Please enter both email and password.');
      return;
    }

    setError('');
    // Clear the session-expired notice the moment the user starts a
    // fresh sign-in attempt — leaving it up while we're already on the
    // way to a new session would be confusing.
    setSessionExpiredNotice(false);
    setLoading(true);

    try {
      await auth.login(email.trim(), password);
      // On success, RootNavigator auto-switches to AppNavigator
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ---- Branding ---- */}
          <View style={styles.brandRow}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoLetter}>Z</Text>
            </View>
            <Text style={styles.brandName}>zoree</Text>
          </View>
          <Text style={styles.subtitle}>TMS PLATFORM</Text>

          {/* ---- Card ---- */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign In</Text>
            <Text style={styles.cardDescription}>
              Enter your credentials to access the platform
            </Text>

            {/* Session-expired notice — shown once after an auto-logout
                triggered by a 401 on a save (mobile session-expiry
                fix, 2026-05-16). Uses a calmer info color than the
                red error banner because nothing is wrong per se. */}
            {sessionExpiredNotice && error === '' && (
              <View style={styles.noticeBanner}>
                <Text style={styles.noticeText}>
                  Your session expired. Please sign in again to continue.
                </Text>
              </View>
            )}

            {/* Error banner */}
            {error !== '' && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email */}
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@company.com"
              placeholderTextColor={colors.text3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />

            {/* Password */}
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor={colors.text3}
              secureTextEntry
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              editable={!loading}
              onSubmitEditing={handleLogin}
            />

            {/* Forgot password */}
            <TouchableOpacity
              style={styles.forgotRow}
              activeOpacity={0.7}
              disabled={loading}
            >
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>

            {/* Login button */}
            <TouchableOpacity
              style={[styles.loginButton, loading && styles.loginButtonDisabled]}
              activeOpacity={0.8}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.loginButtonText}>Sign In</Text>
              )}
            </TouchableOpacity>

            {/* Advanced: API endpoint override */}
            <TouchableOpacity
              style={styles.advancedToggle}
              activeOpacity={0.7}
              onPress={() => setShowAdvanced(v => !v)}
            >
              <Text style={styles.advancedToggleText}>
                {showAdvanced ? 'Hide advanced' : 'Advanced settings'}
              </Text>
            </TouchableOpacity>

            {showAdvanced && (
              <View style={styles.advancedSection}>
                <Text style={styles.label}>API Endpoint</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://example.trycloudflare.com/api"
                  placeholderTextColor={colors.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  value={apiEndpoint}
                  onChangeText={setApiEndpoint}
                  editable={!loading}
                />
                <TouchableOpacity
                  style={styles.saveApiButton}
                  activeOpacity={0.8}
                  onPress={handleSaveApi}
                  disabled={loading}
                >
                  <Text style={styles.saveApiButtonText}>
                    {apiSaved ? 'Saved \u2713' : 'Save Endpoint'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ---- Footer ---- */}
          <Text style={styles.footer}>
            {'\u00A9'} {new Date().getFullYear()} Zoree Technologies. All rights
            reserved.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.loginBg,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing['5xl'],
  },

  /* Branding */
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  logoCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  logoLetter: {
    color: colors.white,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  brandName: {
    color: colors.white,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
  },
  subtitle: {
    color: colors.text3,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    letterSpacing: 3,
    marginBottom: spacing['3xl'],
  },

  /* Card */
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.loginCard,
    borderRadius: borderRadius.xl,
    padding: spacing['3xl'],
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardTitle: {
    color: colors.white,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  cardDescription: {
    color: colors.text3,
    fontSize: fontSize.md,
    marginBottom: spacing.xl,
  },

  /* Error banner */
  errorBanner: {
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.3)',
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: fontSize.sm,
  },

  /* Session-expired notice (info, not error) */
  noticeBanner: {
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeText: {
    color: '#93C5FD',
    fontSize: fontSize.sm,
  },

  /* Form fields */
  label: {
    color: colors.text3,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: 'rgba(15,23,42,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: borderRadius.sm,
    color: colors.white,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
  },

  /* Forgot password */
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
  },
  forgotText: {
    color: colors.loginAccent,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },

  /* Login button */
  loginButton: {
    backgroundColor: colors.loginGradientStart,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    // Approximate the purple gradient with a single dominant color;
    // for a true gradient use expo-linear-gradient if available.
    shadowColor: colors.loginGradientEnd,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },

  /* Advanced section */
  advancedToggle: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  advancedToggleText: {
    color: colors.text3,
    fontSize: fontSize.sm,
    textDecorationLine: 'underline',
  },
  advancedSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  saveApiButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  saveApiButtonText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },

  /* Footer */
  footer: {
    color: colors.text3,
    fontSize: fontSize.xs,
    marginTop: spacing['3xl'],
    textAlign: 'center',
  },
});
