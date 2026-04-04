package com.minhome.widget

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

data class ListColumn(val id: String, val name: String, val icon: String?)
data class ListItem(val id: Int, val title: String, val statusId: String)
data class ListData(
    val id: String,
    val name: String,
    val columns: List<ListColumn>,
    val items: List<ListItem>,
)

object ListApi {

    fun fetchAllLists(prefs: Prefs): List<ListData> {
        val request = Request.Builder()
            .url("${prefs.serverUrl}/api/lists")
            .header("Cookie", ApiClient.sessionCookieHeader(prefs.sessionToken))
            .build()
        ApiClient.http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw Exception("Failed to fetch lists (${resp.code})")
            val arr = JSONArray(resp.body!!.string())
            return (0 until arr.length()).map { parseList(arr.getJSONObject(it)) }
        }
    }

    fun fetchList(prefs: Prefs, listId: String, context: Context? = null): ListData {
        val request = Request.Builder()
            .url("${prefs.serverUrl}/api/lists/$listId")
            .header("Cookie", ApiClient.sessionCookieHeader(prefs.sessionToken))
            .build()
        ApiClient.http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw Exception("Failed to fetch list (${resp.code})")
            val data = parseList(JSONObject(resp.body!!.string()))
            if (context != null) {
                ListWidgetReceiver.refreshFromData(context, data)
            }
            return data
        }
    }

    fun moveItem(prefs: Prefs, listId: String, itemId: Int, newStatusId: String) {
        val body = JSONObject().put("status_id", newStatusId)
        val request = Request.Builder()
            .url("${prefs.serverUrl}/api/lists/$listId/items/$itemId/status")
            .patch(body.toString().toRequestBody("application/json".toMediaType()))
            .header("Cookie", ApiClient.sessionCookieHeader(prefs.sessionToken))
            .build()
        ApiClient.http.newCall(request).execute().use { resp ->
            if (!resp.isSuccessful) throw Exception("Failed to move item (${resp.code})")
        }
    }

    private fun parseList(obj: JSONObject): ListData {
        val cols = obj.getJSONArray("columns")
        val items = obj.optJSONArray("items") ?: JSONArray()
        return ListData(
            id = obj.getString("id"),
            name = obj.getString("name"),
            columns = (0 until cols.length()).map { i ->
                val c = cols.getJSONObject(i)
                ListColumn(c.getString("id"), c.getString("name"), c.optString("icon").ifEmpty { null })
            },
            items = (0 until items.length()).map { i ->
                val it = items.getJSONObject(i)
                ListItem(it.getInt("id"), it.getString("title"), it.getString("statusId"))
            },
        )
    }
}
