import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PlanningTabParamList } from '../types';
import OrdersScreen from '../../screens/orders/OrdersScreen';
import OrderDetailScreen from '../../screens/orders/OrderDetailScreen';
import ShipmentsScreen from '../../screens/shipments/ShipmentsScreen';
import ShipmentDetailScreen from '../../screens/shipments/ShipmentDetailScreen';
import LocationsScreen from '../../screens/locations/LocationsScreen';
import LocationDetailScreen from '../../screens/locations/LocationDetailScreen';
import PlaceholderScreen from '../../screens/PlaceholderScreen';

const Stack = createNativeStackNavigator<PlanningTabParamList>();

export default function PlanningStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="Orders" component={OrdersScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <Stack.Screen name="Shipments" component={ShipmentsScreen} />
      <Stack.Screen name="ShipmentDetail" component={ShipmentDetailScreen} />
      <Stack.Screen name="ItemMaster">
        {() => <PlaceholderScreen title="Item Master" icon="📦" />}
      </Stack.Screen>
      <Stack.Screen name="LocationMaster" component={LocationsScreen} />
      <Stack.Screen name="LocationDetail" component={LocationDetailScreen} />
      <Stack.Screen name="RouteOptimizer">
        {() => <PlaceholderScreen title="Route Optimizer" icon="🗺️" />}
      </Stack.Screen>
      <Stack.Screen name="BulkPlan">
        {() => <PlaceholderScreen title="Bulk Plan" icon="⚡" />}
      </Stack.Screen>
      <Stack.Screen name="MultiStopRoutes">
        {() => <PlaceholderScreen title="Multi-Stop Routes" icon="🛣️" />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
