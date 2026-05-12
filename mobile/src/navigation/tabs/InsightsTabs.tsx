import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { InsightsTabParamList } from '../types';
import AnalyticsScreen from '../../screens/analytics/AnalyticsScreen';
import AlertsScreen from '../../screens/alerts/AlertsScreen';
import ReportsScreen from '../../screens/reports/ReportsScreen';
// QA P207 (2026-05-11): both Insights placeholders are now real
// screens. NetworkModelingScreen is a read-only lane benchmark view
// (scenario authoring stays on the web); DbExplorerScreen is a
// mobile-appropriate landing — raw SQL editing remains web-only by
// design but the screen provides quick-jump cards into the most-used
// tables so the drawer entry isn't a dead-end.
import NetworkModelingScreen from '../../screens/network/NetworkModelingScreen';
import DbExplorerScreen from '../../screens/analytics/DbExplorerScreen';

const Stack = createNativeStackNavigator<InsightsTabParamList>();

export default function InsightsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="Analytics" component={AnalyticsScreen} />
      <Stack.Screen name="Alerts" component={AlertsScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
      <Stack.Screen name="NetworkModeling" component={NetworkModelingScreen} />
      <Stack.Screen name="DbExplorer" component={DbExplorerScreen} />
    </Stack.Navigator>
  );
}
