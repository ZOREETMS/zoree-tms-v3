import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { FinanceTabParamList } from '../types';
import InvoicesScreen from '../../screens/freight/InvoicesScreen';
import FreightAuditScreen from '../../screens/freight/FreightAuditScreen';
import RateManagementScreen from '../../screens/rates/RateManagementScreen';
import EditRateScreen from '../../screens/rates/EditRateScreen';
import CarrierBidsScreen from '../../screens/bids/CarrierBidsScreen';
// QA #286 — Lane Preferences now has a real read-only screen, not a
// "Coming Soon" placeholder.
import LanePreferencesScreen from '../../screens/lanes/LanePreferencesScreen';

const Stack = createNativeStackNavigator<FinanceTabParamList>();

export default function FinanceStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="FreightInvoices" component={InvoicesScreen} />
      <Stack.Screen name="RateManagement" component={RateManagementScreen} />
      <Stack.Screen name="EditRate" component={EditRateScreen} />
      <Stack.Screen name="LanePreferences" component={LanePreferencesScreen} />
      <Stack.Screen name="CarrierBids" component={CarrierBidsScreen} />
      <Stack.Screen name="FreightAudit" component={FreightAuditScreen} />
    </Stack.Navigator>
  );
}
