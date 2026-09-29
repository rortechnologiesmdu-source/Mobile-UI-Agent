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
import org.json.JSONArray

class AgentModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AgentModule"

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
        val metrics = reactApplicationContext.resources.displayMetrics
        val x = (point.getDouble("x") * metrics.widthPixels).toFloat()
        val y = (point.getDouble("y") * metrics.heightPixels).toFloat()
        return service.dispatchTap(x, y)
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
