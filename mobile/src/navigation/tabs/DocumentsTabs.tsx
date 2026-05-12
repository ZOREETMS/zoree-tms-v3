/**
 * Documents tab — wires the Documents & BOL surface plus the
 * Customer Portal share view + Tracking Portal deep-link, matching
 * the web's Documents section.
 *
 * QA P205 (2026-05-11): AppNavigator previously hung an inline
 * <PlaceholderScreen> off the DocumentsTab drawer entry, so the QA
 * report logged "Documents module is not available". Promoting the
 * tab to a real stack now uses the existing screens that already
 * shipped in mobile/src/screens/documents and mobile/src/screens/customer.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DocumentsTabParamList } from '../types';
import DocumentsScreen from '../../screens/documents/DocumentsScreen';
import CustomerPortalScreen from '../../screens/customer/CustomerPortalScreen';
import TrackingScreen from '../../screens/customer/TrackingScreen';

const Stack = createNativeStackNavigator<DocumentsTabParamList>();

export default function DocumentsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Documents" component={DocumentsScreen} />
      <Stack.Screen name="CustomerPortal" component={CustomerPortalScreen} />
      <Stack.Screen name="TrackingPortal" component={TrackingScreen} />
    </Stack.Navigator>
  );
}
