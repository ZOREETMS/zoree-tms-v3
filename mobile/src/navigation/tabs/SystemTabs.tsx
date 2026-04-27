/**
 * System tab — Settings, Profile, and admin screens like Equipment
 * Master. Previously this drawer slot was a placeholder; turning it
 * into a real stack lets us hang Phase-3 admin surfaces off it
 * without crowding the planning / finance tabs.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SystemTabParamList } from '../types';
import EquipmentMasterScreen from '../../screens/equipment/EquipmentMasterScreen';
import PlanningParametersScreen from '../../screens/admin/PlanningParametersScreen';
import PlaceholderScreen from '../../screens/PlaceholderScreen';

const Stack = createNativeStackNavigator<SystemTabParamList>();

export default function SystemStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Settings">
        {() => <PlaceholderScreen title="Settings" icon="⚙️" />}
      </Stack.Screen>
      <Stack.Screen name="Profile">
        {() => <PlaceholderScreen title="Profile" icon="👤" />}
      </Stack.Screen>
      <Stack.Screen name="EquipmentMaster" component={EquipmentMasterScreen} />
      <Stack.Screen name="PlanningParameters" component={PlanningParametersScreen} />
    </Stack.Navigator>
  );
}
