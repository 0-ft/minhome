package com.minhome.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.glance.*
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionSendBroadcast
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.*
import androidx.compose.ui.graphics.Color
import androidx.glance.unit.ColorProvider

class VoiceWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            VoiceWidgetContent()
        }
    }
}

@Composable
private fun VoiceWidgetContent() {
    val context = LocalContext.current
    val isActive = VoiceService.isRunning

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
