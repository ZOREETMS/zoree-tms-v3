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
// QA P208 (2026-05-11): SystemTabs previously hung an inline
// PlaceholderScreen off the Settings route, so the "Settings" entry in
// the drawer drilled into an empty placeholder despite a real
// SettingsScreen existing in mobile/src/screens/settings. Wire it up
// here. UserManagement and UserRoles remain plan-only (no screens
// shipped yet — see docs/p1_bug_triage_2026-05-11.md P208 entry).
import SettingsScreen from '../../screens/settings/SettingsScreen';
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
    </Stack.Navigator>
  );
}
