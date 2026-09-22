import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

const { CollectorModule } = NativeModules;

export type PermissionStatus = {
  notificationAccess: boolean;
  smsPermission: boolean;
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

// Requests the READ_SMS runtime permission (Android-only; notification access
// can't be requested this way and must go through openNotificationAccessSettings).
export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}
