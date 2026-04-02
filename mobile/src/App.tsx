import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

import { AuthProvider } from './state/AuthContext';
import { DataProvider } from './state/DataContext';
import RootNavigator from './navigation/RootNavigator';
import { initializeApi } from './lib/api';
import { storage } from './lib/storage';
import { colors, fontSize, fontWeight } from './theme';

function AppBootLoader({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function boot() {
      await storage.init();
      initializeApi();
      setReady(true);
    }
    boot();
  }, []);

  if (!ready) {
    return (
      <View style={styles.bootScreen}>
        <Text style={styles.bootLogo}>zoree</Text>
        <Text style={styles.bootSub}>TMS PLATFORM</Text>
        <ActivityIndicator
          size="large"
          color={colors.accent}
          style={styles.spinner}
        />
        <Text style={styles.bootText}>Loading...</Text>
      </View>
    );
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppBootLoader>
          <AuthProvider>
            <DataProvider>
              <NavigationContainer>
                <RootNavigator />
              </NavigationContainer>
            </DataProvider>
          </AuthProvider>
        </AppBootLoader>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  bootScreen: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bootLogo: {
    fontWeight: fontWeight.extrabold,
    fontSize: 42,
    color: '#FFFFFF',
    letterSpacing: 5,
    textTransform: 'uppercase',
  },
  bootSub: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 6,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  spinner: {
    marginTop: 32,
  },
  bootText: {
    marginTop: 12,
    fontSize: fontSize.sm,
    color: 'rgba(255,255,255,0.3)',
  },
});
