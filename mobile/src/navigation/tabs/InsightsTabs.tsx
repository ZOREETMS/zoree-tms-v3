import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { InsightsTabParamList } from '../types';
import AnalyticsScreen from '../../screens/analytics/AnalyticsScreen';
import AlertsScreen from '../../screens/alerts/AlertsScreen';
import ReportsScreen from '../../screens/reports/ReportsScreen';
import PlaceholderScreen from '../../screens/PlaceholderScreen';

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
      <Stack.Screen name="NetworkModeling">
        {() => <PlaceholderScreen title="Network Modeling" icon="🌐" />}
      </Stack.Screen>
      <Stack.Screen name="DbExplorer">
        {() => <PlaceholderScreen title="DB Explorer" icon="🗄️" />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
