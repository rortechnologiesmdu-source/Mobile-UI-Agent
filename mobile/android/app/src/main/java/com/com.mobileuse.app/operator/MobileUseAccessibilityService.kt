package com.mobileuse.app.operator

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.Display
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "MobileUse.Operator"
private const val MAX_TREE_NODES = 400
private const val MAX_SCREENSHOT_WIDTH = 540
private const val CONFIRM_TIMEOUT_S = 60L
private const val OVERLAY_GONE_DELAY_MS = 300L

// Agent 2's "body" — perception (accessibility tree + screenshot) and actuation
// (tap/type/swipe/launch/back/home). No intelligence here; AgentModule bridges
// this to JS, which drives the observe-decide-act loop against the backend's
// Gemini-backed decision endpoint. See MobileUse-Agent-Spec.md section 5.
class MobileUseAccessibilityService : AccessibilityService() {

    private val screenshotExecutor: Executor = Executors.newSingleThreadExecutor()
    // Runs the timeout watchdog on its own thread/scheduler — deliberately NOT
    // tied to the main Looper, since a hang there (observed on this device)
    // would otherwise take the safeguard down with it.
    private val watchdog: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    // UI work (the confirmation overlay) has to run on the main thread.
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        var instance: MobileUseAccessibilityService? = null
            private set
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.i(TAG, "onServiceConnected")
        instance = this
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Pull-based design: JS asks for an observation on demand rather than
        // reacting to every event, so there's nothing to do here.
    }

    override fun onInterrupt() {}

    fun getCurrentPackageName(): String? = rootInActiveWindow?.packageName?.toString()

    fun getAccessibilityTree(): JSONArray {
        val tree = JSONArray()
        val root = rootInActiveWindow
        Log.i(TAG, "getAccessibilityTree: rootInActiveWindow=${root != null}")
        if (root == null) return tree
        val counter = intArrayOf(0)
        walk(root, tree, counter)
        Log.i(TAG, "getAccessibilityTree: collected ${tree.length()} nodes")
        return tree
    }

    private fun walk(node: AccessibilityNodeInfo, out: JSONArray, counter: IntArray) {
        if (counter[0] >= MAX_TREE_NODES) return
        val text = node.text?.toString().orEmpty()
        val desc = node.contentDescription?.toString().orEmpty()

        if (text.isNotBlank() || desc.isNotBlank() || node.isClickable) {
            val bounds = Rect()
            node.getBoundsInScreen(bounds)
            out.put(
                JSONObject()
                    .put("text", text)
                    .put("contentDescription", desc)
                    .put("className", node.className?.toString()?.substringAfterLast('.') ?: "")
                    .put("clickable", node.isClickable)
                    .put("scrollable", node.isScrollable)
                    .put(
                        "bounds",
                        JSONObject()
                            .put("left", bounds.left)
                            .put("top", bounds.top)
                            .put("right", bounds.right)
                            .put("bottom", bounds.bottom),
                    ),
            )
            counter[0]++
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            walk(child, out, counter)
            child.recycle()
        }
    }

    // Finds the best-matching node for a free-text description (case-insensitive
    // substring match either direction), then walks up to the nearest clickable
    // ancestor since the matched text/description node itself often isn't the
    // clickable one (e.g. a TextView inside a Button).
    fun findClickableNodeByDescription(description: String): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        val needle = description.trim().lowercase()
        if (needle.isEmpty()) return null

        var best: AccessibilityNodeInfo? = null
        fun search(node: AccessibilityNodeInfo) {
            if (best != null) return
            val text = node.text?.toString()?.lowercase().orEmpty()
            val desc = node.contentDescription?.toString()?.lowercase().orEmpty()
            if ((text.isNotEmpty() && (text.contains(needle) || needle.contains(text))) ||
                (desc.isNotEmpty() && (desc.contains(needle) || needle.contains(desc)))
            ) {
                best = node
                return
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                search(child)
                if (best != null) return
            }
        }
        search(root)

        var candidate = best
        var depth = 0
        while (candidate != null && !candidate.isClickable && depth < 6) {
            candidate = candidate.parent
            depth++
        }
        return candidate
    }

    fun performClick(node: AccessibilityNodeInfo): Boolean =
        node.performAction(AccessibilityNodeInfo.ACTION_CLICK)

    fun dispatchTap(x: Float, y: Float): Boolean = dispatchPress(x, y, 50)

    // Held past Android's long-press threshold (ViewConfiguration default ~400-500ms).
    fun dispatchLongPress(x: Float, y: Float): Boolean = dispatchPress(x, y, 600)

    private fun dispatchPress(x: Float, y: Float, durationMs: Long): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture, null, null)
    }

    fun dispatchSwipe(direction: String): Boolean {
        val metrics = resources.displayMetrics
        val width = metrics.widthPixels.toFloat()
        val height = metrics.heightPixels.toFloat()
        val centerX = width / 2
        val centerY = height / 2

        val path = Path()
        when (direction) {
            "up" -> {
                path.moveTo(centerX, height * 0.75f)
                path.lineTo(centerX, height * 0.25f)
            }
            "down" -> {
                path.moveTo(centerX, height * 0.25f)
                path.lineTo(centerX, height * 0.75f)
            }
            "left" -> {
                path.moveTo(width * 0.75f, centerY)
                path.lineTo(width * 0.25f, centerY)
            }
            "right" -> {
                path.moveTo(width * 0.25f, centerY)
                path.lineTo(width * 0.75f, centerY)
            }
            else -> return false
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 200)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        return dispatchGesture(gesture, null, null)
    }

    fun typeText(node: AccessibilityNodeInfo, text: String): Boolean {
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    fun findFocusedEditableNode(): AccessibilityNodeInfo? {
        val root = rootInActiveWindow ?: return null
        var found: AccessibilityNodeInfo? = null
        fun search(node: AccessibilityNodeInfo) {
            if (found != null) return
            if (node.isEditable && node.isFocused) {
                found = node
                return
            }
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                search(child)
                if (found != null) return
            }
        }
        search(root)
        if (found == null) {
            // Fall back to the first editable node if nothing is explicitly focused.
            fun searchEditable(node: AccessibilityNodeInfo) {
                if (found != null) return
                if (node.isEditable) {
                    found = node
                    return
                }
                for (i in 0 until node.childCount) {
                    val child = node.getChild(i) ?: continue
                    searchEditable(child)
                    if (found != null) return
                }
            }
            searchEditable(root)
        }
        return found
    }

    // Asks the user to allow an action, on top of whatever app is showing. Drawn as an
    // accessibility overlay so it needs no extra permission. Unanswered counts as "no".
    fun showConfirmation(message: String, onResult: (Boolean) -> Unit) {
        mainHandler.post {
            val windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
            val pad = (16 * resources.displayMetrics.density).toInt()
            val panel = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad, pad, pad)
                setBackgroundColor(Color.parseColor("#F0202124"))
            }
            val settled = AtomicBoolean(false)
            // The panel sits over the bottom of the screen — often right on the Send button
            // the agent is about to tap — so it must be fully gone before the result is
            // reported, or the agent's tap lands on the vanishing panel.
            fun settle(allowed: Boolean) {
                if (!settled.compareAndSet(false, true)) return
                mainHandler.post {
                    runCatching { windowManager.removeViewImmediate(panel) }
                    Log.i(TAG, "showConfirmation: allowed=$allowed")
                    mainHandler.postDelayed({ onResult(allowed) }, OVERLAY_GONE_DELAY_MS)
                }
            }
            panel.addView(TextView(this).apply {
                text = message
                setTextColor(Color.WHITE)
                textSize = 16f
            })
            val buttons = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.END
            }
            buttons.addView(Button(this).apply {
                text = "Cancel"
                setOnClickListener { settle(false) }
            })
            buttons.addView(Button(this).apply {
                text = "Allow"
                setOnClickListener { settle(true) }
            })
            panel.addView(buttons)

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT,
            ).apply { gravity = Gravity.BOTTOM }

            try {
                windowManager.addView(panel, params)
            } catch (e: Exception) {
                Log.w(TAG, "showConfirmation: overlay failed: ${e.message}")
                settle(false)
                return@post
            }
            watchdog.schedule({ settle(false) }, CONFIRM_TIMEOUT_S, TimeUnit.SECONDS)
        }
    }

    fun goBack(): Boolean = performGlobalAction(GLOBAL_ACTION_BACK)
    fun goHome(): Boolean = performGlobalAction(GLOBAL_ACTION_HOME)

    // Requires API 30+ (Android 11). Below that, or if the OEM's implementation
    // of takeScreenshot() never invokes either callback (observed on some
    // Vivo/OriginOS builds), a timeout guard falls back to no screenshot rather
    // than hanging the whole agent loop forever.
    fun captureScreenshotBase64(onResult: (String?) -> Unit) {
        Log.i(TAG, "captureScreenshotBase64: start (SDK ${Build.VERSION.SDK_INT})")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            Log.i(TAG, "captureScreenshotBase64: below API 30, skipping")
            onResult(null)
            return
        }

        val settled = AtomicBoolean(false)
        fun settle(value: String?) {
            if (settled.compareAndSet(false, true)) {
                Log.i(TAG, "captureScreenshotBase64: settled (hasImage=${value != null})")
                onResult(value)
            }
        }

        val timeoutFuture = watchdog.schedule({
            Log.w(TAG, "takeScreenshot timed out after 4s, proceeding without a screenshot")
            settle(null)
        }, 4, TimeUnit.SECONDS)

        try {
            Log.i(TAG, "captureScreenshotBase64: calling takeScreenshot")
            takeScreenshot(
                Display.DEFAULT_DISPLAY,
                screenshotExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(result: ScreenshotResult) {
                        timeoutFuture.cancel(false)
                        try {
                            val bitmap = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                            if (bitmap == null) {
                                settle(null)
                                return
                            }
                            val fullBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, false)
                            // Downscale before sending to Gemini — a full-resolution
                            // screenshot (e.g. 1080x2400) adds meaningfully to upload
                            // and model processing time for no real benefit; the UI
                            // is readable fine at a fraction of that.
                            val scale = MAX_SCREENSHOT_WIDTH.toFloat() / fullBitmap.width
                            val softwareBitmap = if (scale < 1f) {
                                Bitmap.createScaledBitmap(
                                    fullBitmap,
                                    MAX_SCREENSHOT_WIDTH,
                                    (fullBitmap.height * scale).toInt(),
                                    true,
                                )
                            } else {
                                fullBitmap
                            }
                            val stream = ByteArrayOutputStream()
                            softwareBitmap.compress(Bitmap.CompressFormat.JPEG, 60, stream)
                            settle(Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP))
                            if (softwareBitmap !== fullBitmap) softwareBitmap.recycle()
                            fullBitmap.recycle()
                            bitmap.recycle()
                        } catch (e: Exception) {
                            Log.w(TAG, "screenshot processing failed: ${e.message}")
                            settle(null)
                        } finally {
                            result.hardwareBuffer.close()
                        }
                    }

                    override fun onFailure(errorCode: Int) {
                        timeoutFuture.cancel(false)
                        Log.w(TAG, "takeScreenshot failed: $errorCode")
                        settle(null)
                    }
                },
            )
            Log.i(TAG, "captureScreenshotBase64: takeScreenshot call returned (async callback pending)")
        } catch (e: Exception) {
            timeoutFuture.cancel(false)
            Log.w(TAG, "takeScreenshot threw: ${e.message}")
            settle(null)
        }
    }
}
