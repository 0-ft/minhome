"""
Voice PE Bridge — connects to a Home Assistant Voice Preview Edition device
via the ESPHome Native API and forwards captured audio to the minhome server
over a WebSocket connection.

Protocol:
  1. Connect to Voice PE via ESPHome API (TCP:6053)
  2. Subscribe to voice assistant events
  3. On wake word → device streams audio over the API connection
  4. Forward resampled 24 kHz PCM audio to minhome at ws://HOST:PORT/ws/voice
  5. Server manages OpenAI Realtime session, sends control events back
  6. Bridge relays device LED events based on server messages
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import numpy as np

from aioesphomeapi import (
    APIClient,
    ReconnectLogic,
    VoiceAssistantAudioSettings,
    VoiceAssistantEventType,
)

from websockets.asyncio.client import connect as ws_connect

# ---------------------------------------------------------------------------
# Configuration via environment
# ---------------------------------------------------------------------------
VOICE_PE_HOST = os.environ.get("VOICE_PE_HOST", "voice-pe.local")
VOICE_PE_PORT = int(os.environ.get("VOICE_PE_PORT", "6053"))
VOICE_PE_PASSWORD = os.environ.get("VOICE_PE_PASSWORD", "")
VOICE_PE_NOISE_PSK = os.environ.get("VOICE_PE_NOISE_PSK", "")

MINHOME_WS_URL = os.environ.get("MINHOME_WS_URL", "ws://localhost:3111/ws/voice")
MINHOME_AUDIO_BASE_URL = os.environ.get("MINHOME_AUDIO_BASE_URL", "http://localhost:3111")

# Max seconds of audio to capture per pipeline run (hard timeout)
MAX_PIPELINE_DURATION = float(os.environ.get("MAX_PIPELINE_DURATION", "30"))

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("voice-bridge")


# ---------------------------------------------------------------------------
# Audio resampling helpers (16 kHz ↔ 24 kHz)
# ---------------------------------------------------------------------------

def resample_16_to_24(pcm16: bytes) -> bytes:
    """Resample 16-bit PCM from 16 kHz to 24 kHz (ratio 1.5) using linear interpolation."""
    samples = np.frombuffer(pcm16, dtype=np.int16).astype(np.float32)
    n_in = len(samples)
    if n_in == 0:
        return b""
    n_out = int(n_in * 24000 / 16000)
    x_in = np.arange(n_in)
    x_out = np.linspace(0, n_in - 1, n_out)
    resampled = np.interp(x_out, x_in, samples)
    return resampled.clip(-32768, 32767).astype(np.int16).tobytes()


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------

class VoiceBridge:
    """Manages the ESPHome API connection and audio forwarding."""

    def __init__(self) -> None:
        noise_psk = VOICE_PE_NOISE_PSK or None
        self.cli = APIClient(
            VOICE_PE_HOST,
            VOICE_PE_PORT,
            VOICE_PE_PASSWORD,
            noise_psk=noise_psk,
        )
        self._audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._ws: Any = None  # websockets connection
        self._ws_lock = asyncio.Lock()
        self._ws_reader_task: asyncio.Task | None = None
        self._reconnect: ReconnectLogic | None = None

    # -- WebSocket to minhome --------------------------------------------------

    async def _ensure_ws(self) -> Any:
        """Return an open WebSocket connection to minhome, reconnecting if needed."""
        async with self._ws_lock:
            if self._ws is not None:
                return self._ws

            log.info("Connecting to minhome at %s", MINHOME_WS_URL)
            try:
                self._ws = await ws_connect(MINHOME_WS_URL)
                log.info("Connected to minhome WebSocket")
                # Start background reader for server → bridge messages
                if self._ws_reader_task is None or self._ws_reader_task.done():
                    self._ws_reader_task = asyncio.get_running_loop().create_task(
                        self._ws_reader()
                    )
            except Exception as exc:
                log.error("Failed to connect to minhome: %s", exc)
                self._ws = None
            return self._ws

    async def _ws_reader(self) -> None:
        """Read incoming messages from the minhome WebSocket (server → bridge)."""
        while True:
            ws = self._ws
            if ws is None:
                await asyncio.sleep(1)
                continue
            try:
                raw = await ws.recv()
                if isinstance(raw, str):
                    msg = json.loads(raw)
                    msg_type = msg.get("type")

                    if msg_type == "speech_stopped":
                        # OpenAI detected end of speech → show "thinking" LEDs
                        log.info("Server: speech_stopped → sending STT_VAD_END")
                        self.cli.send_voice_assistant_event(
                            VoiceAssistantEventType.VOICE_ASSISTANT_STT_VAD_END, {}
                        )

                    elif msg_type == "tts_start":
                        # Server has audio ready → send TTS URL to device
                        audio_path = msg.get("audio_path", "")
                        audio_url = f"{MINHOME_AUDIO_BASE_URL}{audio_path}"
                        log.info("Server: tts_start → sending TTS events (url=%s)", audio_url)

                        # TTS_START triggers "replying" LEDs on the device
                        self.cli.send_voice_assistant_event(
                            VoiceAssistantEventType.VOICE_ASSISTANT_TTS_START,
                            {"url": audio_url},
                        )
                        # TTS_END with URL triggers media_player to fetch and play
                        self.cli.send_voice_assistant_event(
                            VoiceAssistantEventType.VOICE_ASSISTANT_TTS_END,
                            {"url": audio_url},
                        )

                    elif msg_type == "voice_done":
                        # Server pipeline complete → return device to idle
                        conv_id = msg.get("conversation_id", "")
                        log.info("Server: voice_done (conversation=%s) → sending RUN_END", conv_id)
                        self.cli.send_voice_assistant_event(
                            VoiceAssistantEventType.VOICE_ASSISTANT_RUN_END, {}
                        )

                    else:
                        log.debug("WS message from server: %s", msg_type)

            except Exception as exc:
                log.warning("WS reader error: %s", exc)
                self._ws = None
                await asyncio.sleep(1)

    async def _ws_send_json(self, msg: dict) -> None:
        ws = await self._ensure_ws()
        if ws is None:
            log.warning("No minhome WS connection — dropping message: %s", msg.get("type"))
            return
        try:
            await ws.send(json.dumps(msg))
        except Exception as exc:
            log.error("WS send error: %s", exc)
            self._ws = None

    async def _ws_send_binary(self, data: bytes) -> None:
        """Send binary data, skipping if no connection (non-blocking fast path)."""
        ws = self._ws
        if ws is None:
            # Don't try to reconnect on every audio chunk — just drop
            return
        try:
            await ws.send(data)
        except Exception as exc:
            log.error("WS send binary error: %s", exc)
            self._ws = None

    # -- Voice assistant handlers ----------------------------------------------

    async def handle_pipeline_start(
        self,
        conversation_id: str,
        flags: int,
        audio_settings: VoiceAssistantAudioSettings,
        wake_word_phrase: str | None,
    ) -> int | None:
        """Called when the device wants to start a voice pipeline (wake word detected)."""
        log.info(
            "Pipeline start — conversation=%s wake_word=%s flags=%d",
            conversation_id,
            wake_word_phrase,
            flags,
        )

        # Drain any leftover audio
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Tell minhome a voice session has started
        await self._ws_send_json({
            "type": "voice_start",
            "conversation_id": conversation_id,
            "wake_word": wake_word_phrase or "",
        })

        # Send initial pipeline events so the device shows correct LEDs
        self.cli.send_voice_assistant_event(
            VoiceAssistantEventType.VOICE_ASSISTANT_RUN_START, {}
        )
        self.cli.send_voice_assistant_event(
            VoiceAssistantEventType.VOICE_ASSISTANT_STT_START, {}
        )
        self.cli.send_voice_assistant_event(
            VoiceAssistantEventType.VOICE_ASSISTANT_STT_VAD_START, {}
        )

        # Kick off the audio forwarding task
        asyncio.get_running_loop().create_task(self._forward_audio(conversation_id))

        # Return port=0 → device sends audio over the API (TCP) connection
        return 0

    async def handle_audio(self, data: bytes) -> None:
        """Called when audio arrives via the API (TCP)."""
        self._audio_queue.put_nowait(data)

    async def handle_pipeline_stop(self, abort: bool) -> None:
        """Called when the device wants the pipeline to stop."""
        log.info("Pipeline stop — abort=%s", abort)
        self._audio_queue.put_nowait(None)

    async def _forward_audio(self, conversation_id: str) -> None:
        """Read audio from the queue, resample 16kHz → 24kHz, and forward to minhome.

        The server handles VAD via OpenAI's semantic_vad — we just stream audio
        until the device stops or we hit the hard timeout.
        """
        total_bytes = 0
        deadline = asyncio.get_event_loop().time() + MAX_PIPELINE_DURATION
        stop_reason = "unknown"

        try:
            while True:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    stop_reason = f"max duration ({MAX_PIPELINE_DURATION:.0f}s)"
                    break

                try:
                    chunk = await asyncio.wait_for(
                        self._audio_queue.get(),
                        timeout=min(remaining, 0.5),
                    )
                except asyncio.TimeoutError:
                    if asyncio.get_event_loop().time() >= deadline:
                        stop_reason = f"max duration ({MAX_PIPELINE_DURATION:.0f}s)"
                        break
                    continue

                if chunk is None:
                    stop_reason = "device stopped"
                    break

                total_bytes += len(chunk)

                # Resample 16kHz → 24kHz and send as binary
                resampled = resample_16_to_24(chunk)
                await self._ws_send_binary(resampled)

        except asyncio.CancelledError:
            stop_reason = "cancelled"
        finally:
            duration = total_bytes / (16000 * 2) if total_bytes else 0
            log.info(
                "Audio forwarding done — %s — %d bytes (~%.1fs of 16kHz audio)",
                stop_reason, total_bytes, duration,
            )

    # -- Connection lifecycle --------------------------------------------------

    async def on_connect(self) -> None:
        """Called when ESPHome API connection is established."""
        log.info("Connected to Voice PE at %s:%d", VOICE_PE_HOST, VOICE_PE_PORT)

        device_info = await self.cli.device_info()
        log.info(
            "Device: %s (model=%s, version=%s)",
            device_info.name,
            device_info.model,
            device_info.esphome_version,
        )

        self.cli.subscribe_voice_assistant(
            handle_start=self.handle_pipeline_start,
            handle_stop=self.handle_pipeline_stop,
            handle_audio=self.handle_audio,
        )
        log.info("Subscribed to voice assistant events")

    async def on_disconnect(self, expected_disconnect: bool) -> None:
        log.warning(
            "Disconnected from Voice PE (expected=%s)", expected_disconnect
        )

    async def on_connect_error(self, exc: Exception) -> None:
        log.error("Connection error: %s", exc)

    async def run(self) -> None:
        """Main entry point — connect and run forever."""
        log.info("Starting Voice Bridge → %s:%d", VOICE_PE_HOST, VOICE_PE_PORT)
        log.info("Audio base URL: %s", MINHOME_AUDIO_BASE_URL)

        self._reconnect = ReconnectLogic(
            client=self.cli,
            on_connect=self.on_connect,
            on_disconnect=self.on_disconnect,
            zeroconf_instance=None,
            name="voice-pe",
            on_connect_error=self.on_connect_error,
        )
        await self._reconnect.start()

        try:
            while True:
                await asyncio.sleep(3600)
        except asyncio.CancelledError:
            pass
        finally:
            await self._reconnect.stop()
            await self.cli.disconnect()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

async def main() -> None:
    bridge = VoiceBridge()
    await bridge.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Shutting down")
