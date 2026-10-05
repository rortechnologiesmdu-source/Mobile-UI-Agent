package com.mobileuse.app.collector

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
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
// upgrading installs backfill once, bounded to the dashboard's 7-day files window.
private const val KEY_LAST_SYNCED_FILE = "last_synced_file_date_seconds_v2"
private const val BACKFILL_WINDOW_S = 7L * 24 * 60 * 60

// "Files" here means recently-added photos via MediaStore's Images collection.
// Scoped storage on modern Android blocks broad filesystem/Downloads access
// without the separate MANAGE_EXTERNAL_STORAGE permission (the same kind of
// special-permission revocation risk flagged for NotificationListenerService
// in MobileUse-Agent-Spec-main.md section 3.3) — MediaStore Images is the
// data v0.1 can reach with a normal runtime permission.
class FileSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    private fun hasMediaPermission(context: Context): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            android.Manifest.permission.READ_MEDIA_IMAGES
        } else {
            android.Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }

    override fun doWork(): Result {
        val context = applicationContext
        if (!hasMediaPermission(context)) return Result.success()

        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val backfillCutoff = System.currentTimeMillis() / 1000 - BACKFILL_WINDOW_S
        val lastSynced = maxOf(prefs.getLong(KEY_LAST_SYNCED_FILE, 0L), backfillCutoff)
        var maxDateSeen = lastSynced

        val cursor = context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.SIZE,
                MediaStore.Images.Media.DATE_ADDED,
                MediaStore.Images.Media.MIME_TYPE,
            ),
            "${MediaStore.Images.Media.DATE_ADDED} > ?",
            arrayOf(lastSynced.toString()),
            "${MediaStore.Images.Media.DATE_ADDED} ASC",
        ) ?: return Result.retry()

        val events = mutableListOf<Pair<JSONObject, String>>()
        cursor.use {
            val nameIdx = it.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val sizeIdx = it.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
            val dateIdx = it.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            val mimeIdx = it.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE)

            while (it.moveToNext()) {
                val dateAddedSeconds = it.getLong(dateIdx)
                val payload = JSONObject()
                    .put("name", it.getString(nameIdx) ?: "")
                    .put("size", it.getLong(sizeIdx))
                    .put("mimeType", it.getString(mimeIdx) ?: "")

                events.add(payload to isoFormat.format(Date(dateAddedSeconds * 1000)))
                if (dateAddedSeconds > maxDateSeen) maxDateSeen = dateAddedSeconds
            }
        }

        if (!BackendApi.ingestEventsBlocking("file", events)) return Result.retry()
        if (maxDateSeen > lastSynced) {
            prefs.edit().putLong(KEY_LAST_SYNCED_FILE, maxDateSeen).apply()
        }
        return Result.success()
    }
}
