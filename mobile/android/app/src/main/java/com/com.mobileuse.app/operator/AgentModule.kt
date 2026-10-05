package com.mobileuse.app.operator

import android.content.Intent
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.mobileuse.app.BuildConfig
import org.json.JSONArray
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

private const val WAIT_MS = 1500L

class AgentModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    // Own scheduler rather than the main Looper, for the same reason as the
    // screenshot watchdog in MobileUseAccessibilityService.
    private val settleScheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

    override fun getName() = "AgentModule"

    // Waits for the UI to settle after an action. Done natively because React
    // Native pauses JS timers while the app is backgrounded — which is exactly
    // when the agent is operating other apps — so a JS setTimeout here would
    // stall the observe-decide-act loop after the first action that leaves the app.
    @ReactMethod
    fun settle(ms: Double, promise: Promise) {
        settleScheduler.schedule({ promise.resolve(null) }, ms.toLong(), TimeUnit.MILLISECONDS)
    }

    // Backend base URL, set at build time from MOBILEUSE_BACKEND_URL in android/gradle.properties.
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getBackendUrl(): String = BuildConfig.BACKEND_URL

    // Apps with a launcher icon, as [{ label, package }], so the model's "open <app>" can
    // be resolved against what's actually installed instead of a hand-kept list.
    @ReactMethod
    fun getInstalledApps(promise: Promise) {
        try {
            val pm = reactApplicationContext.packageManager
            val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val apps = Arguments.createArray()
            pm.queryIntentActivities(launcherIntent, 0)
                .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
                .filter { (pkg, _) -> pkg != reactApplicationContext.packageName }
                .distinctBy { (pkg, _) -> pkg }
                .sortedBy { (_, label) -> label.lowercase() }
                .forEach { (pkg, label) ->
                    apps.pushMap(Arguments.createMap().apply {
                        putString("label", label)
                        putString("package", pkg)
                    })
                }
            promise.resolve(apps)
        } catch (e: Exception) {
            Log.w("MobileUse.AgentModule", "getInstalledApps failed: ${e.message}")
            promise.resolve(Arguments.createArray())
        }
    }

    // Shows an Allow/Cancel prompt over the current app; resolves true only if allowed.
    @ReactMethod
    fun confirmAction(message: String, promise: Promise) {
        val service = MobileUseAccessibilityService.instance
        if (service == null) {
            promise.resolve(false)
            return
        }
        service.showConfirmation(message) { allowed -> promise.resolve(allowed) }
    }

    // Returns the user to this app (the Agent screen) after a run ends. Started from the
    // accessibility service's context, which Android allows from the background.
    @ReactMethod
    fun bringAppToFront() {
        val context = reactApplicationContext
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        try {
            (MobileUseAccessibilityService.instance ?: context).startActivity(intent)
        } catch (e: Exception) {
            Log.w("MobileUse.AgentModule", "bringAppToFront failed: ${e.message}")
        }
    }

    @ReactMethod
    fun checkAccessibilityEnabled(promise: Promise) {
        val context = reactApplicationContext
        val enabledServices = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: ""
        promise.resolve(enabledServices.contains(context.packageName))
    }

    @ReactMethod
    fun openAccessibilitySettings() {
        val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
    }

    // Combines current app + accessibility tree + screenshot into one observation,
    // matching the shape backend's /api/agent2/runs/:id/step expects.
    @ReactMethod
    fun getObservation(promise: Promise) {
        Log.i("MobileUse.AgentModule", "getObservation called")
        val service = MobileUseAccessibilityService.instance
        if (service == null) {
            Log.w("MobileUse.AgentModule", "getObservation: service instance is null")
            promise.reject("NO_SERVICE", "Accessibility service not connected — enable it in Settings first")
            return
        }

        try {
            val currentApp = service.getCurrentPackageName() ?: ""
            Log.i("MobileUse.AgentModule", "getObservation: currentApp=$currentApp")
            val tree = service.getAccessibilityTree()

            service.captureScreenshotBase64 { base64 ->
                Log.i("MobileUse.AgentModule", "getObservation: resolving promise")
                val result = Arguments.createMap()
                result.putString("currentApp", currentApp)
                result.putArray("accessibilityTree", jsonArrayToWritableArray(tree))
                result.putString("screenshotBase64", base64 ?: "")
                // Same basis toScreenPoint() uses, so the backend can map a 0-1 point
                // to the accessibility node it lands on.
                val metrics = reactApplicationContext.resources.displayMetrics
                result.putInt("screenWidth", metrics.widthPixels)
                result.putInt("screenHeight", metrics.heightPixels)
                promise.resolve(result)
            }
        } catch (e: Exception) {
            Log.e("MobileUse.AgentModule", "getObservation failed", e)
            promise.reject("OBSERVATION_FAILED", e)
        }
    }

    @ReactMethod
    fun executeAction(action: ReadableMap, promise: Promise) {
        val type = action.getString("action")
        Log.i("MobileUse.AgentModule", "executeAction called: $type")
        val service = MobileUseAccessibilityService.instance
        if (service == null) {
            Log.w("MobileUse.AgentModule", "executeAction: service instance is null")
            promise.reject("NO_SERVICE", "Accessibility service not connected")
            return
        }

        try {
            val handled = when (type) {
                "tap" -> handleTap(service, action)
                "long_press" -> {
                    val point = action.getMap("target")?.getMap("point")
                    if (point != null) {
                        val (x, y) = toScreenPoint(point)
                        service.dispatchLongPress(x, y)
                    } else {
                        false
                    }
                }
                // Gives a loading screen time to finish before the next observation.
                "wait" -> {
                    settleScheduler.schedule({ promise.resolve(true) }, WAIT_MS, TimeUnit.MILLISECONDS)
                    Log.i("MobileUse.AgentModule", "executeAction wait: ${WAIT_MS}ms")
                    return
                }
                "type" -> {
                    val text = action.getString("text") ?: ""
                    val node = service.findFocusedEditableNode()
                    if (node != null) service.typeText(node, text) else false
                }
                "swipe" -> service.dispatchSwipe(action.getString("direction") ?: "up")
                "launch_app" -> launchApp(action.getString("package") ?: "")
                "press_back" -> service.goBack()
                "press_home" -> service.goHome()
                "done" -> true
                else -> {
                    Log.w("MobileUse.AgentModule", "executeAction: unknown action $type")
                    promise.reject("UNKNOWN_ACTION", "unknown action: $type")
                    return
                }
            }
            Log.i("MobileUse.AgentModule", "executeAction $type result: $handled")
            promise.resolve(handled)
        } catch (e: Exception) {
            Log.e("MobileUse.AgentModule", "executeAction $type failed", e)
            promise.reject("EXECUTE_FAILED", e)
        }
    }

    // Accessibility-node match first (reliable, exact bounds); vision bounding-box
    // point fallback second — see MobileUse-Agent-Spec.md section 5.
    private fun handleTap(service: MobileUseAccessibilityService, action: ReadableMap): Boolean {
        val target = action.getMap("target")
        val description = target?.getString("description") ?: ""

        val node = service.findClickableNodeByDescription(description)
        if (node != null && service.performClick(node)) return true

        val point = target?.getMap("point") ?: return false
        val (x, y) = toScreenPoint(point)
        return service.dispatchTap(x, y)
    }

    // Converts a 0-1 fractional point into screen pixels.
    private fun toScreenPoint(point: ReadableMap): Pair<Float, Float> {
        val metrics = reactApplicationContext.resources.displayMetrics
        return Pair(
            (point.getDouble("x") * metrics.widthPixels).toFloat(),
            (point.getDouble("y") * metrics.heightPixels).toFloat(),
        )
    }

    private fun launchApp(packageName: String): Boolean {
        val intent = reactApplicationContext.packageManager.getLaunchIntentForPackage(packageName)
        if (intent == null) {
            Log.w("MobileUse.AgentModule", "launchApp: no launch intent for $packageName")
            return false
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
        Log.i("MobileUse.AgentModule", "launchApp: startActivity called for $packageName")
        return true
    }

    private fun jsonArrayToWritableArray(array: JSONArray): WritableArray {
        val result = Arguments.createArray()
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            val map = Arguments.createMap()
            map.putString("text", obj.optString("text"))
            map.putString("contentDescription", obj.optString("contentDescription"))
            map.putString("className", obj.optString("className"))
            map.putBoolean("clickable", obj.optBoolean("clickable"))
            map.putBoolean("scrollable", obj.optBoolean("scrollable"))
            val bounds = obj.optJSONObject("bounds")
            if (bounds != null) {
                val boundsMap = Arguments.createMap()
                boundsMap.putInt("left", bounds.optInt("left"))
                boundsMap.putInt("top", bounds.optInt("top"))
                boundsMap.putInt("right", bounds.optInt("right"))
                boundsMap.putInt("bottom", bounds.optInt("bottom"))
                map.putMap("bounds", boundsMap)
            }
            result.pushMap(map)
        }
        return result
    }
}
