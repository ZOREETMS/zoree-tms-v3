import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { FinanceTabParamList } from '../types';
import InvoicesScreen from '../../screens/freight/InvoicesScreen';
import FreightAuditScreen from '../../screens/freight/FreightAuditScreen';
import RateManagementScreen from '../../screens/rates/RateManagementScreen';
import CarrierBidsScreen from '../../screens/bids/CarrierBidsScreen';
import PlaceholderScreen from '../../screens/PlaceholderScreen';

const Stack = createNativeStackNavigator<FinanceTabParamList>();

export default function FinanceStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="FreightInvoices" component={InvoicesScreen} />
      <Stack.Screen name="RateManagement" component={RateManagementScreen} />
      <Stack.Screen name="LanePreferences">
        {() => <PlaceholderScreen title="Lane Preferences" icon="⭐" />}
      </Stack.Screen>
      <Stack.Screen name="CarrierBids" component={CarrierBidsScreen} />
      <Stack.Screen name="FreightAudit" component={FreightAuditScreen} />
    </Stack.Navigator>
  );
}
