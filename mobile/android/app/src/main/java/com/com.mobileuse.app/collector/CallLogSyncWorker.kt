package com.mobileuse.app.collector

import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private const val PREFS_NAME = "mobileuse_collector"
// v2: earlier versions advanced the marker even when the upload failed. Renamed so
// upgrading installs backfill once, bounded to the dashboard's call-log window.
private const val KEY_LAST_SYNCED_CALL = "last_synced_call_date_v2"
private const val BACKFILL_WINDOW_MS = 48L * 60 * 60 * 1000

private fun callTypeLabel(type: Int): String = when (type) {
    CallLog.Calls.INCOMING_TYPE -> "incoming"
    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
    CallLog.Calls.MISSED_TYPE -> "missed"
    else -> "other"
}

// Same bounded-backfill pattern as SmsSync: the first run picks up only the last 48h
// (the dashboard's window), never someone's entire call history.
class CallLogSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun doWork(): Result {
        val context = applicationContext
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CALL_LOG)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return Result.success()
        }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val backfillCutoff = System.currentTimeMillis() - BACKFILL_WINDOW_MS
        val lastSynced = maxOf(prefs.getLong(KEY_LAST_SYNCED_CALL, 0L), backfillCutoff)
        var maxDateSeen = lastSynced

        val cursor = context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
            "${CallLog.Calls.DATE} > ?",
            arrayOf(lastSynced.toString()),
            "${CallLog.Calls.DATE} ASC",
        ) ?: return Result.retry()

        val events = mutableListOf<Pair<JSONObject, String>>()
        cursor.use {
            val numberIdx = it.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val typeIdx = it.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val dateIdx = it.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val durationIdx = it.getColumnIndexOrThrow(CallLog.Calls.DURATION)

            while (it.moveToNext()) {
                val date = it.getLong(dateIdx)
                val payload = JSONObject()
                    .put("number", it.getString(numberIdx) ?: "")
                    .put("type", callTypeLabel(it.getInt(typeIdx)))
                    .put("duration", it.getInt(durationIdx))

                events.add(payload to isoFormat.format(Date(date)))
                if (date > maxDateSeen) maxDateSeen = date
            }
        }

        if (!BackendApi.ingestEventsBlocking("call_log", events)) return Result.retry()
        if (maxDateSeen > lastSynced) {
            prefs.edit().putLong(KEY_LAST_SYNCED_CALL, maxDateSeen).apply()
        }
        return Result.success()
    }
}
