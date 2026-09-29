#!/usr/bin/env bash
# Download prior Anti-Debate media for replays (R0 / gold sets G2, G3).
# Run from a LOCAL machine: the cloud build container blocks YouTube.
# Requires: uv (runs the latest yt-dlp via uvx), ffmpeg.
# YouTube 403s audio without browser impersonation (curl_cffi) and a JS runtime
# for its signature challenge (node + yt-dlp-ejs); plain `yt-dlp` fails.
set -euo pipefail
ytdlp() { uvx --with curl_cffi --with yt-dlp-ejs yt-dlp --js-runtimes node "$@"; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/fixtures/antidebate"

fetch() { # slug url
  local slug="$1" url="$2" dir="$OUT/$1"
  mkdir -p "$dir"
  echo "→ $slug"
  # best audio, remuxed to m4a; keep the video id in the info json
  ytdlp -f "bestaudio[ext=m4a]/bestaudio" -x --audio-format m4a \
    --write-info-json --write-auto-subs --sub-langs "en.*" --sub-format vtt \
    -o "$dir/audio.%(ext)s" "$url"
  # 16 kHz mono WAV for ASR/diarization
  ffmpeg -loglevel error -y -i "$dir/audio.m4a" -ac 1 -ar 16000 "$dir/audio.16k.wav"
}

fetch ball-kokotajlo-ai-governance "https://www.youtube.com/watch?v=wkPsbwzyOa8"

if [[ "${1:-}" == "--playlist" ]]; then
  # List the playlist so we can choose G3 events; doesn't download media.
  ytdlp --flat-playlist --print "%(id)s  %(duration_string)s  %(title)s" \
    "https://www.youtube.com/playlist?list=PLRN1pe0US2hS-mWZAiYJ8OMII8BcB6UXc" | tee "$OUT/playlist.txt"
fi
echo "done. Next: services/capture offline transcription (see docs/NEXT_STEPS.md)"
