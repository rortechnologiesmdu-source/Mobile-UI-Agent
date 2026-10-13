import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { getMobileAgentResults, MobileAgentRecord } from '../api/client';
import { dataSummary, formatTime, styles } from './DashboardSections';

const PAGE_SIZE = 20;

// All Mobile UI Agent results (the `mobileagent` collection), newest first, a page at a time.
// Tap a result to see its full data and the items collected.
export default function MobileAgentResultsScreen() {
  const [records, setRecords] = useState<MobileAgentRecord[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMobileAgentResults(nextPage, PAGE_SIZE);
      setRecords((list) => (nextPage === 1 ? res.records : [...list, ...res.records]));
      setPage(nextPage);
      setHasMore(res.hasMore);
    } catch (e: any) {
      setError(`Couldn't load results: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(1);
  }, [load]);

  const renderItem = ({ item: r }: { item: MobileAgentRecord }) => (
    <Pressable style={styles.card} onPress={() => setOpen(open === r._id ? null : r._id)}>
      <Text style={styles.cardTitle}>{r.task}</Text>
      <Text style={styles.meta}>
        {r.status} · {r.steps} steps · {formatTime(r.finishedAt)}
      </Text>
      <Text style={styles.snippet}>{dataSummary(r)}</Text>
      {open === r._id && (
        <View>
          {!!r.resultText && <Text style={styles.snippet}>Result: {r.resultText}</Text>}
          <Text style={[styles.meta, { marginTop: 8 }]}>Data</Text>
          <Text style={styles.snippet} selectable>
            {r.data == null ? 'none' : JSON.stringify(r.data, null, 2)}
          </Text>
          {!!r.items?.length && (
            <>
              <Text style={[styles.meta, { marginTop: 8 }]}>Collected items</Text>
              {r.items.map((it, i) => (
                <Text key={i} style={styles.snippet} selectable>
                  {i + 1}. {it}
                </Text>
              ))}
            </>
          )}
        </View>
      )}
    </Pressable>
  );

  return (
    <View style={{ flex: 1, padding: 16 }}>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={records}
        keyExtractor={(r) => r._id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={loading && page === 1} onRefresh={() => load(1)} />}
        onEndReached={() => hasMore && !loading && load(page + 1)}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No Mobile Agent results yet.</Text> : undefined}
        ListFooterComponent={loading && page > 1 ? <ActivityIndicator style={styles.spacer} /> : undefined}
      />
    </View>
  );
}
