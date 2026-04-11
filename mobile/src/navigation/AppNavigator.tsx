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
import ExecutionStack from './tabs/ExecutionTabs';
import FinanceStack from './tabs/FinanceTabs';
import InsightsStack from './tabs/InsightsTabs';
import PlaceholderScreen from '../screens/PlaceholderScreen';

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
            <Text style={styles.userRole}>Admin</Text>
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
        options={{ title: 'Documents', drawerIcon: () => <Text>📄</Text> }}>
        {() => <PlaceholderScreen title="Documents & BOL" icon="📄" />}
      </Drawer.Screen>
      <Drawer.Screen
        name="IntegrationTab"
        options={{ title: 'Integration', drawerIcon: () => <Text>📨</Text> }}>
        {() => <PlaceholderScreen title="Messaging Hub" icon="📨" />}
      </Drawer.Screen>
      <Drawer.Screen
        name="InsightsTab"
        component={InsightsStack}
        options={{ title: 'Insights', drawerIcon: () => <Text>📈</Text> }}
      />
      <Drawer.Screen
        name="SystemTab"
        options={{ title: 'Settings', drawerIcon: () => <Text>⚙️</Text> }}>
        {() => <PlaceholderScreen title="Settings" icon="⚙️" />}
      </Drawer.Screen>
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
