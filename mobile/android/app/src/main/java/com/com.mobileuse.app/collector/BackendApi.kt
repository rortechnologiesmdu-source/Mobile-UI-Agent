package com.mobileuse.app.collector

import android.util.Log
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

// Backend is only reachable via `adb reverse tcp:4000 tcp:4000` while the phone
// is on USB, per the current dev setup (see MobileUse-Agent-Spec-main.md section 7).
private const val BASE_URL = "http://localhost:4000/api"

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
