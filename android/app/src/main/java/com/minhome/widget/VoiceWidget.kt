package com.minhome.widget

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.*
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionSendBroadcast
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.layout.*
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.unit.ColorProvider

val StatusKey = stringPreferencesKey("voice_status")

enum class VoiceState(
    val bg: Color,
    val fg: Color,
    val icon: Int,
) {
    IDLE(Color(0xFFE7D7C1), Color(0xFF8D7368), R.drawable.ic_mic),
    CONNECTING(Color(0xFFF9DBD8), Color(0xFF8C1C13), R.drawable.ic_mic),
    LISTENING(Color(0xFFBF4342), Color(0xFFFEFCF9), R.drawable.ic_mic),
    RESPONDING(Color(0xFFF0B0AC), Color(0xFF6E150F), R.drawable.ic_dots);

    companion object {
        fun from(s: String?) = entries.find { it.name.equals(s, ignoreCase = true) } ?: IDLE
    }
}

class VoiceWidget : GlanceAppWidget() {
    override val stateDefinition = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent { VoiceWidgetContent() }
    }

    companion object {
        suspend fun setStatus(context: Context, status: String) {
            val manager = GlanceAppWidgetManager(context)
            val ids = manager.getGlanceIds(VoiceWidget::class.java)
            val widget = VoiceWidget()
            ids.forEach { id ->
                updateAppWidgetState(context, PreferencesGlanceStateDefinition, id) { prefs ->
                    prefs.toMutablePreferences().apply { this[StatusKey] = status }
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
    val state = VoiceState.from(prefs[StatusKey])

    if (state == VoiceState.RESPONDING) {
        val rv = RemoteViews(context.packageName, R.layout.widget_dots_animated)
        Box(
            modifier = GlanceModifier
                .fillMaxSize()
                .cornerRadius(16.dp)
                .clickable(actionSendBroadcast(
                    Intent(context, VoiceWidgetReceiver::class.java).setAction(ACTION_TOGGLE_VOICE)
                )),
            contentAlignment = Alignment.Center,
        ) {
            AndroidRemoteViews(rv, modifier = GlanceModifier.fillMaxSize())
        }
    } else {
        Box(
            modifier = GlanceModifier
                .fillMaxSize()
                .cornerRadius(16.dp)
                .background(ColorProvider(state.bg))
                .clickable(actionSendBroadcast(
                    Intent(context, VoiceWidgetReceiver::class.java).setAction(ACTION_TOGGLE_VOICE)
                )),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                provider = ImageProvider(state.icon),
                contentDescription = "Voice",
                modifier = GlanceModifier.size(48.dp),
                colorFilter = ColorFilter.tint(ColorProvider(state.fg)),
            )
        }
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
