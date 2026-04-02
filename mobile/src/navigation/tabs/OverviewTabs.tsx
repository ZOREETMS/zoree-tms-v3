import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OverviewTabParamList } from '../types';
import PlaceholderScreen from '../../screens/PlaceholderScreen';
import DashboardScreen from '../../screens/dashboard/DashboardScreen';

const Stack = createNativeStackNavigator<OverviewTabParamList>();

export default function OverviewStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="Home">
        {() => <PlaceholderScreen title="Home" icon="🏠" />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
