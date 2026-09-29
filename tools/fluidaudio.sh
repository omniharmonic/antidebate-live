#!/usr/bin/env bash
# Build and run FluidAudio's CLI (Apple Silicon, CoreML) for offline ASR + diarization.
# Diarization = pyannote community-1 (powerset segmentation + WeSpeaker + VBx) as CoreML;
# models are ungated and download on first use, so no Hugging Face token is needed.
#   tools/fluidaudio.sh process audio.16k.wav --mode offline --output diar.json
# Pin FLUIDAUDIO_REF to a commit for reproducible runs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.cache/FluidAudio"
REF="${FLUIDAUDIO_REF:-main}"
if [[ ! -d "$SRC/.git" ]]; then
  git clone -q --depth 1 https://github.com/FluidInference/FluidAudio.git "$SRC"
fi
BIN="$SRC/.build/release/fluidaudiocli"
if [[ ! -x "$BIN" || "${FLUIDAUDIO_REBUILD:-}" == 1 ]]; then
  if [[ "$REF" != main ]]; then git -C "$SRC" fetch -q --depth 1 origin "$REF" && git -C "$SRC" checkout -q FETCH_HEAD; fi
  (cd "$SRC" && swift build -c release --product fluidaudiocli >&2)
fi
exec "$BIN" "$@"
