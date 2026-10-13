import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { EmailSummary, getRecentEmails } from '../api/client';
import { formatTime, styles } from './DashboardSections';

const DAYS = 7;
const LIMIT = 200;

// Dashboard -> API: Gmail emails received in the last 7 days (metadata only).
export default function EmailsScreen() {
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRecentEmails(DAYS, LIMIT);
      setEmails(res.emails);
      setTruncated(res.truncated);
    } catch (e: any) {
      setError(e.code === 'not_connected' ? 'Gmail isn’t connected. Connect it on the Mac, then pull to refresh.' : `Couldn't load emails: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={{ flex: 1, padding: 16 }}>
      {error && <Text style={styles.error}>{error}</Text>}
      {truncated && <Text style={styles.meta}>Showing the newest {emails.length} emails of the last {DAYS} days.</Text>}
      <FlatList
        data={emails}
        keyExtractor={(m) => m.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        renderItem={({ item: m }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{m.subject || '(no subject)'}</Text>
            <Text style={styles.meta}>
              {m.from} · {formatTime(m.receivedAt)}
            </Text>
            <Text style={styles.snippet}>{m.snippet}</Text>
            <Text style={[styles.meta, { fontSize: 10 }]}>id {m.id}</Text>
          </View>
        )}
        ListEmptyComponent={!loading && !error ? <Text style={styles.empty}>No emails in the last {DAYS} days.</Text> : undefined}
      />
    </View>
  );
}
