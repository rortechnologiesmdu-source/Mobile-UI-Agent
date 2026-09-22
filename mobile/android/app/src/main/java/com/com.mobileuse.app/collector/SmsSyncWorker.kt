package com.mobileuse.app.collector

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private const val PREFS_NAME = "mobileuse_collector"
private const val KEY_LAST_SYNCED_SMS = "last_synced_sms_date"

// Runs on the WorkManager periodic schedule (see CollectorModule.scheduleSmsSync).
// Reads new inbox messages since the last sync via the SMS content provider —
// no live listener needed, this just catches up on each run (see
// MobileUse-Agent-Spec-main.md section 6.3: "ran late" batches are expected).
class SmsSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override fun doWork(): Result {
        val context = applicationContext
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            return Result.success() // nothing to do until the user grants READ_SMS
        }

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        // On the very first run there's no baseline yet — start from "now" so we
        // only ever pick up new messages going forward, not the entire SMS history.
        if (!prefs.contains(KEY_LAST_SYNCED_SMS)) {
            prefs.edit().putLong(KEY_LAST_SYNCED_SMS, System.currentTimeMillis()).apply()
            return Result.success()
        }
        val lastSynced = prefs.getLong(KEY_LAST_SYNCED_SMS, 0L)
        var maxDateSeen = lastSynced

        val cursor = context.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            "${Telephony.Sms.DATE} > ?",
            arrayOf(lastSynced.toString()),
            "${Telephony.Sms.DATE} ASC",
        ) ?: return Result.retry()

        cursor.use {
            val addressIdx = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyIdx = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateIdx = it.getColumnIndexOrThrow(Telephony.Sms.DATE)

            while (it.moveToNext()) {
                val date = it.getLong(dateIdx)
                val payload = JSONObject()
                    .put("sender", it.getString(addressIdx) ?: "")
                    .put("body", it.getString(bodyIdx) ?: "")

                BackendApi.ingestEvent("sms", payload, isoFormat.format(Date(date)))
                if (date > maxDateSeen) maxDateSeen = date
            }
        }

        if (maxDateSeen > lastSynced) {
            prefs.edit().putLong(KEY_LAST_SYNCED_SMS, maxDateSeen).apply()
        }
        return Result.success()
    }
}
