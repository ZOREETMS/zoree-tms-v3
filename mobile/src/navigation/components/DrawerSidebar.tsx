/**
 * DrawerSidebar — full custom drawer content for the mobile app.
 *
 * Responsibilities (all delegated from AppNavigator so the navigator
 * file stays small and focused on Drawer.Navigator wiring):
 *   1. Render the brand header.
 *   2. Render the collapsible group list driven by drawerNavConfig.
 *   3. Drive cross-tab navigation through the React Navigation drawer
 *      props (nested navigate({ tab, screen })).
 *   4. Render the RoleSwitcher + footer (avatar / email / sign-out).
 *
 * State: a single "expanded group key" map. The currently active tab's
 * group is auto-expanded on first paint so the user sees the
 * sub-screen they're on without an extra tap.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import {
  DrawerContentScrollView,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../state/AuthContext';
import { colors, fontSize, fontWeight, spacing } from '../../theme';
import RoleSwitcher from '../../components/admin/RoleSwitcher';
import DrawerGroup from './DrawerGroup';
import {
  DRAWER_GROUPS,
  DrawerNavGroup,
  DrawerNavItem,
} from '../drawerNavConfig';
import { filterDrawerGroups } from '../drawerNavFilter';

/**
 * Resolve the currently focused drawer tab + nested screen from the
 * navigation state. React Navigation gives us a tree of nested states;
 * the drawer is always at the top.
 */
function useActiveRoute(props: DrawerContentComponentProps) {
  const { state } = props;
  return useMemo(() => {
    const activeDrawerRoute = state.routes[state.index];
    const activeTab = activeDrawerRoute?.name;
    // Nested stack state lives on `state` of the route. When the user
    // hasn't visited the nested stack yet it's undefined — we fall back
    // to the first child in the group so highlighting still works.
    const nestedState: any = (activeDrawerRoute as any)?.state;
    const activeScreen: string | undefined = nestedState?.routes
      ? nestedState.routes[nestedState.index ?? 0]?.name
      : undefined;
    return { activeTab, activeScreen };
  }, [state]);
}

function pickInitialExpandedKey(
  groups: DrawerNavGroup[],
  activeTab: string | undefined,
): string | null {
  // QA #331/#332/#338 — pass the role-filtered groups so a non-admin on
  // the Settings screen (activeTab === 'SystemTab') doesn't end up with
  // expandedKey = 'system' (a group that's been hidden for their role)
  // and a drawer rendered with nothing expanded.
  if (!groups.length) return null;
  if (!activeTab) return groups[0].key;
  const match = groups.find((g) => g.tab === activeTab);
  return match?.key ?? groups[0].key;
}

export default function DrawerSidebar(props: DrawerContentComponentProps) {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const initials = (user?.email || '').slice(0, 2).toUpperCase();
  const { activeTab, activeScreen } = useActiveRoute(props);

  // Mobile sign-out fix (2026-05-16): user reported the Sign Out button
  // was effectively unreachable — pinned at the very bottom of the
  // drawer and clipped behind the Android nav bar / iPhone home
  // indicator. We now route the press through a confirmation Alert
  // (parity with SettingsScreen.handleSignOut, which is the canonical
  // copy) so an accidental tap can't drop the session, and pad the
  // footer by the bottom safe-area inset (see styles.footer below).
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  // QA #303 — drawer items now filtered by the active role using the
  // same matrix the web side uses (see config/roleMatrix.ts). Before
  // this, every module rendered for every role. Re-derives whenever
  // the active role changes so optimistic role switches (QA #302) take
  // effect immediately.
  const activeRole = user?.activeRole || user?.role || '';
  const visibleGroups = useMemo(
    () => filterDrawerGroups(DRAWER_GROUPS, activeRole),
    [activeRole],
  );

  // Single-open accordion: only one group expanded at a time. Matches
  // the screenshot where most groups are collapsed and one is open.
  const [expandedKey, setExpandedKey] = useState<string | null>(() =>
    pickInitialExpandedKey(visibleGroups, activeTab),
  );

  const handleToggle = (group: DrawerNavGroup) => {
    setExpandedKey((cur) => (cur === group.key ? null : group.key));
  };

  const handleSelectItem = (item: DrawerNavItem) => {
    // React Navigation's nested navigate. `initial: false` ensures we
    // jump to the requested screen rather than always landing on the
    // stack's initialRoute.
    props.navigation.navigate(item.tab as never, {
      screen: item.screen,
      initial: false,
    } as never);
    // Close the drawer after a navigation so the user sees their
    // destination instead of staying on the menu.
    props.navigation.closeDrawer();
  };

  return (
    <View style={styles.container}>
      {/* Brand header */}
      <View style={styles.logoSection}>
        <Text style={styles.logoText}>zoree</Text>
        <Text style={styles.logoSub}>TMS PLATFORM  v3.11</Text>
      </View>

      {/* Collapsible group list — filtered by active role (QA #303). */}
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {visibleGroups.map((group) => (
          <DrawerGroup
            key={group.key}
            group={group}
            activeTab={activeTab}
            activeScreen={activeScreen}
            expanded={expandedKey === group.key}
            onToggle={() => handleToggle(group)}
            onSelectItem={handleSelectItem}
          />
        ))}
      </DrawerContentScrollView>

      {/* Active-role chip group (REQ-08 / QA P209) */}
      <RoleSwitcher />

      {/* User footer — paddingBottom is dynamic so the Sign Out button
          clears the home indicator / Android nav bar (mobile sign-out
          fix, 2026-05-16). Without this the button rendered behind the
          gesture bar on iPhone X+ and was effectively un-tappable. */}
      <View style={[styles.footer, { paddingBottom: spacing.lg + insets.bottom }]}>
        <View style={styles.userChip}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userEmail} numberOfLines={1}>
              {user?.email || 'Not signed in'}
            </Text>
            <Text style={styles.userRole}>
              {(user?.activeRole || user?.role || 'User')
                .toString()
                .replace(/^./, (c) => c.toUpperCase())}
            </Text>
          </View>
        </View>
        {/* Destructive red Sign Out — the previous muted-grey "Sign
            Out" pill blended into the dark sidebar and users couldn't
            spot it. Icon + bold red label mirror the SettingsScreen
            sign-out treatment so the two surfaces feel consistent. */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleSignOut}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Sign out">
          <Ionicons name="log-out-outline" size={20} color="#FCA5A5" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  logoSection: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['3xl'],
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  logoText: {
    fontWeight: fontWeight.extrabold,
    fontSize: fontSize['3xl'],
    color: '#FFFFFF',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  logoSub: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  scrollContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    padding: spacing.lg,
  },
  userChip: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: fontWeight.bold,
    fontSize: fontSize.sm,
  },
  userInfo: {
    flex: 1,
  },
  userEmail: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: '#FFFFFF',
  },
  userRole: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.45)',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.35)',
  },
  logoutText: {
    color: '#FCA5A5',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
