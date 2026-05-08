/**
 * MultiStopStack — drawer-level stack for multi-stop route templates.
 *
 * Currently a single screen; lives in its own stack so the drawer can
 * pass `selectedOrderIds` params (set from OrdersScreen's "Create
 * Multi-Stop Route" action) and so future screens (per-route detail,
 * execute history) can land here without disturbing the drawer.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MultiStopTabParamList } from '../types';

import MultiStopRoutesScreen from '../../screens/routes/MultiStopRoutesScreen';

const Stack = createNativeStackNavigator<MultiStopTabParamList>();

export default function MultiStopStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MultiStopRoutes" component={MultiStopRoutesScreen} />
    </Stack.Navigator>
  );
}
