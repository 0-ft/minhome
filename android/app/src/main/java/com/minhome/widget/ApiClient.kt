package com.minhome.widget

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object ApiClient {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    /** POST /api/auth/login -> extract JWT from Set-Cookie */
    fun login(serverUrl: String, password: String): Result<String> {
        val body = JSONObject().put("password", password).toString()
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("$serverUrl/api/auth/login")
            .post(body)
            .build()
        return try {
            http.newCall(request).execute().use { resp ->
                if (!resp.isSuccessful) {
                    return Result.failure(Exception("Login failed (${resp.code})"))
                }
                val jwt = resp.headers("Set-Cookie")
                    .firstNotNullOfOrNull { cookie ->
                        if (cookie.startsWith("minhome_session="))
                            cookie.substringAfter("minhome_session=").substringBefore(";")
                        else null
                    } ?: return Result.failure(Exception("No session cookie in response"))
                Result.success(jwt)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun sessionCookieHeader(jwt: String) = "minhome_session=$jwt"
}
