import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

const { CollectorModule } = NativeModules;

export type PermissionStatus = {
  notificationAccess: boolean;
  smsPermission: boolean;
  locationPermission: boolean;
  callLogPermission: boolean;
  filesPermission: boolean;
};

export function checkPermissions(): Promise<PermissionStatus> {
  return CollectorModule.checkPermissions();
}

export function openNotificationAccessSettings(): void {
  CollectorModule.openNotificationAccessSettings();
}

export function startCollector(): void {
  CollectorModule.startCollector();
}

// Requests every Agent 1 runtime permission in one prompt sequence on first launch.
// Notification access isn't a runtime permission and must go through Settings
// separately (see openNotificationAccessSettings / the Health Check banner).
export async function requestAllCollectorPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const mediaPermission =
    Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;

  const permissions = [
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
    mediaPermission,
  ];
  if (Platform.Version >= 33) {
    permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  await PermissionsAndroid.requestMultiple(permissions);
}
