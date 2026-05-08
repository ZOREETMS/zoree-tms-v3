/**
 * BulkPlanStack — drawer-level stack for the Bulk Plan flow.
 *
 * Promoted out of PlanningTabs so Bulk Plan is a first-class drawer
 * entry (mirroring the web sidebar). Keeps BulkPlanResults inside the
 * same stack so the two screens share a back button and deep-link
 * cleanly.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BulkPlanTabParamList } from '../types';

import BulkPlanScreen from '../../screens/bulkplan/BulkPlanScreen';
import BulkPlanResultsScreen from '../../screens/bulkplan/BulkPlanResultsScreen';

const Stack = createNativeStackNavigator<BulkPlanTabParamList>();

export default function BulkPlanStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="BulkPlan" component={BulkPlanScreen} />
      <Stack.Screen name="BulkPlanResults" component={BulkPlanResultsScreen} />
    </Stack.Navigator>
  );
}
