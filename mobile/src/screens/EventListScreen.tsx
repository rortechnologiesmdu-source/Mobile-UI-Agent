import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getEventsBySource, DashboardEvent, EventSource } from '../api/client';

type Props = {
  source: EventSource;
  sinceHours?: number;
  limit?: number;
  emptyLabel: string;
  // When set, refetches on this interval while the screen is focused — used by
  // Notifications for a near-real-time feed without needing manual refresh.
  pollIntervalMs?: number;
  // Show the raw sender + full message text (SMS) instead of the one-line
  // Gemini summary. The full body is always stored; this just surfaces it.
  showRawText?: boolean;
};

// Shared list rendering for every per-source detail screen (SMS, Location,
// Files, Call Log, Notifications) — same fetch/refresh/render shape, just a
// different source and empty-state copy per screen.
export default function EventListScreen({
  source,
  sinceHours = 48,
  limit = 50,
  emptyLabel,
  pollIntervalMs,
  showRawText = false,
}: Props) {
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isManualRefresh = useRef(false);

  const load = useCallback(async () => {
    if (isManualRefresh.current) setLoading(true);
    setError(null);
    try {
      const res = await getEventsBySource(source, sinceHours, limit);
      setEvents(res.events);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [source, sinceHours, limit]);

  const onRefresh = useCallback(() => {
    isManualRefresh.current = true;
    load().finally(() => {
      isManualRefresh.current = false;
    });
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      if (!pollIntervalMs) return;
      const interval = setInterval(load, pollIntervalMs);
      return () => clearInterval(interval);
    }, [load, pollIntervalMs])
  );

  return (
    <View style={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={events}
        keyExtractor={(item) => item._id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
        renderItem={({ item }) => {
          const sender = (item.payload?.sender as string) || '';
          const body = (item.payload?.body as string) || '';
          return (
            <View style={styles.row}>
              {showRawText && body ? (
                <>
                  {sender ? <Text style={styles.sender}>{sender}</Text> : null}
                  <Text style={styles.body}>{body}</Text>
                </>
              ) : (
                <Text style={styles.summary}>{item.summaryText ?? 'Uncategorized'}</Text>
              )}
              <Text style={styles.timestamp}>
                {new Date(item.deviceTimestamp).toLocaleString()}
                {showRawText && item.category ? ` · ${item.category}` : ''}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>{emptyLabel}</Text> : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  row: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  summary: { fontSize: 15 },
  sender: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 2 },
  body: { fontSize: 15, color: '#111' },
  timestamp: { fontSize: 12, color: '#888', marginTop: 2 },
  empty: { color: '#999', fontStyle: 'italic', marginTop: 24, textAlign: 'center' },
  error: { color: 'red', marginBottom: 8 },
});
