"""
Audio Recorder Module - Captures system audio via WASAPI loopback on Windows.
"""
import wave
import threading
import time
import os
import numpy as np

try:
    import pyaudiowpatch as pyaudio
except ImportError:
    raise ImportError("pyaudiowpatch is required. Install with: pip install PyAudioWPatch")


class AudioRecorder:
    def __init__(self, output_dir="recordings"):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        self.is_recording = False
        self.frames = []
        self.sample_rate = None
        self.channels = None
        self.sample_width = 2  # 16-bit audio
        self._thread = None
        self._pa = None
        self._stream = None
        self.current_file = None

    def _get_loopback_device(self):
        """Find the WASAPI loopback device for system audio capture."""
        p = pyaudio.PyAudio()
        try:
            wasapi_info = p.get_host_api_info_by_type(pyaudio.paWASAPI)
        except OSError:
            p.terminate()
            raise RuntimeError("WASAPI not available on this system")

        default_speakers = p.get_device_info_by_index(wasapi_info["defaultOutputDevice"])

        # Find the loopback device corresponding to the default speakers
        for i in range(p.get_device_count()):
            dev = p.get_device_info_by_index(i)
            if dev.get("isLoopbackDevice", False) and dev["name"].startswith(
                default_speakers["name"].split(" (")[0]
            ):
                p.terminate()
                return dev

        # Fallback: find any loopback device
        for i in range(p.get_device_count()):
            dev = p.get_device_info_by_index(i)
            if dev.get("isLoopbackDevice", False):
                p.terminate()
                return dev

        p.terminate()
        raise RuntimeError("No WASAPI loopback device found. Make sure speakers are active.")

    def _record_loop(self):
        """Internal recording loop running in a separate thread."""
        loopback_dev = self._get_loopback_device()
        self.sample_rate = int(loopback_dev["defaultSampleRate"])
        self.channels = loopback_dev["maxInputChannels"]

        self._pa = pyaudio.PyAudio()
        self._stream = self._pa.open(
            format=pyaudio.paInt16,
            channels=self.channels,
            rate=self.sample_rate,
            input=True,
            input_device_index=loopback_dev["index"],
            frames_per_buffer=1024,
        )

        while self.is_recording:
            try:
                data = self._stream.read(1024, exception_on_overflow=False)
                self.frames.append(data)
            except Exception:
                break

    def start(self):
        """Start recording system audio."""
        if self.is_recording:
            return

        self.frames = []
        self.is_recording = True
        self._thread = threading.Thread(target=self._record_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop recording and save to a WAV file. Returns the file path."""
        if not self.is_recording:
            return None

        self.is_recording = False
        if self._thread:
            self._thread.join(timeout=5)

        if self._stream:
            self._stream.stop_stream()
            self._stream.close()
        if self._pa:
            self._pa.terminate()

        if not self.frames:
            return None

        timestamp = time.strftime("%Y%m%d_%H%M%S")
        filename = os.path.join(self.output_dir, f"meeting_{timestamp}.wav")

        with wave.open(filename, "wb") as wf:
            wf.setnchannels(self.channels)
            wf.setsampwidth(self.sample_width)
            wf.setframerate(self.sample_rate)
            wf.writeframes(b"".join(self.frames))

        self.current_file = filename
        self.frames = []
        return filename

    def get_duration(self):
        """Get current recording duration in seconds."""
        if not self.frames or not self.sample_rate:
            return 0
        total_bytes = sum(len(f) for f in self.frames)
        bytes_per_second = self.sample_rate * self.channels * self.sample_width
        return total_bytes / bytes_per_second if bytes_per_second > 0 else 0
