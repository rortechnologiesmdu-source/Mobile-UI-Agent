package com.mobileuse.app.collector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

// Restarts the always-on SMS/collector foreground service after a reboot, so OTP
// capture keeps working 24/7 without the user having to reopen the app. BOOT_COMPLETED
// is an allowed reason to start a foreground service from the background.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON" // some OEMs (incl. vivo)
        ) {
            try {
                ContextCompat.startForegroundService(
                    context,
                    Intent(context, CollectorForegroundService::class.java),
                )
                Log.i("MobileUse.BootReceiver", "collector service started after boot")
            } catch (e: Exception) {
                Log.w("MobileUse.BootReceiver", "could not start collector after boot: ${e.message}")
            }
        }
    }
}
