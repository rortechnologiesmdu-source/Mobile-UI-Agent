import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { analyzeApp, AppInfo, CollectionMethod, getApps, setAppAccess, setAppCategory, syncApps } from '../api/client';
import { listApps } from '../native/agent';

const METHOD_LABEL: Record<CollectionMethod['method'], string> = {
  api: 'API',
  mcp: 'MCP',
  email: 'Email',
  phone_data: 'Phone Data',
  mobile_use: 'MobileUse Agent',
  browser_use: 'BrowserUse Agent',
};

const STATUS_LABEL: Record<CollectionMethod['status'], string> = {
  available: 'Available',
  requires_connection: 'Requires connection',
  requires_permission: 'Requires permission',
  unverified: 'Unverified',
  unsupported: 'Unsupported',
  temporarily_unavailable: 'Temporarily unavailable',
};

const STATUS_COLOR: Record<CollectionMethod['status'], string> = {
  available: '#1e7e34',
  requires_connection: '#b8860b',
  requires_permission: '#b8860b',
  unverified: '#666',
  unsupported: '#999',
  temporarily_unavailable: '#c0392b',
};

const POLL_MS = 3000;

export default function InstalledAppsScreen() {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [pickingCategoryFor, setPickingCategoryFor] = useState<AppInfo | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const replaceApp = (app: AppInfo) => setApps((list) => list.map((a) => (a.package === app.package ? app : a)));

  // The phone's installed apps (with icons) are reported to the backend, which keeps the
  // saved access settings; the list shown is what the backend has saved.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let res;
      try {
        const deviceApps = await listApps();
        setIcons(Object.fromEntries(deviceApps.map((a) => [a.package, a.icon])));
        res = await syncApps(deviceApps.map(({ package: pkg, label, androidCategory }) => ({ package: pkg, label, androidCategory })));
      } catch (e: any) {
        setError(`Couldn't read this phone's apps (${e.message}); showing the saved list.`);
        res = await getApps();
      }
      setApps(res.apps);
      setCategories(res.categories);
    } catch (e: any) {
      setError(`Couldn't load apps: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // While any analysis is running, refresh the saved list until it finishes.
  const anyPending = apps.some((a) => a.analysis?.status === 'pending');
  useEffect(() => {
    if (!anyPending) return;
    pollTimer.current = setTimeout(() => {
      getApps()
        .then((res) => setApps(res.apps))
        .catch(() => {});
    }, POLL_MS);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [anyPending, apps]);

  // The switch only changes once the backend has saved it; a failed save is shown as such.
  const toggleAccess = async (app: AppInfo, access: boolean) => {
    setSaving((s) => ({ ...s, [app.package]: true }));
    try {
      const res = await setAppAccess(app.package, access, app.label);
      replaceApp(res.app);
    } catch (e: any) {
      Alert.alert('Not saved', `${app.label} is still ${app.access ? 'allowed' : 'not allowed'}.\n\n${e.message}`);
    } finally {
      setSaving((s) => ({ ...s, [app.package]: false }));
    }
  };

  const pickCategory = async (category: string | null) => {
    const app = pickingCategoryFor;
    setPickingCategoryFor(null);
    if (!app) return;
    try {
      const res = await setAppCategory(app.package, category);
      replaceApp(res.app);
    } catch (e: any) {
      Alert.alert('Not saved', `Couldn't change the category of ${app.label}.\n\n${e.message}`);
    }
  };

  const refreshAnalysis = async (app: AppInfo) => {
    try {
      const res = await analyzeApp(app.package);
      replaceApp(res.app);
    } catch (e: any) {
      Alert.alert('Analysis failed', e.message);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter(
      (a) => (!q || a.label.toLowerCase().includes(q)) && (!categoryFilter || a.category === categoryFilter)
    );
  }, [apps, query, categoryFilter]);

  const renderMethods = (app: AppInfo) => {
    const analysis = app.analysis || { status: 'none', methods: [] };
    if (!app.access && analysis.status !== 'completed') {
      return <Text style={styles.methodsHint}>Allow access to analyse data collection methods.</Text>;
    }
    if (analysis.status === 'pending') {
      return (
        <View style={styles.row}>
          <ActivityIndicator size="small" />
          <Text style={styles.methodsHint}> Analysing collection methods…</Text>
        </View>
      );
    }
    if (analysis.status === 'failed') {
      return (
        <View>
          <Text style={styles.error}>Method analysis failed: {analysis.error || 'unknown error'}</Text>
          <Pressable onPress={() => refreshAnalysis(app)}>
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (analysis.status !== 'completed') {
      return (
        <Pressable onPress={() => refreshAnalysis(app)}>
          <Text style={styles.link}>Analyse collection methods</Text>
        </Pressable>
      );
    }
    const usable = analysis.methods.filter((m) => m.status !== 'unsupported');
    const unsupported = analysis.methods.filter((m) => m.status === 'unsupported');
    return (
      <View>
        {usable.map((m, i) => (
          <View key={m.method} style={styles.method}>
            <Text style={styles.methodLine}>
              {i + 1}. {METHOD_LABEL[m.method]} —{' '}
              <Text style={{ color: STATUS_COLOR[m.status], fontWeight: '600' }}>{STATUS_LABEL[m.status]}</Text>
            </Text>
            {!!m.reason && <Text style={styles.methodReason}>{m.reason}</Text>}
          </View>
        ))}
        {!usable.length && <Text style={styles.methodsHint}>No usable collection methods found.</Text>}
        {!!unsupported.length && (
          <Text style={styles.methodsHint}>Not available: {unsupported.map((m) => METHOD_LABEL[m.method]).join(', ')}</Text>
        )}
        <Pressable onPress={() => refreshAnalysis(app)}>
          <Text style={styles.link}>Refresh analysis</Text>
        </Pressable>
      </View>
    );
  };

  const renderApp = ({ item: app }: { item: AppInfo }) => {
    const icon = icons[app.package];
    const busy = saving[app.package];
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          {icon ? (
            <Image source={{ uri: `data:image/png;base64,${icon}` }} style={styles.icon} />
          ) : (
            <View style={[styles.icon, styles.iconPlaceholder]} />
          )}
          <View style={styles.appText}>
            <Text style={styles.appName} numberOfLines={1}>
              {app.label}
            </Text>
            <Pressable onPress={() => setPickingCategoryFor(app)}>
              <Text style={styles.category}>
                {app.category}
                {app.categoryCorrected ? ' (set by you)' : ''} ▾
              </Text>
            </Pressable>
          </View>
          {busy ? <ActivityIndicator /> : <Switch value={app.access} onValueChange={(v) => toggleAccess(app, v)} />}
        </View>
        <Text style={[styles.status, { color: app.access ? '#1e7e34' : '#c0392b' }]}>
          Mobile Agent Access: {busy ? 'saving…' : app.access ? 'Yes' : 'No'}
        </Text>
        <Text style={styles.methodsTitle}>Available Data Collection Methods</Text>
        {renderMethods(app)}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Installed Apps & Access Control</Text>
      <TextInput
        style={styles.search}
        placeholder="Search apps"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {[null, ...categories].map((c) => (
          <Pressable
            key={c ?? 'all'}
            style={[styles.chip, categoryFilter === c && styles.chipActive]}
            onPress={() => setCategoryFilter(c)}
          >
            <Text style={[styles.chipText, categoryFilter === c && styles.chipTextActive]}>{c ?? 'All'}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        data={shown}
        keyExtractor={(a) => a.package}
        renderItem={renderApp}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No apps found.</Text> : undefined}
      />

      <Modal visible={!!pickingCategoryFor} transparent animationType="fade" onRequestClose={() => setPickingCategoryFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPickingCategoryFor(null)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Category for {pickingCategoryFor?.label}</Text>
            <ScrollView>
              <Pressable onPress={() => pickCategory(null)}>
                <Text style={styles.sheetItem}>Automatic</Text>
              </Pressable>
              {categories.map((c) => (
                <Pressable key={c} onPress={() => pickCategory(c)}>
                  <Text style={[styles.sheetItem, pickingCategoryFor?.category === c && styles.sheetItemActive]}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  search: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chips: { flexGrow: 0, marginVertical: 8 },
  chip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  chipActive: { backgroundColor: '#333', borderColor: '#333' },
  chipText: { fontSize: 13, color: '#333' },
  chipTextActive: { color: '#fff' },
  error: { color: 'red', marginVertical: 4 },
  empty: { color: '#666', marginTop: 24, textAlign: 'center' },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 12, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { width: 40, height: 40, borderRadius: 8 },
  iconPlaceholder: { backgroundColor: '#eee' },
  appText: { flex: 1, marginHorizontal: 12 },
  appName: { fontSize: 15, fontWeight: '600' },
  category: { fontSize: 12, color: '#666', marginTop: 2 },
  status: { fontSize: 12, marginTop: 8, fontWeight: '600' },
  methodsTitle: { fontSize: 13, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  methodsHint: { fontSize: 12, color: '#666' },
  method: { marginBottom: 4 },
  methodLine: { fontSize: 13 },
  methodReason: { fontSize: 11, color: '#666', marginLeft: 14 },
  link: { color: '#1a73e8', fontSize: 13, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 32 },
  sheet: { backgroundColor: '#fff', borderRadius: 12, padding: 16, maxHeight: '80%' },
  sheetTitle: { fontSize: 15, fontWeight: '600', marginBottom: 8 },
  sheetItem: { paddingVertical: 10, fontSize: 14 },
  sheetItemActive: { fontWeight: '700' },
});
