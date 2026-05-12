import React from 'react';
import {
  createDrawerNavigator,
  DrawerContentScrollView,
  DrawerItemList,
  DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DrawerParamList } from './types';
import { useAuth } from '../state/AuthContext';
import { colors, fontSize, fontWeight, spacing } from '../theme';

import OverviewStack from './tabs/OverviewTabs';
import PlanningStack from './tabs/PlanningTabs';
import BulkPlanStack from './tabs/BulkPlanTabs';
import MultiStopStack from './tabs/MultiStopTabs';
import ExecutionStack from './tabs/ExecutionTabs';
import FinanceStack from './tabs/FinanceTabs';
// QA P205 / P206 (2026-05-11): Documents and Integration were
// previously inline <PlaceholderScreen> drawer entries; the underlying
// screens (DocumentsScreen, CustomerPortalScreen, MessagingScreen)
// already exist. Wire them via real stacks so the QA-reported
// "module not available" complaints are addressed.
import DocumentsStack from './tabs/DocumentsTabs';
import IntegrationStack from './tabs/IntegrationTabs';
import InsightsStack from './tabs/InsightsTabs';
import SystemStack from './tabs/SystemTabs';
// QA P209 (2026-05-11): Active-role switcher in the drawer footer
// mirrors web parity (REQ-08). Hidden when the user has <2 assigned
// roles, so single-role accounts see no change.
import RoleSwitcher from '../components/admin/RoleSwitcher';

const Drawer = createDrawerNavigator<DrawerParamList>();

function CustomDrawerContent(props: DrawerContentComponentProps) {
  const { user, logout } = useAuth();
  const initials = (user?.email || '').slice(0, 2).toUpperCase();

  return (
    <View style={styles.drawerContainer}>
      {/* Logo Header */}
      <View style={styles.logoSection}>
        <Text style={styles.logoText}>zoree</Text>
        <Text style={styles.logoSub}>TMS PLATFORM  v3.11</Text>
      </View>

      {/* Navigation Items */}
      <DrawerContentScrollView {...props} contentContainerStyle={styles.scrollContent}>
        <DrawerItemList {...props} />
      </DrawerContentScrollView>

      {/* Active role switcher (QA P209). Renders only when the
          signed-in user has 2+ assigned roles, so single-role
          accounts see the previous footer layout unchanged. */}
      <RoleSwitcher />

      {/* User Footer */}
      <View style={styles.footer}>
        <View style={styles.userChip}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userEmail} numberOfLines={1}>
              {user?.email || 'Not signed in'}
            </Text>
            {/* QA P209: reflect the user's active role instead of the
                hard-coded 'Admin' string. Falls back gracefully when
                the field isn't populated (old token / pre-REQ-08). */}
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

export default function AppNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawerContent {...props} />}
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.bg2,
          elevation: 1,
          shadowOpacity: 0.1,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontWeight: fontWeight.semibold,
          fontSize: fontSize.lg,
          textTransform: 'uppercase',
        },
        drawerActiveTintColor: colors.accent,
        drawerInactiveTintColor: colors.text2,
        drawerLabelStyle: {
          fontSize: fontSize.md,
          fontWeight: fontWeight.medium,
          textTransform: 'uppercase',
        },
        drawerStyle: {
          backgroundColor: '#0F172A',
          width: 280,
        },
        drawerActiveBackgroundColor: 'rgba(37,99,235,0.15)',
      }}>
      <Drawer.Screen
        name="OverviewTab"
        component={OverviewStack}
        options={{ title: 'Overview', drawerIcon: () => <Text>📊</Text> }}
      />
      <Drawer.Screen
        name="PlanningTab"
        component={PlanningStack}
        options={{ title: 'Planning', drawerIcon: () => <Text>🧾</Text> }}
      />
      <Drawer.Screen
        name="BulkPlanTab"
        component={BulkPlanStack}
        options={{ title: 'Bulk Plan', drawerIcon: () => <Text>⚡</Text> }}
      />
      <Drawer.Screen
        name="MultiStopTab"
        component={MultiStopStack}
        options={{ title: 'Multi-Stop Routes', drawerIcon: () => <Text>🛣️</Text> }}
      />
      <Drawer.Screen
        name="ExecutionTab"
        component={ExecutionStack}
        options={{ title: 'Execution', drawerIcon: () => <Text>📡</Text> }}
      />
      <Drawer.Screen
        name="FinanceTab"
        component={FinanceStack}
        options={{ title: 'Finance', drawerIcon: () => <Text>💰</Text> }}
      />
      <Drawer.Screen
        name="DocumentsTab"
        component={DocumentsStack}
        options={{ title: 'Documents', drawerIcon: () => <Text>📄</Text> }}
      />
      <Drawer.Screen
        name="IntegrationTab"
        component={IntegrationStack}
        options={{ title: 'Integration', drawerIcon: () => <Text>📨</Text> }}
      />
      <Drawer.Screen
        name="InsightsTab"
        component={InsightsStack}
        options={{ title: 'Insights', drawerIcon: () => <Text>📈</Text> }}
      />
      <Drawer.Screen
        name="SystemTab"
        component={SystemStack}
        options={{ title: 'Settings', drawerIcon: () => <Text>⚙️</Text> }}
      />
    </Drawer.Navigator>
  );
}

const styles = StyleSheet.create({
  drawerContainer: {
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
