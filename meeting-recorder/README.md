# Zoree Meeting Recorder

Free, fully local alternative to Fireflies.ai for recording and summarizing meetings.

## What it does
- Records system audio from any meeting app (Zoom, Google Meet, Teams, etc.)
- Transcribes audio locally using OpenAI Whisper (no cloud, no API costs)
- Summarizes meetings using a local LLM via Ollama (no cloud, no API costs)
- Saves transcripts and summaries as text files

## Prerequisites

1. **Python 3.10+** - https://www.python.org/downloads/
2. **Ollama** - https://ollama.com/download

## Quick Setup

```bash
# 1. Run the setup script (installs Python deps + pulls Ollama model)
setup.bat

# 2. Make sure Ollama is running
ollama serve

# 3. Launch the app
run.bat
```

## Manual Setup

```bash
# Create virtual environment
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Pull an Ollama model for summarization
ollama pull llama3.2

# Run
python app.py
```

## Usage

1. Open any meeting app (Zoom, Teams, Google Meet, etc.)
2. Click **Start Recording** - captures all system audio
3. When the meeting ends, click **Stop Recording**
4. Click **Transcribe** - converts audio to text (takes ~1/4 of meeting duration on CPU)
5. Click **Summarize** - generates an AI summary with key points and action items
6. Click **Save All** to export transcript and summary files

You can also click **Load Audio File** to transcribe a previously recorded file.

## Settings

| Setting | Options | Notes |
|---------|---------|-------|
| Whisper Model | tiny, **base**, small, medium, large-v3 | Larger = more accurate but slower |
| Ollama Model | **llama3.2**, llama3.1, mistral, phi3 | Any model you've pulled in Ollama |
| Device | **cpu**, cuda | Use cuda if you have an NVIDIA GPU |

## Cost: $0/month

Everything runs locally on your machine. No API keys, no subscriptions, no data leaving your computer.
