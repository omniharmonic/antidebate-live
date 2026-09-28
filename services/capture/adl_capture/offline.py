"""Offline transcription + diarization for replays (R0; ARCHITECTURE §2.3).

    uv run --extra mac --extra diarize python -m adl_capture.offline fixtures/antidebate/ball-kokotajlo-ai-governance

Reads audio.16k.wav (from tools/fetch-replays.sh), writes transcript.utterances.json
with anonymous speaker labels (SPEAKER_00…), and prints the label list so the
operator can fill `speakerMap` in manifest.json (label → participant key) after
listening to a few lines. Nothing is attributed to a named person without that step.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from .merge import Turn, Word, merge


def transcribe(wav: Path) -> list[Word]:
    try:
        from parakeet_mlx import from_pretrained  # type: ignore[import-not-found]
    except ImportError as e:  # pragma: no cover
        raise SystemExit("parakeet-mlx not installed: uv sync --extra mac (Apple Silicon only)") from e
    model = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3")
    result = model.transcribe(str(wav), chunk_duration=120.0, overlap_duration=15.0)
    words: list[Word] = []
    # parakeet-mlx returns sentences with token timings; verify field names against the installed version.
    for sentence in result.sentences:
        for tok in sentence.tokens:
            words.append(Word(tok.text.strip(), int(tok.start * 1000), int(tok.end * 1000)))
    return [w for w in words if w.text]


def diarize(wav: Path) -> list[Turn]:
    try:
        from pyannote.audio import Pipeline  # type: ignore[import-not-found]
    except ImportError as e:  # pragma: no cover
        raise SystemExit("pyannote.audio not installed: uv sync --extra diarize (needs HF_TOKEN)") from e
    pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=os.environ.get("HF_TOKEN"))
    annotation = pipeline(str(wav))
    return [Turn(spk, int(seg.start * 1000), int(seg.end * 1000)) for seg, _, spk in annotation.itertracks(yield_label=True)]


def main(folder: str) -> None:
    d = Path(folder)
    wav = d / "audio.16k.wav"
    if not wav.exists():
        raise SystemExit(f"{wav} missing — run tools/fetch-replays.sh first")
    words = transcribe(wav)
    turns = diarize(wav)
    utterances = merge(words, turns)
    (d / "transcript.utterances.json").write_text(json.dumps({"utterances": utterances}, indent=1))
    labels = sorted({u["speaker"] for u in utterances})
    print(f"{len(utterances)} utterances; speaker labels: {labels}")
    print('Now set "speakerMap" in manifest.json, e.g. {"SPEAKER_00": "MOD", "SPEAKER_01": "A", "SPEAKER_02": "B"}')


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
