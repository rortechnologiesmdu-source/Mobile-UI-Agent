import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TextInput,
  Button,
  ActivityIndicator,
} from 'react-native';
import { getDashboardSummary, DashboardEvent } from '../api/client';
import HealthCheckBanner from './HealthCheckBanner';

type Props = {
  onRunAgent: (goal: string) => void;
  agentRunning: boolean;
};

export default function DashboardScreen({ onRunAgent, agentRunning }: Props) {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDashboardSummary();
      setEvents(res.events);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MobileUse</Text>

      <HealthCheckBanner />

      <Text style={styles.sectionTitle}>Today's Summary</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={events}
        keyExtractor={(item) => item._id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        renderItem={({ item }) => (
          <View style={styles.eventRow}>
            <Text style={styles.eventText}>
              {item.summaryText ?? `${item.source}: (uncategorized)`}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>No events yet.</Text> : null
        }
      />

      <Text style={styles.sectionTitle}>Ask the Agent</Text>
      <TextInput
        style={styles.input}
        placeholder="What do you want me to do?"
        value={goal}
        onChangeText={setGoal}
        editable={!agentRunning}
      />
      <Button
        title={agentRunning ? 'Running…' : '▶ Run Agent'}
        onPress={() => onRunAgent(goal)}
        disabled={agentRunning || goal.trim().length === 0}
      />
      {agentRunning && <ActivityIndicator style={styles.spinner} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  eventRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eee' },
  eventText: { fontSize: 14 },
  empty: { color: '#999', fontStyle: 'italic' },
  error: { color: 'red', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  spinner: { marginTop: 8 },
});
