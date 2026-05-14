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
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import {
  DrawerContentScrollView,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { useAuth } from '../../state/AuthContext';
import { colors, fontSize, fontWeight, spacing } from '../../theme';
import RoleSwitcher from '../../components/admin/RoleSwitcher';
import DrawerGroup from './DrawerGroup';
import {
  DRAWER_GROUPS,
  DrawerNavGroup,
  DrawerNavItem,
} from '../drawerNavConfig';

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

function pickInitialExpandedKey(activeTab: string | undefined): string | null {
  if (!activeTab) return DRAWER_GROUPS[0]?.key ?? null;
  const match = DRAWER_GROUPS.find((g) => g.tab === activeTab);
  return match?.key ?? DRAWER_GROUPS[0]?.key ?? null;
}

export default function DrawerSidebar(props: DrawerContentComponentProps) {
  const { user, logout } = useAuth();
  const initials = (user?.email || '').slice(0, 2).toUpperCase();
  const { activeTab, activeScreen } = useActiveRoute(props);

  // Single-open accordion: only one group expanded at a time. Matches
  // the screenshot where most groups are collapsed and one is open.
  const [expandedKey, setExpandedKey] = useState<string | null>(() =>
    pickInitialExpandedKey(activeTab),
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

      {/* Collapsible group list */}
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {DRAWER_GROUPS.map((group) => (
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

      {/* User footer */}
      <View style={styles.footer}>
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
        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
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
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  logoutText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    textTransform: 'uppercase',
  },
});
