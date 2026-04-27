import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ExecutionTabParamList } from '../types';
import CarriersScreen from '../../screens/carriers/CarriersScreen';
import CarrierDetailScreen from '../../screens/carriers/CarrierDetailScreen';
import CarrierPortalScreen from '../../screens/carriers/CarrierPortalScreen';
import LiveTrackingScreen from '../../screens/tracking/LiveTrackingScreen';
import FleetScreen from '../../screens/fleet/FleetScreen';
import ComplianceScreen from '../../screens/compliance/ComplianceScreen';
import DockSchedulingScreen from '../../screens/dock/DockSchedulingScreen';
import PlaceholderScreen from '../../screens/PlaceholderScreen';

const Stack = createNativeStackNavigator<ExecutionTabParamList>();

export default function ExecutionStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="LiveTracking" component={LiveTrackingScreen} />
      <Stack.Screen name="Carriers" component={CarriersScreen} />
      <Stack.Screen name="CarrierDetail" component={CarrierDetailScreen} />
      <Stack.Screen name="CarrierPortal" component={CarrierPortalScreen} />
      <Stack.Screen name="DockScheduling" component={DockSchedulingScreen} />
      <Stack.Screen name="FleetManagement" component={FleetScreen} />
      <Stack.Screen name="Compliance" component={ComplianceScreen} />
    </Stack.Navigator>
  );
}
