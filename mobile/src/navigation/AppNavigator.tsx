/**
 * AppNavigator — the authenticated drawer navigator.
 *
 * Per the 2026-05-13 product mockups the drawer is now a collapsible
 * group list rather than a flat row-per-screen layout. The actual
 * group/child wiring lives in `drawerNavConfig.ts`, the visual row
 * lives in `components/DrawerGroup.tsx`, and the side-panel container
 * lives in `components/DrawerSidebar.tsx`. This file deliberately
 * stays small and concerned only with Drawer.Navigator setup, in line
 * with the modular-structure rule from docs/CLAUDE_RULES.md.
 *
 * IMPORTANT: every Drawer.Screen below MUST remain registered — the
 * DrawerSidebar performs nested navigate({ tab, screen }) calls into
 * each of these stacks. Removing one of these screens will break the
 * corresponding group entries in `drawerNavConfig.ts`. The Drawer
 * surface itself is hidden by setting `drawerItemStyle: display:none`
 * so the default DrawerItemList does not render alongside the
 * collapsible groups.
 */
import React from 'react';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Text } from 'react-native';
import { DrawerParamList } from './types';
import { colors, fontSize, fontWeight } from '../theme';

import OverviewStack from './tabs/OverviewTabs';
import PlanningStack from './tabs/PlanningTabs';
import BulkPlanStack from './tabs/BulkPlanTabs';
import MultiStopStack from './tabs/MultiStopTabs';
import ExecutionStack from './tabs/ExecutionTabs';
import FinanceStack from './tabs/FinanceTabs';
import DocumentsStack from './tabs/DocumentsTabs';
import IntegrationStack from './tabs/IntegrationTabs';
import InsightsStack from './tabs/InsightsTabs';
import SystemStack from './tabs/SystemTabs';

import DrawerSidebar from './components/DrawerSidebar';

const Drawer = createDrawerNavigator<DrawerParamList>();

export default function AppNavigator() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <DrawerSidebar {...props} />}
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
        drawerStyle: {
          backgroundColor: '#0F172A',
          width: 300,
        },
        // Hide the default flat-row list — DrawerSidebar renders the
        // collapsible group UI in its place.
        drawerItemStyle: { display: 'none' },
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
