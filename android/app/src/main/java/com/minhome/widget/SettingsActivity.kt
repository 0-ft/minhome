package com.minhome.widget

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsActivity : ComponentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestPermissions()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    SettingsScreen(Prefs(this))
                }
            }
        }
    }

    private fun requestPermissions() {
        val needed = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) needed += Manifest.permission.RECORD_AUDIO
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) needed += Manifest.permission.POST_NOTIFICATIONS
        if (needed.isNotEmpty()) permissionLauncher.launch(needed.toTypedArray())
    }
}

@Composable
private fun SettingsScreen(prefs: Prefs) {
    var url by remember { mutableStateOf(prefs.serverUrl) }
    var password by remember { mutableStateOf("") }
    var status by remember { mutableStateOf(if (prefs.isLoggedIn) "Logged in" else "") }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Minhome", style = MaterialTheme.typography.headlineLarge)
        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Server URL") },
            placeholder = { Text("https://minhome.example.com") },
            singleLine = true,
            enabled = !prefs.isLoggedIn,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))

        if (!prefs.isLoggedIn) {
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(16.dp))

            Button(
                onClick = {
                    busy = true
                    status = "Logging in..."
                    scope.launch {
                        val result = withContext(Dispatchers.IO) {
                            ApiClient.login(url.trimEnd('/'), password)
                        }
                        result.onSuccess { jwt ->
                            prefs.serverUrl = url
                            prefs.sessionToken = jwt
                            password = ""
                            status = "Logged in"
                        }.onFailure { err ->
                            status = err.message ?: "Login failed"
                        }
                        busy = false
                    }
                },
                enabled = !busy && url.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Login")
            }
        } else {
            Button(
                onClick = {
                    prefs.logout()
                    status = ""
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error
                ),
            ) {
                Text("Logout")
            }
        }

        if (status.isNotBlank()) {
            Spacer(Modifier.height(16.dp))
            Text(status, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
