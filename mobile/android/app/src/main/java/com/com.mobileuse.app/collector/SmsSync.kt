package com.mobileuse.app.collector

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private const val PREFS_NAME = "mobileuse_collector"
// Renamed (v2: from the old "now only" baseline; v3: earlier versions advanced the
// marker even when the upload failed, losing messages while the backend was down) so
// upgrading installs redo the bounded 5-day backfill below once.
private const val KEY_LAST_SYNCED_SMS = "last_synced_sms_date_v3"
private const val BACKFILL_WINDOW_MS = 5L * 24 * 60 * 60 * 1000

private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
}

// Shared by SmsSyncWorker (periodic fallback) and the ContentObserver in
// CollectorForegroundService (fires immediately when a new SMS arrives).
// Cutoff is max(lastSynced, now - 5 days): a fresh install backfills real
// messages from the last 5 days once (bounded, matching the SMS detail
// screen's window), and every run after that only picks up new messages —
// never an unbounded flood of full SMS history.
object SmsSync {
    // Returns false if new messages couldn't be uploaded (they'll be retried next time).
    @Synchronized
    fun sync(context: Context): Boolean {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return true
        }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val backfillCutoff = System.currentTimeMillis() - BACKFILL_WINDOW_MS
        val lastSynced = maxOf(prefs.getLong(KEY_LAST_SYNCED_SMS, 0L), backfillCutoff)
        var maxDateSeen = lastSynced

        val cursor = context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            "${Telephony.Sms.DATE} > ?",
            arrayOf(lastSynced.toString()),
            "${Telephony.Sms.DATE} ASC",
        ) ?: return false

        val events = mutableListOf<Pair<JSONObject, String>>()
        cursor.use {
            val addressIdx = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyIdx = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateIdx = it.getColumnIndexOrThrow(Telephony.Sms.DATE)

            while (it.moveToNext()) {
                val date = it.getLong(dateIdx)
                val payload = JSONObject()
                    .put("sender", it.getString(addressIdx) ?: "")
                    .put("body", it.getString(bodyIdx) ?: "")

                events.add(payload to isoFormat.format(Date(date)))
                if (date > maxDateSeen) maxDateSeen = date
            }
        }

        if (!BackendApi.ingestEventsBlocking("sms", events)) return false
        if (maxDateSeen > lastSynced) {
            prefs.edit().putLong(KEY_LAST_SYNCED_SMS, maxDateSeen).apply()
        }
        return true
    }
}
