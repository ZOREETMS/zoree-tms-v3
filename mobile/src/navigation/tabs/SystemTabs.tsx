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
import SettingsScreen from '../../screens/settings/SettingsScreen';
// QA P208 remainder (2026-05-11): the original P208 fix wired
// SettingsScreen only and left UserManagement / UserRoles as TODOs.
// Both screens now ship — they pull from UsersApi / AuthApi.roles
// (added to mobile/src/shared/api.js) and the underlying endpoints
// are the same ones the web's UserManagementPage + UserRolesPage hit.
import UserManagementScreen from '../../screens/admin/UserManagementScreen';
import UserDetailScreen from '../../screens/admin/UserDetailScreen';
import UserRolesScreen from '../../screens/admin/UserRolesScreen';
import PlaceholderScreen from '../../screens/PlaceholderScreen';

const Stack = createNativeStackNavigator<SystemTabParamList>();

export default function SystemStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Profile">
        {() => <PlaceholderScreen title="Profile" icon="👤" />}
      </Stack.Screen>
      <Stack.Screen name="EquipmentMaster" component={EquipmentMasterScreen} />
      <Stack.Screen name="PlanningParameters" component={PlanningParametersScreen} />
      <Stack.Screen name="UserManagement" component={UserManagementScreen} />
      <Stack.Screen name="UserDetail" component={UserDetailScreen} />
      <Stack.Screen name="UserRoles" component={UserRolesScreen} />
    </Stack.Navigator>
  );
}
