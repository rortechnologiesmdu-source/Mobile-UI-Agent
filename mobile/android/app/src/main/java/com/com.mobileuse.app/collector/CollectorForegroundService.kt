package com.mobileuse.app.collector

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.database.ContentObserver
import android.os.Build
import android.os.HandlerThread
import android.os.IBinder
import android.provider.Telephony
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

private const val CHANNEL_ID = "mobileuse_collector_channel"
private const val NOTIFICATION_ID = 1001

// Kept running so Agent 1 survives in the background; the persistent notification
// is intentional and transparent to the user (MobileUse-Agent-Spec-main.md 3.4).
//
// Also registers a ContentObserver on the SMS provider so new messages sync
// immediately instead of waiting for the next 15-minute WorkManager tick —
// same event-driven approach the spec already uses for notifications.
class CollectorForegroundService : Service() {

    private var handlerThread: HandlerThread? = null
    private var smsObserver: ContentObserver? = null

    override fun onCreate() {
        super.onCreate()
        createChannelIfNeeded()

        val thread = HandlerThread("MobileUseSmsObserver").apply { start() }
        handlerThread = thread

        val observer = object : ContentObserver(android.os.Handler(thread.looper)) {
            override fun onChange(selfChange: Boolean) {
                SmsSync.sync(applicationContext)
            }
        }
        smsObserver = observer
        contentResolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, observer)

        // Catch up immediately on start rather than waiting for the first change.
        android.os.Handler(thread.looper).post { SmsSync.sync(applicationContext) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MobileUse")
            .setContentText("MobileUse is monitoring your data")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .build()

        startForeground(NOTIFICATION_ID, notification)
        return START_STICKY
    }

    override fun onDestroy() {
        smsObserver?.let { contentResolver.unregisterContentObserver(it) }
        handlerThread?.quitSafely()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = ContextCompat.getSystemService(this, NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "MobileUse background monitoring",
            NotificationManager.IMPORTANCE_LOW,
        )
        manager?.createNotificationChannel(channel)
    }
}
