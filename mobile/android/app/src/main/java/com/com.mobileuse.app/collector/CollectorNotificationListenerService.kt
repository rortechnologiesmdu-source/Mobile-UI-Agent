package com.mobileuse.app.collector

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// Event-driven feed of notifications from every other app on the phone — richest
// Agent 1 data source per MobileUse-Agent-Spec-main.md section 3.2. Android can
// silently revoke this permission for unused apps; see CollectorModule.checkPermissions.
class CollectorNotificationListenerService : NotificationListenerService() {

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // Ignore our own foreground-service notification to avoid feedback noise.
        if (sbn.packageName == applicationContext.packageName) return

        val extras = sbn.notification.extras
        val payload = JSONObject()
            .put("packageName", sbn.packageName)
            .put("title", extras.getCharSequence("android.title")?.toString() ?: "")
            .put("text", extras.getCharSequence("android.text")?.toString() ?: "")
            .put("postTime", sbn.postTime)

        BackendApi.ingestEvent("notification", payload, isoFormat.format(Date(sbn.postTime)))
    }
}
