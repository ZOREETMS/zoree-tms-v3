import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OverviewTabParamList } from '../types';
import DashboardScreen from '../../screens/dashboard/DashboardScreen';
// QA #268 — Home is no longer a "Coming Soon" placeholder. The real
// HomeScreen mirrors the web HomePage (KPI row + module directory).
import HomeScreen from '../../screens/home/HomeScreen';

const Stack = createNativeStackNavigator<OverviewTabParamList>();

export default function OverviewStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen name="Home" component={HomeScreen} />
    </Stack.Navigator>
  );
}
