import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PermissionsAndroid, Platform } from 'react-native';
import { checkPermissions, openNotificationAccessSettings, PermissionStatus } from '../native/collector';

type Item = {
  key: keyof PermissionStatus;
  label: string;
  onPress: () => void | Promise<void>;
};

// Checks Agent 1's permissions on every render of the dashboard, since Android
// can silently revoke special access (notification listener, storage, etc.) for
// unused apps (MobileUse-Agent-Spec-main.md section 3.3/6.2).
export default function HealthCheckBanner() {
  const [status, setStatus] = useState<PermissionStatus | null>(null);

  const refresh = useCallback(() => {
    checkPermissions().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!status) return null;

  const requestPermission = async (permission: string) => {
    await PermissionsAndroid.request(permission as any);
    refresh();
  };

  const items: Item[] = [
    {
      key: 'notificationAccess',
      label: '⚠️ Notification access was turned off — tap to re-enable',
      onPress: openNotificationAccessSettings,
    },
    {
      key: 'smsPermission',
      label: '⚠️ SMS access was denied — tap to grant it',
      onPress: () => requestPermission(PermissionsAndroid.PERMISSIONS.READ_SMS),
    },
    {
      key: 'locationPermission',
      label: '⚠️ Location access was denied — tap to grant it',
      onPress: () => requestPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION),
    },
    {
      key: 'callLogPermission',
      label: '⚠️ Call log access was denied — tap to grant it',
      onPress: () => requestPermission(PermissionsAndroid.PERMISSIONS.READ_CALL_LOG),
    },
    {
      key: 'filesPermission',
      label: '⚠️ Files/media access was denied — tap to grant it',
      onPress: () =>
        requestPermission(
          Platform.Version >= 33
            ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
            : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
        ),
    },
  ];

  const missing = items.filter((item) => !status[item.key]);
  if (missing.length === 0) return null;

  return (
    <View>
      {missing.map((item) => (
        <Pressable key={item.key} style={styles.banner} onPress={item.onPress}>
          <Text style={styles.text}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fff3cd',
    borderColor: '#ffe69c',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  text: { color: '#664d03' },
});
