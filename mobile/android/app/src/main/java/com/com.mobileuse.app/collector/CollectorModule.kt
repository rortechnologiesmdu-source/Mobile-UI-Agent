package com.mobileuse.app.collector

import android.content.Intent
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

class CollectorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "CollectorModule"

    @ReactMethod
    fun checkPermissions(promise: Promise) {
        val context = reactApplicationContext
        val enabledListeners = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners",
        ) ?: ""
        val notificationAccess = enabledListeners.contains(context.packageName)

        val smsPermission = ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.READ_SMS,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        val result: WritableMap = Arguments.createMap()
        result.putBoolean("notificationAccess", notificationAccess)
        result.putBoolean("smsPermission", smsPermission)
        promise.resolve(result)
    }

    @ReactMethod
    fun openNotificationAccessSettings() {
        val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
    }

    // Starts the foreground service (persistent "MobileUse is monitoring" notification)
    // and schedules the periodic SMS-sync WorkManager job. Safe to call every app launch.
    @ReactMethod
    fun startCollector() {
        val context = reactApplicationContext
        val serviceIntent = Intent(context, CollectorForegroundService::class.java)
        ContextCompat.startForegroundService(context, serviceIntent)

        val request = PeriodicWorkRequestBuilder<SmsSyncWorker>(15, TimeUnit.MINUTES).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            SMS_SYNC_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}
