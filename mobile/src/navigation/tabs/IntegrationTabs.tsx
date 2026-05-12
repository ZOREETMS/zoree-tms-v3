/**
 * Integration tab — wires the Messaging Hub surface that mirrors the
 * web Integration section (zoreeAI hub, OMS bridge, etc.). The
 * conversation detail view is wired even though the current
 * MessagingScreen folds it inline; QA P206 expects the drawer entry
 * to be a real, navigable stack.
 *
 * QA P206 (2026-05-11): drawer was previously an inline
 * <PlaceholderScreen> ("Messaging Hub" placeholder). Promoting to a
 * stack so the MessagingScreen that already exists in
 * mobile/src/screens/messaging is actually reachable.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { IntegrationTabParamList } from '../types';
import MessagingScreen from '../../screens/messaging/MessagingScreen';

const Stack = createNativeStackNavigator<IntegrationTabParamList>();

export default function IntegrationStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MessagingHub" component={MessagingScreen} />
      {/*
        ConversationDetail is currently rendered inline by
        MessagingScreen via a modal/sheet. Keeping the route name
        reserved in case a future redesign moves it to a dedicated
        screen — see IntegrationTabParamList.ConversationDetail.
       */}
      <Stack.Screen name="ConversationDetail" component={MessagingScreen} />
    </Stack.Navigator>
  );
}
