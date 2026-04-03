package com.minhome.widget

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

class VoiceOverlayActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        VoiceService.start(this)

        setContent {
            val state by VoiceService.stateFlow.collectAsStateWithLifecycle()
            val userText by VoiceService.userTranscript.collectAsStateWithLifecycle()
            val assistantText by VoiceService.assistantTranscript.collectAsStateWithLifecycle()

            var hasBeenActive by remember { mutableStateOf(false) }
            LaunchedEffect(state) {
                if (state != VoiceState.IDLE) hasBeenActive = true
                if (state == VoiceState.IDLE && hasBeenActive) finish()
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() }
                    ) {
                        VoiceService.stop(this@VoiceOverlayActivity)
                        finish()
                    },
                contentAlignment = Alignment.Center
            ) {
                VoiceCard(
                    state = state,
                    userText = userText,
                    assistantText = assistantText,
                )
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        if (VoiceService.isRunning) {
            VoiceService.stop(this)
        }
    }
}

private val IdleBg = Color(0xFFE7D7C1)
private val IdleFg = Color(0xFF8D7368)
private val ConnectingBg = Color(0xFFF9DBD8)
private val ConnectingFg = Color(0xFF8C1C13)
private val ListeningBg = Color(0xFFBF4342)
private val ListeningFg = Color(0xFFFEFCF9)
private val RespondingBg = Color(0xFFF0B0AC)
private val RespondingFg = Color(0xFF6E150F)

private fun bgFor(state: VoiceState) = when (state) {
    VoiceState.IDLE -> IdleBg
    VoiceState.CONNECTING -> ConnectingBg
    VoiceState.LISTENING -> ListeningBg
    VoiceState.RESPONDING -> RespondingBg
}

private fun fgFor(state: VoiceState) = when (state) {
    VoiceState.IDLE -> IdleFg
    VoiceState.CONNECTING -> ConnectingFg
    VoiceState.LISTENING -> ListeningFg
    VoiceState.RESPONDING -> RespondingFg
}

@Composable
private fun VoiceCard(
    state: VoiceState,
    userText: String,
    assistantText: String,
) {
    val bg by animateColorAsState(
        targetValue = bgFor(state),
        animationSpec = tween(300, easing = EaseInOutCubic),
        label = "bg"
    )
    val fg by animateColorAsState(
        targetValue = fgFor(state),
        animationSpec = tween(300, easing = EaseInOutCubic),
        label = "fg"
    )

    val hasTranscript = userText.isNotBlank() || assistantText.isNotBlank()
    val scrollState = rememberScrollState()

    LaunchedEffect(assistantText) {
        scrollState.animateScrollTo(scrollState.maxValue)
    }

    Surface(
        modifier = Modifier
            .widthIn(max = 300.dp)
            .clickable(
                indication = null,
                interactionSource = remember { MutableInteractionSource() }
            ) { },
        shape = RoundedCornerShape(28.dp),
        color = bg,
        shadowElevation = 16.dp,
        tonalElevation = 0.dp,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(24.dp)
        ) {
            AnimatedContent(
                targetState = state,
                transitionSpec = {
                    fadeIn(tween(250)) togetherWith fadeOut(tween(200))
                },
                label = "voice-state"
            ) { targetState ->
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier
                        .size(64.dp)
                        .padding(4.dp)
                ) {
                    when (targetState) {
                        VoiceState.IDLE -> MicIcon(fg)
                        VoiceState.CONNECTING -> SpinningMic(fg)
                        VoiceState.LISTENING -> PulsingMic(fg)
                        VoiceState.RESPONDING -> BouncingDots(fg)
                    }
                }
            }

            AnimatedVisibility(
                visible = hasTranscript,
                enter = expandVertically() + fadeIn(),
            ) {
                Column(
                    modifier = Modifier
                        .padding(top = 16.dp)
                        .heightIn(max = 200.dp)
                        .verticalScroll(scrollState)
                ) {
                    if (userText.isNotBlank()) {
                        Text(
                            text = userText,
                            color = fg.copy(alpha = 0.7f),
                            fontSize = 14.sp,
                            fontStyle = FontStyle.Italic,
                            textAlign = TextAlign.Center,
                            lineHeight = 20.sp,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    if (assistantText.isNotBlank()) {
                        if (userText.isNotBlank()) {
                            Spacer(Modifier.height(12.dp))
                        }
                        Text(
                            text = assistantText,
                            color = fg,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            textAlign = TextAlign.Center,
                            lineHeight = 20.sp,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MicIcon(tint: Color) {
    Icon(
        painter = painterResource(R.drawable.ic_mic),
        contentDescription = "Microphone",
        tint = tint,
        modifier = Modifier.size(36.dp)
    )
}

@Composable
private fun SpinningMic(tint: Color) {
    val transition = rememberInfiniteTransition(label = "spin")
    val alpha by transition.animateFloat(
        initialValue = 0.4f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse
        ),
        label = "breathe"
    )
    val pulseScale by transition.animateFloat(
        initialValue = 0.9f,
        targetValue = 1.1f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse"
    )

    Icon(
        painter = painterResource(R.drawable.ic_mic),
        contentDescription = "Connecting",
        tint = tint.copy(alpha = alpha),
        modifier = Modifier
            .size(36.dp)
            .scale(pulseScale)
    )
}

@Composable
private fun PulsingMic(tint: Color) {
    val transition = rememberInfiniteTransition(label = "listen")
    val pulseScale by transition.animateFloat(
        initialValue = 1f,
        targetValue = 1.25f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, easing = EaseInOutSine),
            repeatMode = RepeatMode.Reverse
        ),
        label = "mic-pulse"
    )
    val ringAlpha by transition.animateFloat(
        initialValue = 0.4f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = EaseOut),
            repeatMode = RepeatMode.Restart
        ),
        label = "ring"
    )
    val ringScale by transition.animateFloat(
        initialValue = 1f,
        targetValue = 2f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = EaseOut),
            repeatMode = RepeatMode.Restart
        ),
        label = "ring-scale"
    )

    Box(contentAlignment = Alignment.Center) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .scale(ringScale)
                .background(tint.copy(alpha = ringAlpha), CircleShape)
        )
        Icon(
            painter = painterResource(R.drawable.ic_mic),
            contentDescription = "Listening",
            tint = tint,
            modifier = Modifier
                .size(36.dp)
                .scale(pulseScale)
        )
    }
}

@Composable
private fun BouncingDots(tint: Color) {
    val transition = rememberInfiniteTransition(label = "dots")
    val delays = listOf(0, 120, 240)

    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        delays.forEach { delayMs ->
            val offsetY by transition.animateFloat(
                initialValue = 0f,
                targetValue = -12f,
                animationSpec = infiniteRepeatable(
                    animation = keyframes {
                        durationMillis = 800
                        0f at delayMs using EaseInOutCubic
                        -12f at delayMs + 200 using EaseInOutCubic
                        0f at delayMs + 400 using EaseInOutCubic
                        0f at 800
                    },
                    repeatMode = RepeatMode.Restart
                ),
                label = "dot-$delayMs"
            )

            Box(
                modifier = Modifier
                    .size(10.dp)
                    .offset(y = offsetY.dp)
                    .background(tint, CircleShape)
            )
        }
    }
}
