import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  checkPermissions,
  openNotificationAccessSettings,
  requestSmsPermission,
  PermissionStatus,
} from '../native/collector';

// Checks Agent 1's permissions on every render of the dashboard, since Android
// can silently revoke NotificationListenerService access for unused apps
// (MobileUse-Agent-Spec-main.md section 3.3/6.2).
export default function HealthCheckBanner() {
  const [status, setStatus] = useState<PermissionStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    checkPermissions().then((result) => {
      if (mounted) setStatus(result);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!status) return null;

  return (
    <View>
      {!status.notificationAccess && (
        <Pressable style={styles.banner} onPress={openNotificationAccessSettings}>
          <Text style={styles.text}>
            ⚠️ Notification access was turned off — tap to re-enable
          </Text>
        </Pressable>
      )}
      {!status.smsPermission && (
        <Pressable
          style={styles.banner}
          onPress={() => requestSmsPermission().then(() => checkPermissions().then(setStatus))}
        >
          <Text style={styles.text}>⚠️ SMS access was denied — tap to grant it</Text>
        </Pressable>
      )}
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
    marginBottom: 12,
  },
  text: { color: '#664d03' },
});
