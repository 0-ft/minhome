"""
Voice PE Bridge — connects to a Home Assistant Voice Preview Edition device
via the ESPHome Native API and forwards captured audio to the minhome server
over a WebSocket connection.

Protocol:
  1. Connect to Voice PE via ESPHome API (TCP:6053)
  2. Subscribe to voice assistant events
  3. On wake word → device streams audio over the API connection
  4. Forward raw 16-bit PCM (16 kHz, mono) audio to minhome at ws://HOST:PORT/ws/voice
  5. Use VAD (pymicro-vad) to detect end of speech and stop the pipeline
  6. Send pipeline events back to device so its LEDs progress correctly
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any

from aioesphomeapi import (
    APIClient,
    ReconnectLogic,
    VoiceAssistantAudioSettings,
    VoiceAssistantEventType,
)
from pymicro_vad import MicroVad

from websockets.asyncio.client import connect as ws_connect

# ---------------------------------------------------------------------------
# Configuration via environment
# ---------------------------------------------------------------------------
VOICE_PE_HOST = os.environ.get("VOICE_PE_HOST", "voice-pe.local")
VOICE_PE_PORT = int(os.environ.get("VOICE_PE_PORT", "6053"))
VOICE_PE_PASSWORD = os.environ.get("VOICE_PE_PASSWORD", "")
VOICE_PE_NOISE_PSK = os.environ.get("VOICE_PE_NOISE_PSK", "")

MINHOME_WS_URL = os.environ.get("MINHOME_WS_URL", "ws://localhost:3111/ws/voice")

# Max seconds of audio to capture per pipeline run (hard timeout)
MAX_PIPELINE_DURATION = float(os.environ.get("MAX_PIPELINE_DURATION", "15"))

# VAD configuration
VAD_SPEECH_SECONDS = float(os.environ.get("VAD_SPEECH_SECONDS", "0.3"))
VAD_SILENCE_SECONDS = float(os.environ.get("VAD_SILENCE_SECONDS", "0.7"))
VAD_COMMAND_SECONDS = float(os.environ.get("VAD_COMMAND_SECONDS", "1.0"))
VAD_TIMEOUT_SECONDS = float(os.environ.get("VAD_TIMEOUT_SECONDS", "15.0"))

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
# Voice Activity Detection / Command Segmenter
# ---------------------------------------------------------------------------
# Inspired by Home Assistant's VoiceCommandSegmenter.  Uses pymicro-vad for
# speech probability and a simple state machine to detect when a voice command
# starts and ends.
#
# States:
#   WAITING  → accumulating speech_seconds of speech → IN_COMMAND
#   IN_COMMAND → after command_seconds minimum, silence_seconds of silence → DONE
#
# pymicro-vad expects 10ms chunks (320 bytes = 160 int16 samples @ 16 kHz).

VAD_CHUNK_BYTES = 320  # 10ms @ 16kHz 16-bit mono


@dataclass
class VoiceSegmenter:
    """Detects the start and end of a voice command in a PCM audio stream."""

    speech_seconds: float = 0.3
    """Seconds of speech before voice command has started."""

    silence_seconds: float = 0.7
    """Seconds of silence after voice command has ended."""

    command_seconds: float = 1.0
    """Minimum number of seconds for a voice command (speech_seconds included)."""

    timeout_seconds: float = 15.0
    """Maximum number of seconds before timeout."""

    before_command_threshold: float = 0.2
    """Speech probability threshold before command starts."""

    in_command_threshold: float = 0.5
    """Speech probability threshold during command."""

    reset_seconds: float = 1.0
    """Seconds of opposite signal before resetting counters."""

    # --- internal state ---
    _vad: MicroVad = field(default_factory=MicroVad, repr=False)
    _buf: bytearray = field(default_factory=bytearray, repr=False)
    _in_command: bool = False
    _timed_out: bool = False
    _speech_left: float = 0.0
    _silence_left: float = 0.0
    _command_left: float = 0.0
    _timeout_left: float = 0.0
    _reset_left: float = 0.0

    def __post_init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        """Reset all state for a new pipeline run."""
        self._vad = MicroVad()
        self._buf = bytearray()
        self._in_command = False
        self._timed_out = False
        self._speech_left = self.speech_seconds
        self._silence_left = self.silence_seconds
        self._command_left = self.command_seconds - self.speech_seconds
        self._timeout_left = self.timeout_seconds
        self._reset_left = self.reset_seconds

    @property
    def in_command(self) -> bool:
        return self._in_command

    @property
    def timed_out(self) -> bool:
        return self._timed_out

    def process(self, audio: bytes) -> bool:
        """Feed raw PCM audio bytes.  Returns False when voice command is done."""
        self._buf.extend(audio)

        while len(self._buf) >= VAD_CHUNK_BYTES:
            chunk = bytes(self._buf[:VAD_CHUNK_BYTES])
            del self._buf[:VAD_CHUNK_BYTES]

            speech_prob = self._vad.process_10ms(chunk)
            if speech_prob < 0:
                # VAD needs more audio to warm up
                continue

            if not self._process_chunk(0.01, speech_prob):
                return False

        return True

    def _process_chunk(self, chunk_seconds: float, speech_prob: float) -> bool:
        """Process a single 10ms chunk.  Returns False when command is done."""
        # Hard timeout
        self._timeout_left -= chunk_seconds
        if self._timeout_left <= 0:
            log.debug("VAD timeout after %.1fs", self.timeout_seconds)
            self._timed_out = True
            return False

        if not self._in_command:
            # --- Waiting for speech to start ---
            is_speech = speech_prob > self.before_command_threshold
            if is_speech:
                self._reset_left = self.reset_seconds
                self._speech_left -= chunk_seconds
                if self._speech_left <= 0:
                    self._in_command = True
                    self._command_left = self.command_seconds - self.speech_seconds
                    self._silence_left = self.silence_seconds
                    log.info("VAD: voice command started")
            else:
                # Reset speech counter after enough silence
                self._reset_left -= chunk_seconds
                if self._reset_left <= 0:
                    self._speech_left = self.speech_seconds
                    self._reset_left = self.reset_seconds
        else:
            # --- Inside command, waiting for silence ---
            is_speech = speech_prob > self.in_command_threshold
            if not is_speech:
                # Silence
                self._reset_left = self.reset_seconds
                self._silence_left -= chunk_seconds
                self._command_left -= chunk_seconds
                if self._silence_left <= 0 and self._command_left <= 0:
                    log.info("VAD: voice command finished")
                    return False
            else:
                # Speech — reset silence counter after enough continuous speech
                self._command_left -= chunk_seconds
                self._reset_left -= chunk_seconds
                if self._reset_left <= 0:
                    self._silence_left = self.silence_seconds
                    self._reset_left = self.reset_seconds

        return True


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
            except Exception as exc:
                log.error("Failed to connect to minhome: %s", exc)
                self._ws = None
            return self._ws

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
            ws = await self._ensure_ws()
        if ws is None:
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
        """Read audio from the queue and forward to minhome over WebSocket.

        Uses VoiceSegmenter (pymicro-vad) to detect end of speech.
        """
        total_bytes = 0
        deadline = asyncio.get_event_loop().time() + MAX_PIPELINE_DURATION
        stop_reason = "unknown"

        segmenter = VoiceSegmenter(
            speech_seconds=VAD_SPEECH_SECONDS,
            silence_seconds=VAD_SILENCE_SECONDS,
            command_seconds=VAD_COMMAND_SECONDS,
            timeout_seconds=VAD_TIMEOUT_SECONDS,
        )

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
                await self._ws_send_binary(chunk)

                # Run VAD on the chunk — returns False when command ends
                if not segmenter.process(chunk):
                    if segmenter.timed_out:
                        stop_reason = f"VAD timeout ({VAD_TIMEOUT_SECONDS:.0f}s)"
                    else:
                        stop_reason = "VAD end-of-speech"
                    break

        except asyncio.CancelledError:
            stop_reason = "cancelled"
        finally:
            duration = total_bytes / (16000 * 2) if total_bytes else 0
            log.info(
                "Audio done — %s — %d bytes (~%.1fs)",
                stop_reason, total_bytes, duration,
            )

            # Send RUN_END while device is still in STREAMING_MICROPHONE state.
            # The C++ RUN_END handler transitions STREAMING_MICROPHONE → IDLE.
            # (Sending STT_VAD_END first would put it in STOP_MICROPHONE, which
            # RUN_END doesn't handle, leaving the device stuck.)
            self.cli.send_voice_assistant_event(
                VoiceAssistantEventType.VOICE_ASSISTANT_RUN_END, {}
            )

            # Tell minhome the voice session has ended
            await self._ws_send_json({
                "type": "voice_end",
                "conversation_id": conversation_id,
                "audio_bytes": total_bytes,
            })

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
