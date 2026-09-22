package com.mobileuse.app.collector

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters

// Periodic fallback in case the live ContentObserver (registered in
// CollectorForegroundService) misses an update or the service was killed and
// restarted — see SmsSync for the actual sync logic shared by both paths.
class SmsSyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        SmsSync.sync(applicationContext)
        return Result.success()
    }
}
