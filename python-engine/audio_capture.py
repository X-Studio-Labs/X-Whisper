"""
X-Whisper — Audio Capture Module
Handles microphone input with sounddevice and silero-vad for
voice activity detection. Streams amplitude data for waveform visualization.
"""

import asyncio
import json
import logging
import threading
import time
from typing import Optional

import numpy as np
import sounddevice as sd

from config import SAMPLE_RATE, CHANNELS, AUDIO_DTYPE

logger = logging.getLogger(__name__)


class AudioCapture:
    """Captures audio from the microphone with real-time amplitude streaming."""

    def __init__(self):
        self.recording = False
        self.buffer: list[np.ndarray] = []
        self.stream: Optional[sd.InputStream] = None
        self._websocket = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._vad_model = None
        self._vad_utils = None
        self._start_time: float = 0
        self._amplitude_interval = 0.05  # Send amplitude every 50ms

    def _load_vad(self):
        """Lazy-load Silero VAD model."""
        if self._vad_model is not None:
            return

        try:
            import torch
            model, utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=False,
                trust_repo=True,
            )
            self._vad_model = model
            self._vad_utils = utils
            logger.info("Silero VAD model loaded successfully")
        except Exception as e:
            logger.warning(f"Failed to load Silero VAD: {e}. Proceeding without VAD.")
            self._vad_model = None

    async def start(self, websocket, loop: asyncio.AbstractEventLoop):
        """Start recording audio from the default microphone."""
        if self.recording:
            logger.warning("Already recording — ignoring start request")
            return

        self.recording = True
        self.buffer = []
        self._websocket = websocket
        self._loop = loop
        self._start_time = time.time()

        # Check available audio devices
        devices = sd.query_devices()
        default_input = sd.query_devices(kind='input')
        logger.info(f"Using input device: {default_input['name']}")

        def audio_callback(indata, frames, time_info, status):
            """Called by sounddevice for each audio chunk."""
            if status:
                logger.warning(f"Audio status: {status}")

            if not self.recording:
                return

            # Copy the audio data
            audio_chunk = indata[:, 0].copy()
            self.buffer.append(audio_chunk)

            # Calculate amplitude for waveform visualization
            amplitude = float(np.abs(audio_chunk).mean())

            # Send amplitude event via WebSocket
            if self._websocket and self._loop:
                try:
                    asyncio.run_coroutine_threadsafe(
                        self._send_amplitude(amplitude),
                        self._loop
                    )
                except Exception:
                    pass  # Don't let WS errors interrupt recording

        try:
            self.stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                callback=audio_callback,
                dtype=AUDIO_DTYPE,
                blocksize=int(SAMPLE_RATE * self._amplitude_interval),  # ~50ms blocks
            )
            self.stream.start()
            logger.info("Recording started")

            # Send recording_start event
            await self._send_event({"event": "recording_start"})

        except sd.PortAudioError as e:
            self.recording = False
            error_msg = str(e)
            if "No Default Input Device" in error_msg or "Invalid device" in error_msg:
                await self._send_event({
                    "event": "error",
                    "code": "no_microphone",
                    "message": "No microphone found. Check your audio settings."
                })
            else:
                await self._send_event({
                    "event": "error",
                    "code": "audio_error",
                    "message": f"Audio error: {error_msg}"
                })
            logger.error(f"Failed to start recording: {e}")

    def peek_audio(self) -> Optional[np.ndarray]:
        """
        Snapshot the current buffer without stopping. Called periodically
        by the streaming coordinator to re-transcribe the latest audio.
        Returns None when nothing has been captured yet.
        """
        if not self.buffer:
            return None
        # Copy the list under a local so a concurrent append from the
        # audio callback thread doesn't mutate the slice we hand back.
        chunks = list(self.buffer)
        return np.concatenate(chunks, axis=0) if len(chunks) > 1 else chunks[0].copy()

    @property
    def buffered_seconds(self) -> float:
        if not self.buffer:
            return 0.0
        return sum(len(c) for c in self.buffer) / SAMPLE_RATE

    async def stop(self) -> Optional[np.ndarray]:
        """Stop recording and return the captured audio as a numpy array."""
        if not self.recording:
            logger.warning("Not recording — ignoring stop request")
            return None

        self.recording = False

        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception as e:
                logger.error(f"Error stopping stream: {e}")
            self.stream = None

        duration = time.time() - self._start_time
        logger.info(f"Recording stopped. Duration: {duration:.1f}s, Chunks: {len(self.buffer)}")

        # Send recording_stop event
        await self._send_event({"event": "recording_stop"})

        if not self.buffer:
            logger.warning("No audio data captured")
            return None

        # Concatenate all audio chunks
        audio = np.concatenate(self.buffer, axis=0)
        logger.info(f"Audio captured: {len(audio)} samples ({len(audio)/SAMPLE_RATE:.1f}s)")

        return audio

    async def _send_amplitude(self, amplitude: float):
        """Send amplitude data for waveform visualization."""
        if self._websocket:
            try:
                await self._websocket.send(json.dumps({
                    "event": "waveform",
                    "amplitude": round(amplitude, 4)
                }))
            except Exception:
                pass

    async def _send_event(self, event: dict):
        """Send a generic event via WebSocket."""
        if self._websocket:
            try:
                await self._websocket.send(json.dumps(event))
            except Exception as e:
                logger.error(f"Failed to send event: {e}")

    @staticmethod
    def list_devices() -> list[dict]:
        """List available audio input devices."""
        devices = sd.query_devices()
        input_devices = []
        for i, device in enumerate(devices):
            if device['max_input_channels'] > 0:
                input_devices.append({
                    "index": i,
                    "name": device['name'],
                    "channels": device['max_input_channels'],
                    "sample_rate": device['default_samplerate'],
                    "is_default": i == sd.default.device[0],
                })
        return input_devices

    @staticmethod
    def check_microphone() -> dict:
        """Check if a microphone is available and accessible."""
        try:
            devices = sd.query_devices(kind='input')
            return {
                "available": True,
                "device_name": devices['name'],
                "sample_rate": devices['default_samplerate'],
            }
        except sd.PortAudioError:
            return {
                "available": False,
                "device_name": None,
                "sample_rate": None,
            }
