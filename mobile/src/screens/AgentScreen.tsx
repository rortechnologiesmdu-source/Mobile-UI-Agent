import React, { useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator, StyleSheet, Alert } from 'react-native';

// Agent 2 (the on-demand Accessibility/MediaProjection operator) isn't wired up
// yet — this screen is just the trigger point per the two-agent spec, so the UI
// shape is ready before Agent 2's native side is built.
export default function AgentScreen() {
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);

  const handleRunAgent = async () => {
    setRunning(true);
    Alert.alert('Agent 2 not wired up yet', `Goal received: "${goal}"`);
    setRunning(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ask the Agent</Text>
      <Text style={styles.subtitle}>
        Your screen will switch apps while the agent works — this is expected.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="What do you want me to do?"
        value={goal}
        onChangeText={setGoal}
        editable={!running}
        multiline
      />
      <Button
        title={running ? 'Running…' : '▶ Run Agent'}
        onPress={handleRunAgent}
        disabled={running || goal.trim().length === 0}
      />
      {running && <ActivityIndicator style={styles.spinner} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { color: '#666', marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  spinner: { marginTop: 8 },
});
