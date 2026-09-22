import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Button,
  ActivityIndicator,
  StyleSheet,
  Pressable,
  FlatList,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  startAgentRun,
  stepAgentRun,
  stopAgentRun,
  listAgentRuns,
  AgentAction,
  AgentRunSummary,
} from '../api/client';
import {
  checkAccessibilityEnabled,
  openAccessibilitySettings,
  getObservation,
  executeAction,
} from '../native/agent';

const STEP_DELAY_MS = 800;

function describeAction(action: AgentAction): string {
  switch (action.action) {
    case 'tap':
      return `Tapping "${action.target.description}"`;
    case 'type':
      return `Typing "${action.text}"`;
    case 'swipe':
      return `Swiping ${action.direction}`;
    case 'launch_app':
      return `Opening ${action.package}`;
    case 'press_back':
      return 'Going back';
    case 'press_home':
      return 'Going home';
    case 'done':
      return `Done: ${action.result}`;
    default:
      return 'Working...';
  }
}

export default function AgentScreen() {
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [statusLabel, setStatusLabel] = useState('');
  const [stepNumber, setStepNumber] = useState(0);
  const [resultText, setResultText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState<boolean | null>(null);
  const [history, setHistory] = useState<AgentRunSummary[]>([]);
  const stopRequested = useRef(false);

  const refreshAccessibility = useCallback(() => {
    checkAccessibilityEnabled().then(setAccessibilityEnabled);
  }, []);

  const refreshHistory = useCallback(() => {
    listAgentRuns().then((res) => setHistory(res.runs)).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshAccessibility();
      refreshHistory();
    }, [refreshAccessibility, refreshHistory])
  );

  const runLoop = useCallback(async (runId: string) => {
    while (!stopRequested.current) {
      setStatusLabel('Reading screen…');
      const observation = await getObservation();

      const result = await stepAgentRun(runId, observation);
      setStepNumber(result.stepNumber);
      setStatusLabel(describeAction(result.action));

      if (result.action.action === 'done' || result.status !== 'running') {
        if (result.action.action === 'done') setResultText(result.action.result);
        break;
      }

      await executeAction(result.action as unknown as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, STEP_DELAY_MS));
    }
  }, []);

  const handleRunAgent = async () => {
    const enabled = await checkAccessibilityEnabled();
    setAccessibilityEnabled(enabled);
    if (!enabled) return;

    stopRequested.current = false;
    setRunning(true);
    setResultText(null);
    setErrorText(null);
    setStepNumber(0);
    setStatusLabel('Starting…');

    let runId: string | null = null;
    try {
      const started = await startAgentRun(goal);
      runId = started.runId;
      await runLoop(runId);
    } catch (err: any) {
      setErrorText(err.message);
      if (runId) stopAgentRun(runId).catch(() => {});
    } finally {
      setRunning(false);
      refreshHistory();
    }
  };

  const handleStop = () => {
    stopRequested.current = true;
    setStatusLabel('Stopping…');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ask the Agent</Text>
      <Text style={styles.subtitle}>
        Your screen will switch apps while the agent works — this is expected.
      </Text>

      {accessibilityEnabled === false && (
        <Pressable style={styles.banner} onPress={openAccessibilitySettings}>
          <Text style={styles.bannerText}>
            ⚠️ Accessibility access is off — tap to enable it (Settings → Accessibility →
            MobileUse Agent)
          </Text>
        </Pressable>
      )}

      <TextInput
        style={styles.input}
        placeholder="What do you want me to do?"
        value={goal}
        onChangeText={setGoal}
        editable={!running}
        multiline
      />

      {!running ? (
        <Button
          title="▶ Run Agent"
          onPress={handleRunAgent}
          disabled={goal.trim().length === 0}
        />
      ) : (
        <Button title="■ Stop" color="#c0392b" onPress={handleStop} />
      )}

      {running && (
        <View style={styles.statusPanel}>
          <ActivityIndicator />
          <Text style={styles.statusText}>
            Step {stepNumber}: {statusLabel}
          </Text>
        </View>
      )}

      {!running && resultText && (
        <View style={styles.resultPanel}>
          <Text style={styles.resultText}>{resultText}</Text>
        </View>
      )}

      {!running && errorText && (
        <View style={styles.errorPanel}>
          <Text style={styles.errorPanelText}>{errorText}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>History</Text>
      <FlatList
        data={history}
        keyExtractor={(item) => item._id}
        renderItem={({ item }) => (
          <View style={styles.historyRow}>
            <Text style={styles.historyGoal}>{item.goal}</Text>
            <Text style={styles.historyMeta}>
              {item.status} · {item.steps.length} step{item.steps.length === 1 ? '' : 's'}
            </Text>
            {item.resultText && <Text style={styles.historyResult}>{item.resultText}</Text>}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No runs yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  subtitle: { color: '#666', marginBottom: 12 },
  banner: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffe69c',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  bannerText: { color: '#664d03' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  statusPanel: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  statusText: { marginLeft: 8, flex: 1 },
  resultPanel: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#eafaf1',
    borderRadius: 8,
  },
  resultText: { color: '#1e7e34' },
  errorPanel: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#fdecea',
    borderRadius: 8,
  },
  errorPanelText: { color: '#c0392b' },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  historyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  historyGoal: { fontSize: 14, fontWeight: '600' },
  historyMeta: { fontSize: 12, color: '#888' },
  historyResult: { fontSize: 12, color: '#444', marginTop: 2 },
  empty: { color: '#999', fontStyle: 'italic' },
});
