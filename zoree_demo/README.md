# Zoree TMS — 3-Minute Demo

Compressed, voiceover-ready cut of the full screen recording.

## Files
- `zoree_demo_3min_silent.mp4` — the finished 2:56 cut (no audio), 1920×1030.
- `voiceover_script.md` — the timed narration (professional female, Aria voice).
- `generate_voiceover.py` — one command adds the real AI voiceover to the video.

## Add the voiceover (one step, ~1 minute)
Run on any computer with internet. No API key needed.

```bash
pip install edge-tts          # one-time
# ffmpeg must be installed too:  winget install Gyan.FFmpeg  (Windows)
#                                brew install ffmpeg          (macOS)
python generate_voiceover.py
```

This produces **`zoree_demo_3min_narrated.mp4`** — the final demo with voice.

To change the voice or wording, edit `VOICE` / `SEGMENTS` at the top of
`generate_voiceover.py` and re-run. Voice options are listed in the script header.

## How the cut was built
Six key beats were selected from the 4:25 original and joined:
Orders & auto-consolidation → planning → shipment created/tendered →
Carrier Portal acceptance → dock scheduling → the ZoreeAI copilot planning and
tendering by natural language.
