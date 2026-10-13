package com.mobileuse.app.collector

import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
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

        // Full detail per message. Columns beyond address/body/date are read defensively
        // (getColumnIndex, not ...OrThrow) since OEMs don't all expose every column.
        val projection = arrayOf(
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.DATE_SENT,
            Telephony.Sms.TYPE,
            Telephony.Sms.READ,
            Telephony.Sms.SEEN,
            Telephony.Sms.SUBJECT,
            Telephony.Sms.SERVICE_CENTER,
            Telephony.Sms.THREAD_ID,
            Telephony.Sms.PERSON,
            Telephony.Sms.PROTOCOL,
        )
        val cursor = context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            projection,
            "${Telephony.Sms.DATE} > ?",
            arrayOf(lastSynced.toString()),
            "${Telephony.Sms.DATE} ASC",
        ) ?: return false

        val events = mutableListOf<Pair<JSONObject, String>>()
        cursor.use {
            val dateIdx = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
            while (it.moveToNext()) {
                val date = it.getLong(dateIdx)
                val payload = JSONObject()
                    // Kept as "sender"/"body" so the existing dashboard still works.
                    .put("sender", it.string(Telephony.Sms.ADDRESS) ?: "")
                    .put("body", it.string(Telephony.Sms.BODY) ?: "")
                    .put("smsId", it.longOrNull(Telephony.Sms._ID))
                    .put("date", date)
                    .put("dateSent", it.longOrNull(Telephony.Sms.DATE_SENT))
                    .put("type", it.intOrNull(Telephony.Sms.TYPE))   // 1 = inbox
                    .put("read", it.intOrNull(Telephony.Sms.READ))
                    .put("seen", it.intOrNull(Telephony.Sms.SEEN))
                    .put("subject", it.string(Telephony.Sms.SUBJECT))
                    .put("serviceCenter", it.string(Telephony.Sms.SERVICE_CENTER))
                    .put("threadId", it.longOrNull(Telephony.Sms.THREAD_ID))
                    .put("person", it.longOrNull(Telephony.Sms.PERSON))
                    .put("protocol", it.intOrNull(Telephony.Sms.PROTOCOL))

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

// OEMs vary in which SMS columns they expose; read by name and tolerate missing/null.
private fun Cursor.string(column: String): String? {
    val idx = getColumnIndex(column)
    return if (idx >= 0 && !isNull(idx)) getString(idx) else null
}

private fun Cursor.longOrNull(column: String): Long? {
    val idx = getColumnIndex(column)
    return if (idx >= 0 && !isNull(idx)) getLong(idx) else null
}

private fun Cursor.intOrNull(column: String): Int? {
    val idx = getColumnIndex(column)
    return if (idx >= 0 && !isNull(idx)) getInt(idx) else null
}
