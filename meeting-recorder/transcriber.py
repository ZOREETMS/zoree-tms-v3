"""
Transcription Module - Uses faster-whisper for local speech-to-text.
"""
import os
import time


class Transcriber:
    def __init__(self, model_size="base", device="cpu", compute_type="int8"):
        """
        Initialize the transcriber.

        Args:
            model_size: Whisper model size - "tiny", "base", "small", "medium", "large-v3"
                        Larger = more accurate but slower. "base" is a good balance.
            device: "cpu" or "cuda" (if you have an NVIDIA GPU)
            compute_type: "int8" for CPU, "float16" for GPU
        """
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.model = None

    def load_model(self, progress_callback=None):
        """Load the Whisper model. Downloads on first use (~150MB for base)."""
        if progress_callback:
            progress_callback(f"Loading Whisper '{self.model_size}' model...")

        from faster_whisper import WhisperModel

        self.model = WhisperModel(
            self.model_size,
            device=self.device,
            compute_type=self.compute_type,
        )

        if progress_callback:
            progress_callback("Model loaded successfully.")

    def transcribe(self, audio_path, progress_callback=None):
        """
        Transcribe an audio file to text.

        Args:
            audio_path: Path to the WAV file
            progress_callback: Optional callback for progress updates

        Returns:
            dict with 'text' (full transcript), 'segments' (timestamped segments),
            and 'duration' (audio duration in seconds)
        """
        if not self.model:
            self.load_model(progress_callback)

        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        if progress_callback:
            progress_callback("Transcribing audio... This may take a while.")

        start_time = time.time()

        segments_iter, info = self.model.transcribe(
            audio_path,
            beam_size=5,
            language="en",
            vad_filter=True,  # Filter out silence
            vad_parameters=dict(
                min_silence_duration_ms=500,
            ),
        )

        segments = []
        full_text_parts = []

        for segment in segments_iter:
            seg_data = {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            }
            segments.append(seg_data)
            full_text_parts.append(segment.text.strip())

            if progress_callback:
                progress_callback(
                    f"Transcribed: {segment.end:.0f}s / {info.duration:.0f}s"
                )

        elapsed = time.time() - start_time
        full_text = " ".join(full_text_parts)

        if progress_callback:
            progress_callback(
                f"Transcription complete in {elapsed:.1f}s "
                f"({info.duration:.0f}s of audio)"
            )

        return {
            "text": full_text,
            "segments": segments,
            "duration": info.duration,
            "processing_time": elapsed,
        }

    def save_transcript(self, result, output_path):
        """Save transcript to a text file with timestamps."""
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("=" * 60 + "\n")
            f.write("MEETING TRANSCRIPT\n")
            f.write(f"Audio Duration: {result['duration']:.0f} seconds\n")
            f.write(f"Processing Time: {result['processing_time']:.1f} seconds\n")
            f.write("=" * 60 + "\n\n")

            f.write("--- FULL TRANSCRIPT ---\n\n")
            f.write(result["text"] + "\n\n")

            f.write("--- TIMESTAMPED SEGMENTS ---\n\n")
            for seg in result["segments"]:
                start_min = int(seg["start"] // 60)
                start_sec = int(seg["start"] % 60)
                end_min = int(seg["end"] // 60)
                end_sec = int(seg["end"] % 60)
                f.write(
                    f"[{start_min:02d}:{start_sec:02d} - {end_min:02d}:{end_sec:02d}] "
                    f"{seg['text']}\n"
                )

        return output_path
