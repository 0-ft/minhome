"""
Voice PE Bridge — discovers ESPHome devices with voice_assistant capability
on the network via mDNS/Zeroconf, connects to each, and forwards audio to
the minhome server over a single WebSocket connection.

Protocol:
  1. Discover ESPHome devices via mDNS (_esphomelib._tcp.local.)
  2. Probe each for voice_assistant feature flags
  3. Maintain persistent connections to qualifying devices (ReconnectLogic)
  4. On wake word → device streams audio over the API connection
  5. Forward resampled 24 kHz PCM audio to minhome at ws://HOST:PORT/ws/voice
  6. Server manages OpenAI Realtime session, sends control events back
  7. Bridge routes events to the correct device by device_id
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
    VoiceAssistantFeature,
)

from zeroconf import ServiceStateChange
from zeroconf.asyncio import AsyncServiceBrowser, AsyncZeroconf

from websockets.asyncio.client import connect as ws_connect

# ---------------------------------------------------------------------------
# Configuration via environment
# ---------------------------------------------------------------------------
MINHOME_WS_URL = os.environ.get("MINHOME_WS_URL", "ws://localhost:3111/ws/voice")
MINHOME_AUDIO_BASE_URL = os.environ.get("MINHOME_AUDIO_BASE_URL", "http://localhost:3111")

# Shared credentials for all ESPHome devices (optional)
ESPHOME_PASSWORD = os.environ.get("ESPHOME_PASSWORD", "")
ESPHOME_NOISE_PSK = os.environ.get("ESPHOME_NOISE_PSK", "")
ESPHOME_PORT = int(os.environ.get("ESPHOME_PORT", "6053"))

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
# Audio resampling helpers (16 kHz → 24 kHz)
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
# DeviceHandler — manages one ESPHome voice assistant device
# ---------------------------------------------------------------------------

class DeviceHandler:
    """Manages a single ESPHome voice assistant device connection."""

    def __init__(
        self,
        host: str,
        device_name: str,
        manager: BridgeManager,
    ) -> None:
        self.host = host
        self.device_name = device_name
        self.device_id = device_name  # used in WS protocol
        self.manager = manager

        noise_psk = ESPHOME_NOISE_PSK or None
        self.cli = APIClient(
            host,
            ESPHOME_PORT,
            ESPHOME_PASSWORD,
            noise_psk=noise_psk,
        )
        self._audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._reconnect: ReconnectLogic | None = None
        self._device_info: dict[str, str] | None = None  # cached info for WS reconnects

    async def start(self) -> None:
        """Start the reconnection logic for this device."""
        log.info("[%s] Starting connection handler", self.device_id)
        self._reconnect = ReconnectLogic(
            client=self.cli,
            on_connect=self._on_connect,
            on_disconnect=self._on_disconnect,
            zeroconf_instance=self.manager.zeroconf,
            name=self.device_name,
            on_connect_error=self._on_connect_error,
        )
        await self._reconnect.start()

    async def stop(self) -> None:
        """Stop the reconnection logic and disconnect."""
        log.info("[%s] Stopping connection handler", self.device_id)
        if self._reconnect:
            await self._reconnect.stop()
        try:
            await self.cli.disconnect()
        except Exception:
            pass

    # -- ESPHome connection callbacks ------------------------------------------

    async def _on_connect(self) -> None:
        log.info("[%s] Connected (%s)", self.device_id, self.host)

        device_info = await self.cli.device_info()
        log.info(
            "[%s] Device: %s (model=%s, version=%s)",
            self.device_id,
            device_info.name,
            device_info.model,
            device_info.esphome_version,
        )

        # Cache device info so we can re-send it on WS reconnects
        self._device_info = {
            "name": device_info.name,
            "model": device_info.model,
            "version": device_info.esphome_version,
        }

        self.cli.subscribe_voice_assistant(
            handle_start=self._handle_pipeline_start,
            handle_stop=self._handle_pipeline_stop,
            handle_audio=self._handle_audio,
        )
        log.info("[%s] Subscribed to voice assistant events", self.device_id)

        # Notify the server that this device is connected
        await self.manager.ws_send_json({
            "type": "device_connected",
            "device_id": self.device_id,
            "name": device_info.name,
            "model": device_info.model,
            "version": device_info.esphome_version,
        })

    async def _on_disconnect(self, expected_disconnect: bool) -> None:
        log.warning(
            "[%s] Disconnected (expected=%s)", self.device_id, expected_disconnect
        )
        # Notify the server that this device is disconnected
        await self.manager.ws_send_json({
            "type": "device_disconnected",
            "device_id": self.device_id,
        })

    async def _on_connect_error(self, exc: Exception) -> None:
        log.error("[%s] Connection error: %s", self.device_id, exc)

    # -- Voice assistant handlers ----------------------------------------------

    async def _handle_pipeline_start(
        self,
        conversation_id: str,
        flags: int,
        audio_settings: VoiceAssistantAudioSettings,
        wake_word_phrase: str | None,
    ) -> int | None:
        log.info(
            "[%s] Pipeline start — conversation=%s wake_word=%s flags=%d",
            self.device_id, conversation_id, wake_word_phrase, flags,
        )

        # Drain any leftover audio
        while not self._audio_queue.empty():
            try:
                self._audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        # Tell minhome a voice session has started (with device_id)
        await self.manager.ws_send_json({
            "type": "voice_start",
            "device_id": self.device_id,
            "conversation_id": conversation_id,
            "wake_word": wake_word_phrase or "",
        })

        # Register this device as the active streamer
        self.manager.set_active_streamer(self.device_id)

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

    async def _handle_audio(self, data: bytes) -> None:
        self._audio_queue.put_nowait(data)

    async def _handle_pipeline_stop(self, abort: bool) -> None:
        log.info("[%s] Pipeline stop — abort=%s", self.device_id, abort)
        self._audio_queue.put_nowait(None)

    async def _forward_audio(self, conversation_id: str) -> None:
        """Read audio from the queue, resample 16kHz → 24kHz, and forward to minhome."""
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
                await self.manager.ws_send_binary(resampled)

        except asyncio.CancelledError:
            stop_reason = "cancelled"
        finally:
            duration = total_bytes / (16000 * 2) if total_bytes else 0
            log.info(
                "[%s] Audio forwarding done — %s — %d bytes (~%.1fs of 16kHz audio)",
                self.device_id, stop_reason, total_bytes, duration,
            )

    # -- Handle server → bridge messages for this device -----------------------

    def handle_server_message(self, msg: dict) -> None:
        """Route a server message to this device."""
        msg_type = msg.get("type")

        if msg_type == "speech_stopped":
            log.info("[%s] Server: speech_stopped → sending STT_VAD_END", self.device_id)
            self.cli.send_voice_assistant_event(
                VoiceAssistantEventType.VOICE_ASSISTANT_STT_VAD_END, {}
            )

        elif msg_type == "tts_start":
            audio_path = msg.get("audio_path", "")
            audio_url = f"{MINHOME_AUDIO_BASE_URL}{audio_path}"
            log.info("[%s] Server: tts_start → sending TTS events (url=%s)", self.device_id, audio_url)

            self.cli.send_voice_assistant_event(
                VoiceAssistantEventType.VOICE_ASSISTANT_TTS_START,
                {"url": audio_url},
            )
            self.cli.send_voice_assistant_event(
                VoiceAssistantEventType.VOICE_ASSISTANT_TTS_END,
                {"url": audio_url},
            )

        elif msg_type == "voice_error":
            error_code = msg.get("code", "server-error")
            error_message = msg.get("message", "An error occurred")
            log.warning("[%s] Server: voice_error (%s) → sending ERROR event", self.device_id, error_code)
            self.cli.send_voice_assistant_event(
                VoiceAssistantEventType.VOICE_ASSISTANT_ERROR,
                {"code": error_code, "message": error_message},
            )

        elif msg_type == "voice_done":
            conv_id = msg.get("conversation_id", "")
            log.info("[%s] Server: voice_done (conversation=%s) → sending RUN_END", self.device_id, conv_id)
            self.cli.send_voice_assistant_event(
                VoiceAssistantEventType.VOICE_ASSISTANT_RUN_END, {}
            )
            # Clear active streamer if it's this device
            self.manager.clear_active_streamer(self.device_id)

        elif msg_type == "announce":
            audio_path = msg.get("audio_path", "")
            audio_url = f"{MINHOME_AUDIO_BASE_URL}{audio_path}"
            announce_id = msg.get("announce_id", "")
            log.info("[%s] Server: announce (id=%s, url=%s)", self.device_id, announce_id, audio_url)
            asyncio.get_event_loop().create_task(
                self._play_announcement(audio_url, announce_id)
            )

        else:
            log.debug("[%s] Unknown server message: %s", self.device_id, msg_type)

    async def _play_announcement(self, audio_url: str, announce_id: str) -> None:
        """Play an announcement on the device and report back to the server."""
        success = False
        try:
            result = await self.cli.send_voice_assistant_announcement_await_response(
                media_id=audio_url,
                timeout=300,
                text="",
            )
            success = result.success
            log.info("[%s] Announcement %s finished (success=%s)", self.device_id, announce_id, success)
        except Exception as exc:
            log.error("[%s] Announcement %s failed: %s", self.device_id, announce_id, exc)

        await self.manager.ws_send_json({
            "type": "announce_done",
            "device_id": self.device_id,
            "announce_id": announce_id,
            "success": success,
        })


# ---------------------------------------------------------------------------
# BridgeManager — discovers devices and manages connections
# ---------------------------------------------------------------------------

class BridgeManager:
    """Discovers ESPHome voice assistant devices and manages their connections."""

    def __init__(self) -> None:
        self._devices: dict[str, DeviceHandler] = {}
        self._pending_probes: set[str] = set()  # hosts currently being probed
        self._ws: Any = None
        self._ws_lock = asyncio.Lock()
        self._ws_reader_task: asyncio.Task | None = None
        self._active_streamer: str | None = None  # device_id currently streaming audio
        self.zeroconf: AsyncZeroconf | None = None
        self._browser: AsyncServiceBrowser | None = None

    # -- Active streamer tracking ----------------------------------------------

    def set_active_streamer(self, device_id: str) -> None:
        self._active_streamer = device_id

    def clear_active_streamer(self, device_id: str) -> None:
        if self._active_streamer == device_id:
            self._active_streamer = None

    # -- WebSocket to minhome --------------------------------------------------

    async def _ensure_ws(self) -> Any:
        async with self._ws_lock:
            if self._ws is not None:
                return self._ws

            log.info("Connecting to minhome at %s", MINHOME_WS_URL)
            try:
                self._ws = await ws_connect(MINHOME_WS_URL)
                log.info("Connected to minhome WebSocket")
                if self._ws_reader_task is None or self._ws_reader_task.done():
                    self._ws_reader_task = asyncio.get_running_loop().create_task(
                        self._ws_reader()
                    )
                # Send the current list of connected devices so the server
                # knows about them immediately (important on reconnect)
                await self._send_devices_list()
            except Exception as exc:
                log.error("Failed to connect to minhome: %s", exc)
                self._ws = None
            return self._ws

    async def _send_devices_list(self) -> None:
        """Send the list of currently connected devices to the server."""
        devices = []
        for device_id, handler in self._devices.items():
            if handler._device_info is not None:
                devices.append({
                    "device_id": device_id,
                    **handler._device_info,
                })
        if not devices:
            return
        msg = json.dumps({"type": "devices_list", "devices": devices})
        log.info("Sending devices_list with %d device(s) to server", len(devices))
        try:
            await self._ws.send(msg)
        except Exception as exc:
            log.error("Failed to send devices_list: %s", exc)

    async def _ws_reader(self) -> None:
        """Read incoming messages from the minhome WebSocket (server → bridge)."""
        while True:
            ws = self._ws
            if ws is None:
                log.info("WS reader: reconnecting to minhome...")
                ws = await self._ensure_ws()
                if ws is None:
                    await asyncio.sleep(3)
                    continue
            try:
                raw = await ws.recv()
                if isinstance(raw, str):
                    msg = json.loads(raw)
                    msg_type = msg.get("type")

                    # Broadcast messages go to all devices
                    if msg_type == "announce_all":
                        log.info("Broadcasting announce to %d device(s)", len(self._devices))
                        for handler in self._devices.values():
                            handler.handle_server_message({
                                **msg,
                                "type": "announce",
                                "device_id": handler.device_id,
                            })
                        continue

                    device_id = msg.get("device_id")
                    if device_id and device_id in self._devices:
                        self._devices[device_id].handle_server_message(msg)
                    elif device_id:
                        log.warning("Server message for unknown device: %s", device_id)
                    else:
                        log.warning("Server message without device_id: %s", msg_type)
            except Exception as exc:
                log.warning("WS reader error: %s — will reconnect", exc)
                self._ws = None
                await asyncio.sleep(3)

    async def ws_send_json(self, msg: dict) -> None:
        ws = await self._ensure_ws()
        if ws is None:
            log.warning("No minhome WS — dropping message: %s", msg.get("type"))
            return
        try:
            await ws.send(json.dumps(msg))
        except Exception as exc:
            log.error("WS send error: %s", exc)
            self._ws = None

    async def ws_send_binary(self, data: bytes) -> None:
        ws = self._ws
        if ws is None:
            return
        try:
            await ws.send(data)
        except Exception as exc:
            log.error("WS send binary error: %s", exc)
            self._ws = None

    # -- mDNS discovery --------------------------------------------------------

    def _on_service_state_change(
        self,
        zeroconf: Any,
        service_type: str,
        name: str,
        state_change: ServiceStateChange,
    ) -> None:
        """Callback from AsyncServiceBrowser (runs in zeroconf thread)."""
        if state_change == ServiceStateChange.Added:
            asyncio.get_event_loop().create_task(self._probe_device(zeroconf, service_type, name))
        elif state_change == ServiceStateChange.Removed:
            # Extract short name from full service name
            short_name = name.replace(f".{service_type}", "")
            asyncio.get_event_loop().create_task(self._remove_device(short_name))

    async def _probe_device(self, zeroconf: Any, service_type: str, name: str) -> None:
        """Connect to a discovered device to check if it has voice assistant support."""
        short_name = name.replace(f".{service_type}", "")

        # Skip if already managed or being probed
        if short_name in self._devices or short_name in self._pending_probes:
            return

        self._pending_probes.add(short_name)

        try:
            # Get service info for the IP address
            info = await self.zeroconf.async_get_service_info(
                service_type, name
            ) if self.zeroconf else None

            if info is None:
                log.debug("Could not resolve service info for %s", short_name)
                return

            # Get the IP address
            addresses = info.parsed_addresses()
            if not addresses:
                log.debug("No addresses for %s", short_name)
                return

            host = addresses[0]
            log.info("Discovered ESPHome device: %s (%s)", short_name, host)

            # Probe the device for voice assistant capability
            noise_psk = ESPHOME_NOISE_PSK or None
            probe_client = APIClient(host, ESPHOME_PORT, ESPHOME_PASSWORD, noise_psk=noise_psk)
            try:
                await probe_client.connect()
                device_info = await probe_client.device_info()
                flags = device_info.voice_assistant_feature_flags_compat(probe_client.api_version)
                has_voice = bool(flags & VoiceAssistantFeature.VOICE_ASSISTANT)
                log.info(
                    "Probed %s: voice_assistant=%s (flags=%d, model=%s)",
                    short_name, has_voice, flags, device_info.model,
                )
            finally:
                await probe_client.disconnect()

            if has_voice:
                handler = DeviceHandler(host, short_name, self)
                self._devices[short_name] = handler
                await handler.start()
                log.info("Managing voice device: %s (%s) [%d total]", short_name, host, len(self._devices))
            else:
                log.debug("Ignoring non-voice device: %s", short_name)

        except Exception as exc:
            log.warning("Failed to probe %s: %s", short_name, exc)
        finally:
            self._pending_probes.discard(short_name)

    async def _remove_device(self, short_name: str) -> None:
        """Handle a device being removed from mDNS."""
        handler = self._devices.pop(short_name, None)
        if handler:
            log.info("Device removed from network: %s [%d remaining]", short_name, len(self._devices))
            await handler.stop()

    # -- Main loop -------------------------------------------------------------

    async def run(self) -> None:
        """Main entry point — discover devices and run forever."""
        log.info("Starting Voice Bridge (discovery mode)")
        log.info("Audio base URL: %s", MINHOME_AUDIO_BASE_URL)
        log.info("minhome WS: %s", MINHOME_WS_URL)

        # Connect to minhome WebSocket (retry until successful)
        while True:
            ws = await self._ensure_ws()
            if ws is not None:
                break
            log.info("Retrying minhome WS connection in 3s...")
            await asyncio.sleep(3)

        # Start mDNS discovery
        self.zeroconf = AsyncZeroconf()
        self._browser = AsyncServiceBrowser(
            self.zeroconf.zeroconf,
            "_esphomelib._tcp.local.",
            handlers=[self._on_service_state_change],
        )
        log.info("Discovering ESPHome devices on the network...")

        try:
            while True:
                await asyncio.sleep(3600)
        except asyncio.CancelledError:
            pass
        finally:
            # Clean up
            log.info("Shutting down...")
            if self._browser:
                await self._browser.async_cancel()
            for handler in list(self._devices.values()):
                await handler.stop()
            if self.zeroconf:
                await self.zeroconf.async_close()
            if self._ws:
                await self._ws.close()


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

async def main() -> None:
    manager = BridgeManager()
    await manager.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Shutting down")
