/**
 * MobileUse — two-agent mobile app.
 * @format
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View, Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import DashboardScreen from './src/screens/DashboardScreen';
import { requestSmsPermission, startCollector } from './src/native/collector';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [agentRunning, setAgentRunning] = useState(false);

  useEffect(() => {
    // Agent 1 starts as soon as the app is opened once — it then keeps running
    // in the background via the foreground service + WorkManager (see spec 3.4).
    requestSmsPermission().finally(() => startCollector());
  }, []);

  const handleRunAgent = async (goal: string) => {
    // Agent 2's native observe/decide/act loop isn't wired up yet (build order
    // step 4). For now this just confirms the trigger point on the dashboard.
    setAgentRunning(true);
    Alert.alert('Agent 2 not wired up yet', `Goal received: "${goal}"`);
    setAgentRunning(false);
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.container}>
        <DashboardScreen onRunAgent={handleRunAgent} agentRunning={agentRunning} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
