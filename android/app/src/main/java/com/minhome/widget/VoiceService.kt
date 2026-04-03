package com.minhome.widget

import android.app.*
import android.content.Context
import android.content.Intent
import android.media.*
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder

class VoiceService : Service() {

    companion object {
        const val TAG = "VoiceService"
        const val CHANNEL_ID = "minhome_voice"
        const val NOTIFICATION_ID = 1
        const val SAMPLE_RATE = 24000

        @Volatile
        var isRunning = false
            private set

        fun toggle(context: Context) {
            if (isRunning) {
                context.stopService(Intent(context, VoiceService::class.java))
            } else {
                val intent = Intent(context, VoiceService::class.java)
                context.startForegroundService(intent)
            }
        }
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var webSocket: WebSocket? = null
    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var recording = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "STOP") {
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification("Connecting..."))
        isRunning = true
        scope.launch { VoiceWidget.setActive(applicationContext, true) }

        val prefs = Prefs(this)
        if (!prefs.isLoggedIn) {
            Log.w(TAG, "Not logged in")
            stopSelf()
            return START_NOT_STICKY
        }

        connectWebSocket(prefs)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        recording = false
        webSocket?.close(1000, "stopped")
        webSocket = null
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null
        audioTrack?.stop()
        audioTrack?.release()
        audioTrack = null
        isRunning = false
        val ctx = applicationContext
        scope.launch {
            VoiceWidget.setActive(ctx, false)
        }.invokeOnCompletion { scope.cancel() }
        super.onDestroy()
    }

    private fun connectWebSocket(prefs: Prefs) {
        val wsUrl = prefs.serverUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://") + "/ws/voice/browser"

        val request = Request.Builder()
            .url(wsUrl)
            .header("Cookie", ApiClient.sessionCookieHeader(prefs.sessionToken))
            .build()

        webSocket = ApiClient.http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket open")
                ws.send(JSONObject().put("type", "voice_start").toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val msg = JSONObject(text)
                    when (msg.optString("type")) {
                        "voice_ready" -> {
                            Log.d(TAG, "Voice ready, starting mic")
                            updateNotification("Listening...")
                            startMicCapture()
                        }
                        "speech_stopped" -> {
                            updateNotification("Responding...")
                        }
                        "voice_done" -> {
                            Log.d(TAG, "Voice done")
                            recording = false
                            scope.launch {
                                drainAudioTrack()
                                stopSelf()
                            }
                        }
                        "voice_error" -> {
                            Log.e(TAG, "Voice error: ${msg.optString("message")}")
                            stopSelf()
                        }
                        "user_transcript" -> {
                            Log.d(TAG, "User: ${msg.optString("text")}")
                        }
                        "assistant_transcript" -> {
                            Log.d(TAG, "Assistant: ${msg.optString("text")}")
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error handling message", e)
                }
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                playAudio(bytes.toByteArray())
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                scope.launch { stopSelf() }
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code $reason")
            }
        })
    }

    private fun startMicCapture() {
        val bufSize = maxOf(
            AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT),
            4096
        )

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufSize
        )

        if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
            Log.e(TAG, "AudioRecord failed to initialize")
            stopSelf()
            return
        }

        audioRecord?.startRecording()
        recording = true

        scope.launch {
            val buf = ShortArray(1024)
            while (recording && audioRecord != null) {
                val read = audioRecord?.read(buf, 0, buf.size) ?: -1
                if (read > 0) {
                    val bytes = ByteBuffer.allocate(read * 2)
                        .order(ByteOrder.LITTLE_ENDIAN)
                        .apply { asShortBuffer().put(buf, 0, read) }
                        .array()
                    webSocket?.send(bytes.toByteString())
                }
            }
        }
    }

    private fun playAudio(pcm: ByteArray) {
        if (audioTrack == null) {
            val bufSize = AudioTrack.getMinBufferSize(
                SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT
            )
            audioTrack = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(maxOf(bufSize, pcm.size * 2))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            audioTrack?.play()
        }
        audioTrack?.write(pcm, 0, pcm.size)
    }

    private suspend fun drainAudioTrack() {
        val track = audioTrack ?: return
        var waited = 0L
        while (track.playState == AudioTrack.PLAYSTATE_PLAYING && waited < 5000) {
            val head = track.playbackHeadPosition
            delay(200)
            waited += 200
            if (track.playbackHeadPosition == head) break
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID, "Voice", NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Active voice session" }
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val stopIntent = PendingIntent.getService(
            this, 0,
            Intent(this, VoiceService::class.java).setAction("STOP"),
            PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Minhome")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .addAction(Notification.Action.Builder(
                null, "Stop", stopIntent
            ).build())
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }
}
