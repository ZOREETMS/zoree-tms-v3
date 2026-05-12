import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PlanningTabParamList } from '../types';

// Order screens
import OrdersScreen from '../../screens/orders/OrdersScreen';
import OrderDetailScreen from '../../screens/orders/OrderDetailScreen';
import OrderFormScreen from '../../screens/orders/OrderFormScreen';

// Shipment screens
import ShipmentsScreen from '../../screens/shipments/ShipmentsScreen';
import ShipmentDetailScreen from '../../screens/shipments/ShipmentDetailScreen';

// Location screens
import LocationsScreen from '../../screens/locations/LocationsScreen';
import LocationDetailScreen from '../../screens/locations/LocationDetailScreen';
import LocationFormScreen from '../../screens/locations/LocationFormScreen';

// Item screens
import ItemMasterScreen from '../../screens/items/ItemMasterScreen';
import ItemDetailScreen from '../../screens/items/ItemDetailScreen';
import ItemFormScreen from '../../screens/items/ItemFormScreen';

// Bulk Plan and Multi-Stop Routes have been promoted to their own
// drawer-level stacks (BulkPlanTabs / MultiStopTabs). They're no
// longer registered here to keep route names unique across navigators.

// QA P202 (2026-05-11): real RouteOptimizer screen — read-side
// template browser + quick actions. Full template authoring stays on
// the web; this replaces the previous PlaceholderScreen so the
// drawer's Planning → Route Optimizer entry actually goes somewhere.
import RouteOptimizerScreen from '../../screens/routes/RouteOptimizerScreen';

const Stack = createNativeStackNavigator<PlanningTabParamList>();

export default function PlanningStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      {/* Orders */}
      <Stack.Screen name="Orders" component={OrdersScreen} />
      <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
      <Stack.Screen name="OrderForm" component={OrderFormScreen} />

      {/* Shipments */}
      <Stack.Screen name="Shipments" component={ShipmentsScreen} />
      <Stack.Screen name="ShipmentDetail" component={ShipmentDetailScreen} />

      {/* Item Master */}
      <Stack.Screen name="ItemMaster" component={ItemMasterScreen} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} />
      <Stack.Screen name="ItemForm" component={ItemFormScreen} />

      {/* Location Master */}
      <Stack.Screen name="LocationMaster" component={LocationsScreen} />
      <Stack.Screen name="LocationDetail" component={LocationDetailScreen} />
      <Stack.Screen name="LocationForm" component={LocationFormScreen} />

      <Stack.Screen name="RouteOptimizer" component={RouteOptimizerScreen} />
    </Stack.Navigator>
  );
}
