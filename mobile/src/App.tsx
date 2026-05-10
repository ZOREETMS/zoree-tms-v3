import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';

import { AuthProvider } from './state/AuthContext';
import { DataProvider } from './state/DataContext';
// REQ-OFFLINE Phase 5 (2026-05-10): offline-first wiring. The provider
// owns connectivity + the SQLite-backed write queue; the banner renders
// system-wide status (offline / pending / conflict). Mount the provider
// ABOVE DataProvider so DataContext can consume `useOffline()` in a
// follow-up without restructuring the tree.
import { OfflineProvider } from './state/OfflineContext';
import OfflineBanner from './components/offline/OfflineBanner';
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
            {/* REQ-OFFLINE Phase 5 — OfflineProvider lives BETWEEN
                AuthProvider and DataProvider. Auth above so that on
                logout we can stop the sync engine; Data below so a
                future "DataContext consumes offline queue counts"
                refactor doesn't require moving providers. */}
            <OfflineProvider>
              <DataProvider>
                <NavigationContainer>
                  {/* Banner sits inside the NavigationContainer so it
                      shadows the nav header on every screen. */}
                  <OfflineBanner />
                  <RootNavigator />
                </NavigationContainer>
              </DataProvider>
            </OfflineProvider>
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
