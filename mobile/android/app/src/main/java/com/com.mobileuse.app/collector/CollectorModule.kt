package com.mobileuse.app.collector

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import java.util.concurrent.TimeUnit

private const val SMS_SYNC_WORK_NAME = "mobileuse_sms_sync"
private const val CALL_LOG_SYNC_WORK_NAME = "mobileuse_call_log_sync"
private const val LOCATION_SYNC_WORK_NAME = "mobileuse_location_sync"
private const val FILE_SYNC_WORK_NAME = "mobileuse_file_sync"

class CollectorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "CollectorModule"

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(reactApplicationContext, permission) ==
            PackageManager.PERMISSION_GRANTED

    private fun mediaPermissionName(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            android.Manifest.permission.READ_MEDIA_IMAGES
        } else {
            android.Manifest.permission.READ_EXTERNAL_STORAGE
        }

    @ReactMethod
    fun checkPermissions(promise: Promise) {
        val context = reactApplicationContext
        val enabledListeners = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ) ?: ""
        val notificationAccess = enabledListeners.contains(context.packageName)

        val result: WritableMap = Arguments.createMap()
        result.putBoolean("notificationAccess", notificationAccess)
        result.putBoolean("smsPermission", granted(android.Manifest.permission.READ_SMS))
        result.putBoolean("locationPermission", granted(android.Manifest.permission.ACCESS_FINE_LOCATION))
        result.putBoolean("callLogPermission", granted(android.Manifest.permission.READ_CALL_LOG))
        result.putBoolean("filesPermission", granted(mediaPermissionName()))
        promise.resolve(result)
    }

    @ReactMethod
    fun openNotificationAccessSettings() {
        val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
    }

    // Starts the foreground service (persistent "MobileUse is monitoring" notification)
    // and schedules every Agent 1 periodic sync job. Safe to call every app launch —
    // enqueueUniquePeriodicWork + KEEP means already-scheduled jobs are left alone.
    @ReactMethod
    fun startCollector() {
        val context = reactApplicationContext
        val serviceIntent = Intent(context, CollectorForegroundService::class.java)
        ContextCompat.startForegroundService(context, serviceIntent)

        val workManager = WorkManager.getInstance(context)
        val jobs = listOf(
            SMS_SYNC_WORK_NAME to PeriodicWorkRequestBuilder<SmsSyncWorker>(15, TimeUnit.MINUTES).build(),
            CALL_LOG_SYNC_WORK_NAME to PeriodicWorkRequestBuilder<CallLogSyncWorker>(15, TimeUnit.MINUTES).build(),
            LOCATION_SYNC_WORK_NAME to PeriodicWorkRequestBuilder<LocationSyncWorker>(15, TimeUnit.MINUTES).build(),
            FILE_SYNC_WORK_NAME to PeriodicWorkRequestBuilder<FileSyncWorker>(15, TimeUnit.MINUTES).build(),
        )
        jobs.forEach { (name, request) ->
            workManager.enqueueUniquePeriodicWork(name, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
