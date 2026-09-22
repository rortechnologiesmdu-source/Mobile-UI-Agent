package com.mobileuse.app.collector

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

private const val CHANNEL_ID = "mobileuse_collector_channel"
private const val NOTIFICATION_ID = 1001

// Kept running so Agent 1 survives in the background; the persistent notification
// is intentional and transparent to the user (MobileUse-Agent-Spec-main.md 3.4).
class CollectorForegroundService : Service() {

    override fun onCreate() {
        super.onCreate()
        createChannelIfNeeded()
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
