import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, RefreshControl, ScrollView, Pressable } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getDashboardSummary, DashboardTile, EventSource } from '../api/client';
import HealthCheckBanner from './HealthCheckBanner';
import { ApiSection, BrowserAgentSection, MobileAgentSection } from './DashboardSections';
import type { DashboardStackParamList } from '../navigation/types';

type Props = {
  navigation: NativeStackNavigationProp<DashboardStackParamList, 'DashboardHome'>;
};

const TILES: { source: EventSource; label: string; icon: string; screen: keyof DashboardStackParamList }[] = [
  { source: 'sms', label: 'SMS', icon: '💬', screen: 'SmsDetail' },
  { source: 'notification', label: 'Notifications', icon: '🔔', screen: 'NotificationsDetail' },
  { source: 'location', label: 'Location', icon: '📍', screen: 'LocationDetail' },
  { source: 'file', label: 'Files', icon: '📄', screen: 'FilesDetail' },
  { source: 'call_log', label: 'Call Log', icon: '📞', screen: 'CallLogDetail' },
];

export default function DashboardScreen({ navigation }: Props) {
  const [tiles, setTiles] = useState<Record<string, DashboardTile>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on pull-to-refresh so the other sections reload too.
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRefreshKey((k) => k + 1);
    try {
      const res = await getDashboardSummary();
      setTiles(res.tiles);
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
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <HealthCheckBanner />

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Data grouped by how it was collected: Device, Mobile Agent, API, Browser Agent. */}
      <Text style={styles.sectionTitle}>📱 Device</Text>
      <View style={styles.grid}>
        {TILES.map((tile) => {
          const data = tiles[tile.source];
          return (
            <Pressable
              key={tile.source}
              style={styles.card}
              onPress={() => navigation.navigate(tile.screen as any)}
            >
              <Text style={styles.cardIcon}>{tile.icon}</Text>
              <Text style={styles.cardLabel}>{tile.label}</Text>
              <Text style={styles.cardCount}>{data?.count ?? 0}</Text>
              <Text style={styles.cardSnippet} numberOfLines={2}>
                {data?.latestSummary ?? 'No recent data'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <MobileAgentSection refreshKey={refreshKey} onSeeAll={() => navigation.navigate('MobileAgentResults')} />
      <ApiSection refreshKey={refreshKey} onSeeAll={() => navigation.navigate('Emails')} />
      <BrowserAgentSection />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 8 },
  error: { color: 'red', marginBottom: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  cardIcon: { fontSize: 20 },
  cardLabel: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  cardCount: { fontSize: 22, fontWeight: 'bold', marginTop: 2 },
  cardSnippet: { fontSize: 12, color: '#666', marginTop: 4 },
});
