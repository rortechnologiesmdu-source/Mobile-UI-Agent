package com.mobileuse.app.collector

import android.util.Log
import com.mobileuse.app.BuildConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

// Set at build time from MOBILEUSE_BACKEND_URL in android/gradle.properties (the Mac's
// Wi-Fi address, or localhost with `adb reverse tcp:4000 tcp:4000` over USB).
private val BASE_URL = "${BuildConfig.BACKEND_URL}/api"

object BackendApi {
    private val client = OkHttpClient()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun ingestEvent(source: String, payload: JSONObject, deviceTimestampIso: String) {
        val event = JSONObject()
            .put("source", source)
            .put("payload", payload)
            .put("deviceTimestamp", deviceTimestampIso)

        val body = JSONObject().put("events", JSONArray().put(event))
        post("$BASE_URL/ingest", body)
    }

    // Sends a batch and waits for the backend to store it. Returns false on any failure,
    // so callers only move their "synced up to" marker once the data has really arrived —
    // otherwise everything read while the backend was down would be skipped for good.
    // Call from a background thread (workers / the SMS observer thread).
    fun ingestEventsBlocking(source: String, events: List<Pair<JSONObject, String>>): Boolean {
        if (events.isEmpty()) return true
        val batch = JSONArray()
        for ((payload, deviceTimestampIso) in events) {
            batch.put(
                JSONObject()
                    .put("source", source)
                    .put("payload", payload)
                    .put("deviceTimestamp", deviceTimestampIso),
            )
        }
        val request = Request.Builder()
            .url("$BASE_URL/ingest")
            .post(JSONObject().put("events", batch).toString().toRequestBody(jsonMediaType))
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) Log.w("MobileUse.BackendApi", "$source ingest failed: HTTP ${response.code}")
                response.isSuccessful
            }
        } catch (e: IOException) {
            Log.w("MobileUse.BackendApi", "$source ingest failed: ${e.message}")
            false
        }
    }

    private fun post(url: String, body: JSONObject) {
        val request = Request.Builder()
            .url(url)
            .post(body.toString().toRequestBody(jsonMediaType))
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.w("MobileUse.BackendApi", "ingest failed: ${e.message}")
            }

            override fun onResponse(call: Call, response: okhttp3.Response) {
                response.close()
            }
        })
    }
}
