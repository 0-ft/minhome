package com.minhome.widget

import android.content.Context
import android.content.SharedPreferences

class Prefs(context: Context) {
    private val prefs: SharedPreferences =
        context.getSharedPreferences("minhome_prefs", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("server_url", "") ?: ""
        set(value) = prefs.edit().putString("server_url", value.trimEnd('/')).apply()

    var sessionToken: String
        get() = prefs.getString("session_token", "") ?: ""
        set(value) = prefs.edit().putString("session_token", value).apply()

    val isLoggedIn: Boolean
        get() = serverUrl.isNotBlank() && sessionToken.isNotBlank()

    fun logout() {
        prefs.edit().remove("session_token").apply()
    }
}
