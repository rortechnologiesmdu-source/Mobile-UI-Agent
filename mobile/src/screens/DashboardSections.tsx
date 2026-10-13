import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  EmailSummary,
  getGmailStatus,
  getMobileAgentResults,
  getRecentEmails,
  GmailStatus,
  MobileAgentRecord,
} from '../api/client';

const PREVIEW = 5;

export const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

// One line describing a run's data: how many items, or a short preview.
export function dataSummary(record: MobileAgentRecord): string {
  const data = record.data as any;
  if (data == null) return record.items?.length ? `${record.items.length} items collected` : 'No data collected';
  const lists = typeof data === 'object' ? Object.entries(data).filter(([, v]) => Array.isArray(v)) : [];
  if (lists.length) return lists.map(([k, v]) => `${(v as unknown[]).length} ${k.replace(/_/g, ' ')}`).join(' · ');
  return JSON.stringify(data).slice(0, 120);
}

function SectionState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator style={styles.spacer} />;
  if (!error) return null;
  return (
    <View>
      <Text style={styles.error}>{error}</Text>
      <Pressable onPress={onRetry}>
        <Text style={styles.link}>Retry</Text>
      </Pressable>
    </View>
  );
}

// Data collected by the Mobile UI Agent (the `mobileagent` collection: one record per run).
export function MobileAgentSection({ refreshKey, onSeeAll }: { refreshKey: number; onSeeAll: () => void }) {
  const [records, setRecords] = useState<MobileAgentRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMobileAgentResults(1, PREVIEW);
      setRecords(res.records);
      setTotal(res.total);
    } catch (e: any) {
      setError(`Couldn't load Mobile Agent results: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <View>
      <Text style={styles.sectionTitle}>🤖 Mobile Agent</Text>
      <SectionState loading={loading && !records.length} error={error} onRetry={load} />
      {!loading && !error && !records.length && <Text style={styles.empty}>No Mobile Agent results yet.</Text>}
      {records.map((r) => (
        <Pressable key={r._id} style={styles.card} onPress={onSeeAll}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {r.task}
          </Text>
          <Text style={styles.meta}>
            {r.status} · {formatTime(r.finishedAt)}
          </Text>
          <Text style={styles.snippet} numberOfLines={2}>
            {dataSummary(r)}
          </Text>
        </Pressable>
      ))}
      {total > records.length && (
        <Pressable onPress={onSeeAll}>
          <Text style={styles.link}>See all {total} results</Text>
        </Pressable>
      )}
    </View>
  );
}

// API section: Gmail (read-only), emails from the last 7 days.
export function ApiSection({ refreshKey, onSeeAll }: { refreshKey: number; onSeeAll: () => void }) {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getGmailStatus();
      setStatus(s);
      if (s.connected) {
        const res = await getRecentEmails(7, 50);
        setEmails(res.emails);
        setTruncated(res.truncated);
      } else {
        setEmails([]);
      }
    } catch (e: any) {
      if (e.code === 'not_connected') setStatus((s) => (s ? { ...s, connected: false } : s));
      else setError(`Couldn't load Gmail: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <View>
      <Text style={styles.sectionTitle}>✉️ API · Gmail</Text>
      <SectionState loading={loading && !status} error={error} onRetry={load} />
      {status && !status.configured && (
        <Text style={styles.empty}>Gmail isn't set up: no Google OAuth client was found on the backend.</Text>
      )}
      {status?.configured && !status.connected && (
        <View>
          <Text style={styles.empty}>
            Gmail isn't connected. On the Mac, open {status.connectUrl} and sign in (read-only access).
          </Text>
          <Pressable onPress={load}>
            <Text style={styles.link}>I've connected it — refresh</Text>
          </Pressable>
        </View>
      )}
      {status?.connected && (
        <View>
          <Text style={styles.meta}>
            {status.email ? `${status.email} · ` : ''}last 7 days{truncated ? ` · showing the newest ${emails.length}` : ''}
          </Text>
          {!loading && !error && !emails.length && <Text style={styles.empty}>No emails in the last 7 days.</Text>}
          {emails.slice(0, PREVIEW).map((m) => (
            <Pressable key={m.id} style={styles.card} onPress={onSeeAll}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {m.subject || '(no subject)'}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {m.from} · {formatTime(m.receivedAt)}
              </Text>
              <Text style={styles.snippet} numberOfLines={2}>
                {m.snippet}
              </Text>
            </Pressable>
          ))}
          {emails.length > PREVIEW && (
            <Pressable onPress={onSeeAll}>
              <Text style={styles.link}>See all {emails.length} emails</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// Browser Agent: placeholder until the Browser Use project is connected.
export function BrowserAgentSection() {
  return (
    <View>
      <Text style={styles.sectionTitle}>🌐 Browser Agent</Text>
      <Text style={styles.empty}>No browser-agent data available yet.</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 12, color: '#666', marginTop: 2 },
  snippet: { fontSize: 12, color: '#444', marginTop: 4 },
  empty: { fontSize: 13, color: '#666', marginBottom: 8 },
  error: { color: 'red', marginBottom: 4 },
  link: { color: '#1a73e8', fontSize: 13, marginVertical: 4 },
  spacer: { marginVertical: 8 },
});
