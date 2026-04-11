"""
Zoree Meeting Recorder - Desktop app for recording and summarizing meetings.
Free alternative to Fireflies.ai using local AI (Whisper + Ollama).
"""
import tkinter as tk
from tkinter import ttk, scrolledtext, filedialog, messagebox
import threading
import time
import os
import sys

from recorder import AudioRecorder
from transcriber import Transcriber
from summarizer import Summarizer


class MeetingRecorderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Zoree Meeting Recorder")
        self.root.geometry("900x700")
        self.root.minsize(700, 500)

        # State
        self.recorder = AudioRecorder(output_dir="recordings")
        self.transcriber = Transcriber(model_size="base", device="cpu", compute_type="int8")
        self.summarizer = Summarizer(model="qwen2.5:1.5b")
        self.is_recording = False
        self.recording_start_time = None
        self.current_audio_file = None
        self.current_transcript = None

        self._build_ui()
        self._check_dependencies()

    def _build_ui(self):
        """Build the application UI."""
        # Style
        style = ttk.Style()
        style.theme_use("clam")

        # Main container
        main_frame = ttk.Frame(self.root, padding=10)
        main_frame.pack(fill=tk.BOTH, expand=True)

        # ---- Header ----
        header = ttk.Frame(main_frame)
        header.pack(fill=tk.X, pady=(0, 10))

        ttk.Label(
            header, text="Zoree Meeting Recorder", font=("Segoe UI", 18, "bold")
        ).pack(side=tk.LEFT)

        self.status_label = ttk.Label(
            header, text="Ready", font=("Segoe UI", 10), foreground="gray"
        )
        self.status_label.pack(side=tk.RIGHT)

        # ---- Settings Frame ----
        settings_frame = ttk.LabelFrame(main_frame, text="Settings", padding=8)
        settings_frame.pack(fill=tk.X, pady=(0, 10))

        # Whisper model
        ttk.Label(settings_frame, text="Whisper Model:").grid(
            row=0, column=0, sticky=tk.W, padx=(0, 5)
        )
        self.whisper_model_var = tk.StringVar(value="base")
        whisper_combo = ttk.Combobox(
            settings_frame,
            textvariable=self.whisper_model_var,
            values=["tiny", "base", "small", "medium", "large-v3"],
            state="readonly",
            width=12,
        )
        whisper_combo.grid(row=0, column=1, padx=(0, 20))

        # Ollama model
        ttk.Label(settings_frame, text="Ollama Model:").grid(
            row=0, column=2, sticky=tk.W, padx=(0, 5)
        )
        self.ollama_model_var = tk.StringVar(value="qwen2.5:1.5b")
        ollama_combo = ttk.Combobox(
            settings_frame,
            textvariable=self.ollama_model_var,
            values=["qwen2.5:1.5b", "qwen2.5:3b", "llama3.2", "mistral", "phi3"],
            width=12,
        )
        ollama_combo.grid(row=0, column=3, padx=(0, 20))

        # Device
        ttk.Label(settings_frame, text="Device:").grid(
            row=0, column=4, sticky=tk.W, padx=(0, 5)
        )
        self.device_var = tk.StringVar(value="cpu")
        device_combo = ttk.Combobox(
            settings_frame,
            textvariable=self.device_var,
            values=["cpu", "cuda"],
            state="readonly",
            width=8,
        )
        device_combo.grid(row=0, column=5)

        # ---- Control Buttons ----
        controls = ttk.Frame(main_frame)
        controls.pack(fill=tk.X, pady=(0, 10))

        self.record_btn = ttk.Button(
            controls,
            text="Start Recording",
            command=self._toggle_recording,
            style="Accent.TButton",
        )
        self.record_btn.pack(side=tk.LEFT, padx=(0, 5))

        self.transcribe_btn = ttk.Button(
            controls,
            text="Transcribe",
            command=self._start_transcription,
            state=tk.DISABLED,
        )
        self.transcribe_btn.pack(side=tk.LEFT, padx=(0, 5))

        self.summarize_btn = ttk.Button(
            controls,
            text="Summarize",
            command=self._start_summarization,
            state=tk.DISABLED,
        )
        self.summarize_btn.pack(side=tk.LEFT, padx=(0, 5))

        self.load_btn = ttk.Button(
            controls, text="Load Audio File", command=self._load_audio_file
        )
        self.load_btn.pack(side=tk.LEFT, padx=(0, 5))

        self.save_btn = ttk.Button(
            controls, text="Save All", command=self._save_all, state=tk.DISABLED
        )
        self.save_btn.pack(side=tk.LEFT, padx=(0, 5))

        # Timer label
        self.timer_label = ttk.Label(
            controls, text="00:00:00", font=("Consolas", 14), foreground="gray"
        )
        self.timer_label.pack(side=tk.RIGHT)

        # ---- Notebook (tabs) ----
        notebook = ttk.Notebook(main_frame)
        notebook.pack(fill=tk.BOTH, expand=True)

        # Transcript tab
        transcript_frame = ttk.Frame(notebook, padding=5)
        notebook.add(transcript_frame, text="Transcript")

        self.transcript_text = scrolledtext.ScrolledText(
            transcript_frame, wrap=tk.WORD, font=("Consolas", 10)
        )
        self.transcript_text.pack(fill=tk.BOTH, expand=True)

        # Summary tab
        summary_frame = ttk.Frame(notebook, padding=5)
        notebook.add(summary_frame, text="Summary")

        self.summary_text = scrolledtext.ScrolledText(
            summary_frame, wrap=tk.WORD, font=("Consolas", 10)
        )
        self.summary_text.pack(fill=tk.BOTH, expand=True)

        # Log tab
        log_frame = ttk.Frame(notebook, padding=5)
        notebook.add(log_frame, text="Log")

        self.log_text = scrolledtext.ScrolledText(
            log_frame, wrap=tk.WORD, font=("Consolas", 9), foreground="gray"
        )
        self.log_text.pack(fill=tk.BOTH, expand=True)

        # ---- Progress bar ----
        self.progress = ttk.Progressbar(main_frame, mode="indeterminate")
        self.progress.pack(fill=tk.X, pady=(10, 0))

    def _check_dependencies(self):
        """Check if required dependencies are available."""
        self._log("Checking dependencies...")

        # Check PyAudioWPatch
        try:
            import pyaudiowpatch
            self._log("  [OK] PyAudioWPatch installed")
        except ImportError:
            self._log("  [MISSING] PyAudioWPatch - pip install PyAudioWPatch")

        # Check faster-whisper
        try:
            import faster_whisper
            self._log("  [OK] faster-whisper installed")
        except ImportError:
            self._log("  [MISSING] faster-whisper - pip install faster-whisper")

        # Check Ollama
        ok, msg = self.summarizer.check_ollama()
        if ok:
            self._log(f"  [OK] Ollama: {msg}")
        else:
            self._log(f"  [WARN] Ollama: {msg}")

        self._log("Ready. Click 'Start Recording' to begin capturing meeting audio.")

    def _log(self, message):
        """Add a message to the log."""
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.see(tk.END)
        self.status_label.config(text=message[:60])

    def _toggle_recording(self):
        """Start or stop recording."""
        if not self.is_recording:
            self._start_recording()
        else:
            self._stop_recording()

    def _start_recording(self):
        """Start recording system audio."""
        try:
            self.recorder.start()
            self.is_recording = True
            self.recording_start_time = time.time()
            self.record_btn.config(text="Stop Recording")
            self.timer_label.config(foreground="red")
            self.transcribe_btn.config(state=tk.DISABLED)
            self._log("Recording started - capturing system audio...")
            self._update_timer()
        except Exception as e:
            messagebox.showerror("Recording Error", str(e))
            self._log(f"ERROR: {e}")

    def _stop_recording(self):
        """Stop recording and save the audio file."""
        self.is_recording = False
        self.record_btn.config(text="Start Recording")
        self.timer_label.config(foreground="gray")

        try:
            filepath = self.recorder.stop()
            if filepath:
                self.current_audio_file = filepath
                file_size = os.path.getsize(filepath) / (1024 * 1024)
                self._log(f"Recording saved: {filepath} ({file_size:.1f} MB)")
                self.transcribe_btn.config(state=tk.NORMAL)
            else:
                self._log("No audio captured.")
        except Exception as e:
            messagebox.showerror("Error", str(e))
            self._log(f"ERROR stopping recording: {e}")

    def _update_timer(self):
        """Update the recording timer display."""
        if self.is_recording and self.recording_start_time:
            elapsed = int(time.time() - self.recording_start_time)
            hours = elapsed // 3600
            minutes = (elapsed % 3600) // 60
            seconds = elapsed % 60
            self.timer_label.config(text=f"{hours:02d}:{minutes:02d}:{seconds:02d}")
            self.root.after(1000, self._update_timer)

    def _load_audio_file(self):
        """Load an existing audio file for transcription."""
        filepath = filedialog.askopenfilename(
            title="Select Audio File",
            filetypes=[
                ("Audio Files", "*.wav *.mp3 *.m4a *.flac *.ogg"),
                ("WAV files", "*.wav"),
                ("All files", "*.*"),
            ],
        )
        if filepath:
            self.current_audio_file = filepath
            self._log(f"Loaded audio file: {filepath}")
            self.transcribe_btn.config(state=tk.NORMAL)

    def _start_transcription(self):
        """Start transcription in a background thread."""
        if not self.current_audio_file:
            messagebox.showwarning("No Audio", "Record or load an audio file first.")
            return

        # Update transcriber settings
        self.transcriber.model_size = self.whisper_model_var.get()
        self.transcriber.device = self.device_var.get()
        self.transcriber.compute_type = (
            "float16" if self.device_var.get() == "cuda" else "int8"
        )
        self.transcriber.model = None  # Force reload with new settings

        self.transcribe_btn.config(state=tk.DISABLED)
        self.progress.start()

        thread = threading.Thread(target=self._do_transcription, daemon=True)
        thread.start()

    def _do_transcription(self):
        """Perform transcription (runs in background thread)."""
        try:
            result = self.transcriber.transcribe(
                self.current_audio_file,
                progress_callback=lambda msg: self.root.after(0, self._log, msg),
            )

            self.current_transcript = result

            def update_ui():
                self.transcript_text.delete("1.0", tk.END)
                # Show timestamped segments
                for seg in result["segments"]:
                    start_min = int(seg["start"] // 60)
                    start_sec = int(seg["start"] % 60)
                    self.transcript_text.insert(
                        tk.END, f"[{start_min:02d}:{start_sec:02d}] {seg['text']}\n\n"
                    )

                self.summarize_btn.config(state=tk.NORMAL)
                self.save_btn.config(state=tk.NORMAL)
                self.transcribe_btn.config(state=tk.NORMAL)
                self.progress.stop()

            self.root.after(0, update_ui)

        except Exception as e:
            self.root.after(
                0,
                lambda: (
                    messagebox.showerror("Transcription Error", str(e)),
                    self.transcribe_btn.config(state=tk.NORMAL),
                    self.progress.stop(),
                    self._log(f"ERROR: {e}"),
                ),
            )

    def _start_summarization(self):
        """Start summarization in a background thread."""
        if not self.current_transcript:
            messagebox.showwarning(
                "No Transcript", "Transcribe the audio first."
            )
            return

        # Update summarizer settings
        self.summarizer.model = self.ollama_model_var.get()

        # Check Ollama first
        ok, msg = self.summarizer.check_ollama()
        if not ok:
            messagebox.showerror("Ollama Error", msg)
            self._log(f"Ollama error: {msg}")
            return

        self.summarize_btn.config(state=tk.DISABLED)
        self.progress.start()

        thread = threading.Thread(target=self._do_summarization, daemon=True)
        thread.start()

    def _do_summarization(self):
        """Perform summarization (runs in background thread)."""
        try:
            result = self.summarizer.summarize(
                self.current_transcript["text"],
                progress_callback=lambda msg: self.root.after(0, self._log, msg),
            )

            def update_ui():
                self.summary_text.delete("1.0", tk.END)
                self.summary_text.insert(tk.END, result["summary"])
                self.summarize_btn.config(state=tk.NORMAL)
                self.save_btn.config(state=tk.NORMAL)
                self.progress.stop()

            self.root.after(0, update_ui)

        except Exception as e:
            self.root.after(
                0,
                lambda: (
                    messagebox.showerror("Summarization Error", str(e)),
                    self.summarize_btn.config(state=tk.NORMAL),
                    self.progress.stop(),
                    self._log(f"ERROR: {e}"),
                ),
            )

    def _save_all(self):
        """Save transcript and summary to files."""
        output_dir = filedialog.askdirectory(title="Select Output Directory")
        if not output_dir:
            return

        timestamp = time.strftime("%Y%m%d_%H%M%S")

        try:
            if self.current_transcript:
                transcript_path = os.path.join(
                    output_dir, f"transcript_{timestamp}.txt"
                )
                self.transcriber.save_transcript(self.current_transcript, transcript_path)
                self._log(f"Transcript saved: {transcript_path}")

            summary_text = self.summary_text.get("1.0", tk.END).strip()
            if summary_text:
                summary_path = os.path.join(output_dir, f"summary_{timestamp}.txt")
                with open(summary_path, "w", encoding="utf-8") as f:
                    f.write("=" * 60 + "\n")
                    f.write("MEETING SUMMARY\n")
                    f.write(f"Model: {self.ollama_model_var.get()} (local)\n")
                    f.write("=" * 60 + "\n\n")
                    f.write(summary_text)
                self._log(f"Summary saved: {summary_path}")

            messagebox.showinfo("Saved", "Files saved successfully!")

        except Exception as e:
            messagebox.showerror("Save Error", str(e))
            self._log(f"ERROR saving: {e}")


def main():
    root = tk.Tk()

    # Set icon if available
    try:
        root.iconbitmap(default="")
    except Exception:
        pass

    app = MeetingRecorderApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
