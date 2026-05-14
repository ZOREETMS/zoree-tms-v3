import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
// useNavigation + the isAdmin gate were used by the old "Admin"
// shortcut card removed under QA #301 — no remaining call sites in
// this file.

import Card from '../../components/ui/Card';
import { useAuth } from '../../state/AuthContext';
import { API_BASE, APP_VERSION, APP_NAME } from '../../config/env';
import { updateApiBase } from '../../lib/api';
import { storage } from '../../lib/storage';
import {
  colors,
  fontSize,
  fontWeight,
  spacing,
  borderRadius,
} from '../../theme';

export default function SettingsScreen() {
  const { user, logout } = useAuth();

  // Notification preferences (local state placeholders)
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  // API endpoint configuration — load saved override (if any), fall back to default
  const [apiEndpoint, setApiEndpoint] = useState(
    storage.getItem('zoree_api_base') || API_BASE || '',
  );
  const [savingApi, setSavingApi] = useState(false);

  const handleSaveApi = async () => {
    const trimmed = (apiEndpoint || '').trim();
    if (!trimmed) {
      Alert.alert('Invalid URL', 'Please enter an API endpoint.');
      return;
    }
    try {
      setSavingApi(true);
      await updateApiBase(trimmed);
      Alert.alert(
        'Saved',
        'API endpoint updated. Sign out and back in for changes to take effect everywhere.',
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to save endpoint.');
    } finally {
      setSavingApi(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: () => logout(),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
        </View>

        {/* User Profile */}
        <Card style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={28} color={colors.white} />
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>
                {user?.full_name ||
                  user?.user_metadata?.full_name ||
                  user?.email ||
                  'User'}
              </Text>
              <Text style={styles.profileEmail}>{user?.email || '--'}</Text>
              <View style={styles.roleBadge}>
                <Text style={styles.roleText}>
                  {user?.activeRole || user?.role || 'User'}
                </Text>
              </View>
            </View>
          </View>
        </Card>

        {/*
          QA #301 (2026-05-14): the in-Settings "Admin" shortcut card
          previously duplicated nav rows for User Management, User
          Roles, Equipment Master, and Planning Parameters. After QA
          #298 / #277 those are first-class entries in the drawer (the
          System group exposes User Management + User Roles + Settings,
          and Planning Parameters + Equipment Master live under the
          Planning group). Keeping the duplicate card here made the
          Settings page feel like a second nav surface — the QA spec
          calls for a clean Settings page that matches the web's
          (Account Info / API Config / Integrations). The drawer is
          now the single source of truth for those jumps, so this
          section is removed.
         */}

        {/* Notification Preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <Card>
            <View style={styles.settingRow}>
              <View style={styles.settingLabel}>
                <Ionicons
                  name="notifications-outline"
                  size={20}
                  color={colors.text2}
                />
                <Text style={styles.settingText}>Push Notifications</Text>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={setPushEnabled}
                trackColor={{
                  false: colors.border,
                  true: colors.accent,
                }}
                thumbColor={colors.white}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.settingRow}>
              <View style={styles.settingLabel}>
                <Ionicons
                  name="mail-outline"
                  size={20}
                  color={colors.text2}
                />
                <Text style={styles.settingText}>Email Notifications</Text>
              </View>
              <Switch
                value={emailNotifs}
                onValueChange={setEmailNotifs}
                trackColor={{
                  false: colors.border,
                  true: colors.accent,
                }}
                thumbColor={colors.white}
              />
            </View>
          </Card>
        </View>

        {/* App Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App Settings</Text>
          <Card>
            <View style={styles.settingRow}>
              <View style={styles.settingLabel}>
                <Ionicons
                  name="moon-outline"
                  size={20}
                  color={colors.text2}
                />
                <View>
                  <Text style={styles.settingText}>Dark Mode</Text>
                  <Text style={styles.settingHint}>Coming soon</Text>
                </View>
              </View>
              <Switch
                value={darkMode}
                onValueChange={setDarkMode}
                trackColor={{
                  false: colors.border,
                  true: colors.accent,
                }}
                thumbColor={colors.white}
                disabled
              />
            </View>
          </Card>
        </View>

        {/* API Configuration */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>API Configuration</Text>
          <Card>
            <Text style={styles.fieldLabel}>API Endpoint</Text>
            <TextInput
              style={styles.textInput}
              value={apiEndpoint}
              onChangeText={setApiEndpoint}
              placeholder="https://api.example.com/api"
              placeholderTextColor={colors.text3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity
              style={[
                styles.saveApiButton,
                savingApi && styles.saveApiButtonDisabled,
              ]}
              onPress={handleSaveApi}
              disabled={savingApi}>
              <Text style={styles.saveApiButtonText}>
                {savingApi ? 'Saving...' : 'Save Endpoint'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.fieldHint}>
              Sign out and back in for changes to apply everywhere.
            </Text>
          </Card>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Card>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>App Name</Text>
              <Text style={styles.aboutValue}>{APP_NAME}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>{APP_VERSION}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Platform</Text>
              <Text style={styles.aboutValue}>React Native / Expo</Text>
            </View>
          </Card>
        </View>

        {/* Sign Out */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.signOutButton}
            activeOpacity={0.7}
            onPress={handleSignOut}>
            <Ionicons name="log-out-outline" size={20} color={colors.red} />
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing['5xl'],
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  profileCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.lg,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  profileEmail: {
    fontSize: fontSize.sm,
    color: colors.text2,
    marginTop: 2,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentGlow,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    marginTop: spacing.sm,
  },
  roleText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
    textTransform: 'capitalize',
  },
  section: {
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  settingLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  settingText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  settingHint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  fieldLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text2,
    marginBottom: spacing.sm,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  saveApiButton: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveApiButtonDisabled: {
    opacity: 0.5,
  },
  saveApiButtonText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  fieldHint: {
    fontSize: fontSize.xs,
    color: colors.text3,
    marginTop: spacing.xs,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  aboutLabel: {
    fontSize: fontSize.md,
    color: colors.text2,
  },
  aboutValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.redDim,
    backgroundColor: colors.bg2,
  },
  signOutText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.red,
  },
});
