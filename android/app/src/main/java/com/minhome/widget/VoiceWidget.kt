package com.minhome.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.glance.*
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionSendBroadcast
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.layout.*
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.unit.ColorProvider

val ActiveKey = booleanPreferencesKey("voice_active")

class VoiceWidget : GlanceAppWidget() {
    override val stateDefinition = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            VoiceWidgetContent()
        }
    }

    companion object {
        suspend fun setActive(context: Context, active: Boolean) {
            val manager = GlanceAppWidgetManager(context)
            val ids = manager.getGlanceIds(VoiceWidget::class.java)
            val widget = VoiceWidget()
            ids.forEach { id ->
                updateAppWidgetState(context, PreferencesGlanceStateDefinition, id) { prefs ->
                    prefs.toMutablePreferences().apply { this[ActiveKey] = active }
                }
                widget.update(context, id)
            }
        }
    }
}

@Composable
private fun VoiceWidgetContent() {
    val context = LocalContext.current
    val prefs = currentState<androidx.datastore.preferences.core.Preferences>()
    val isActive = prefs[ActiveKey] ?: false

    Box(
        modifier = GlanceModifier
            .fillMaxSize()
            .background(ColorProvider(if (isActive) Color(0xFF1B5E20) else Color(0xFF1E293B)))
            .clickable(actionSendBroadcast(
                Intent(context, VoiceWidgetReceiver::class.java).setAction(ACTION_TOGGLE_VOICE)
            )),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            provider = ImageProvider(
                if (isActive) R.drawable.ic_mic_active else R.drawable.ic_mic
            ),
            contentDescription = "Voice",
            modifier = GlanceModifier.size(32.dp),
        )
    }
}

class VoiceWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget = VoiceWidget()

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_TOGGLE_VOICE) {
            VoiceService.toggle(context)
        }
    }
}

const val ACTION_TOGGLE_VOICE = "com.minhome.widget.TOGGLE_VOICE"
