#!/usr/bin/env python3
"""
Zoree TMS demo - voiceover generator.

Generates a professional female AI voiceover (Microsoft "Aria" neural voice)
timed to the 3-minute cut and muxes it onto the silent video, producing:

    zoree_demo_3min_narrated.mp4

USAGE
-----
1. Install dependencies (one time), on a machine WITH internet access:

       pip install edge-tts
       # ffmpeg must also be installed and on PATH:
       #   Windows:  winget install Gyan.FFmpeg     (or download from ffmpeg.org)
       #   macOS:    brew install ffmpeg
       #   Linux:    sudo apt install ffmpeg

2. Keep this script in the same folder as "zoree_demo_3min_silent.mp4".

3. Run:

       python generate_voiceover.py

   Output "zoree_demo_3min_narrated.mp4" appears in the same folder.

NOTES
-----
- edge-tts streams audio from Microsoft's free neural TTS service, so the
  machine you run this on needs internet access. No API key required.
- To try a different voice, change VOICE below. Good options:
      en-US-AriaNeural    (female, professional)   <- default
      en-US-JennyNeural   (female, calm)
      en-US-GuyNeural     (male, professional)
      en-US-AndrewNeural  (male, energetic)
- RATE/PITCH let you fine-tune pace. "+0%" is natural; "+8%" is a touch faster.
"""

import asyncio
import os
import shutil
import subprocess
import sys
import tempfile

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
VOICE = "en-US-AriaNeural"   # professional female
RATE  = "+0%"                # speaking rate, e.g. "+8%" faster, "-5%" slower
PITCH = "+0Hz"

HERE = os.path.dirname(os.path.abspath(__file__))
SILENT_VIDEO = os.path.join(HERE, "zoree_demo_3min_silent.mp4")
OUTPUT_VIDEO = os.path.join(HERE, "zoree_demo_3min_narrated.mp4")

# Each segment: (start_seconds_in_final_cut, narration_text)
SEGMENTS = [
    (0.5,  "This is Zoree, a transportation management platform built to move "
           "freight with less work and lower cost. Every open order flows into "
           "one screen, and Zoree automatically consolidates them by lane on "
           "every run, so your team stops planning loads by hand."),

    (26.0, "Watch what happens when we plan. Zoree shops every order against "
           "your carriers, finds the cheapest compliant rate, and builds the "
           "shipment in seconds. These orders just consolidated into a single "
           "truckload, turning separate moves into one optimized load, with the "
           "savings calculated right here."),

    (59.0, "From there, the shipment is created and tendered to the carrier in "
           "one step. No spreadsheets, no phone calls. Every detail, from weight "
           "to lane to rate, is captured automatically and ready to execute."),

    (88.0, "When the carrier accepts, it shows up instantly in the Carrier "
           "Portal, with live tender status, PRO numbers, and an acceptance rate "
           "your team can actually trust. In this account, that rate is a "
           "hundred percent."),

    (116.0, "Dock scheduling closes the loop. Appointments, door capacity, and "
            "dwell, all in one view."),

    (129.0, "And here's where Zoree gets really powerful. Just tell the AI "
            "copilot what you want, in plain English. Plan this order, and Zoree "
            "picks the best carrier, prices it, and creates the shipment. Tender "
            "it, and it's gone, instantly."),

    (158.0, "No menus, no steps, just results. From open order to booked truck, "
            "Zoree turns hours of manual planning into a few seconds of "
            "conversation. That's Zoree. See what it can do for your freight."),
]


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def need(cmd):
    if shutil.which(cmd) is None:
        sys.exit(f"ERROR: '{cmd}' not found on PATH. Please install it (see header of this script).")


def probe_duration(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path,
    ])
    return float(out.decode().strip())


async def synth(text, out_path):
    import edge_tts
    comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
    await comm.save(out_path)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
def main():
    need("ffmpeg")
    need("ffprobe")
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        sys.exit("ERROR: edge-tts not installed. Run:  pip install edge-tts")

    if not os.path.exists(SILENT_VIDEO):
        sys.exit(f"ERROR: silent video not found next to script:\n  {SILENT_VIDEO}")

    video_dur = probe_duration(SILENT_VIDEO)
    print(f"Video duration: {video_dur:.2f}s   Voice: {VOICE}")

    tmp = tempfile.mkdtemp(prefix="zoree_vo_")
    clip_paths = []
    try:
        # 1) Synthesize each narration line.
        for i, (start, text) in enumerate(SEGMENTS):
            mp3 = os.path.join(tmp, f"line_{i}.mp3")
            print(f"  [{i+1}/{len(SEGMENTS)}] synthesizing @ {start:.1f}s ...")
            asyncio.run(synth(text, mp3))
            dur = probe_duration(mp3)
            end = start + dur
            nxt = SEGMENTS[i + 1][0] if i + 1 < len(SEGMENTS) else video_dur
            flag = "  <-- OVERLAPS next beat, consider trimming text" if end > nxt + 0.4 else ""
            print(f"        length {dur:5.2f}s  ends @ {end:6.2f}s{flag}")
            clip_paths.append((start, mp3))

        # 2) Mix all lines onto one full-length track, each delayed to its start.
        inputs = []
        filters = []
        for idx, (start, mp3) in enumerate(clip_paths):
            inputs += ["-i", mp3]
            ms = int(start * 1000)
            filters.append(f"[{idx}:a]adelay={ms}|{ms}[a{idx}]")
        mix_in = "".join(f"[a{idx}]" for idx in range(len(clip_paths)))
        # apad pads the mixed voice with trailing silence so the audio track is
        # exactly as long as the video (otherwise the closing footage would be
        # cut off when muxing).
        filtergraph = (
            ";".join(filters)
            + f";{mix_in}amix=inputs={len(clip_paths)}:normalize=0:dropout_transition=0[mixed]"
            + ";[mixed]alimiter=limit=0.95,apad,aresample=48000[vo]"
        )
        voice_track = os.path.join(tmp, "voice.m4a")
        subprocess.check_call(
            ["ffmpeg", "-y", "-v", "error", *inputs,
             "-filter_complex", filtergraph,
             "-map", "[vo]", "-c:a", "aac", "-b:a", "192k",
             "-t", f"{video_dur:.3f}", voice_track]
        )

        # 3) Mux voice onto the silent video (copy video stream, no re-encode).
        subprocess.check_call(
            ["ffmpeg", "-y", "-v", "error",
             "-i", SILENT_VIDEO, "-i", voice_track,
             "-map", "0:v:0", "-map", "1:a:0",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
             "-movflags", "+faststart", OUTPUT_VIDEO]
        )
        print(f"\nDONE -> {OUTPUT_VIDEO}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
