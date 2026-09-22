/**
 * MobileUse — two-agent mobile app.
 * @format
 */

import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import RootNavigator from './src/navigation/RootNavigator';
import { requestAllCollectorPermissions, startCollector } from './src/native/collector';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  useEffect(() => {
    // Agent 1 starts as soon as the app is opened once — permissions are asked
    // for up front, then it keeps running in the background via the foreground
    // service + WorkManager (see MobileUse-Agent-Spec-main.md section 3.4).
    // Notification listener access can't be requested this way; the dashboard's
    // Health Check banner prompts for that separately.
    requestAllCollectorPermissions().finally(() => startCollector());
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
