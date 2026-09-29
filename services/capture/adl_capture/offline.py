"""Offline transcription + diarization for replays (R0; ARCHITECTURE §2.3).

    uv run python -m adl_capture.offline ../../fixtures/antidebate/ball-kokotajlo-ai-governance

Runs FluidAudio (tools/fluidaudio.sh, CoreML on Apple Silicon) on audio.16k.wav:
  - ASR: Parakeet TDT v3 with word timings        → asr.fluidaudio.json
  - Diarization: pyannote community-1 (powerset    → diarization.fluidaudio.json
    segmentation + WeSpeaker + VBx), ungated models; no Hugging Face token
Existing outputs are reused; pass --rerun to regenerate them.

Writes transcript.utterances.json with anonymous speaker labels (S1, S2, …) and
prints each label's talk time and a sample line, so the operator can fill
`speakerMap` in manifest.json (label → participant key) after listening.
Nothing is attributed to a named person without that step.
"""
from __future__ import annotations

import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

from .merge import Turn, Word, merge

REPO_ROOT = Path(__file__).resolve().parents[3]
FLUIDAUDIO = REPO_ROOT / "tools" / "fluidaudio.sh"


def words_from_fluidaudio(asr: dict) -> list[Word]:
    """`fluidaudiocli transcribe --word-timestamps --output-json` → words (seconds → ms)."""
    words = [
        Word(w["word"].strip(), round(w["startTime"] * 1000), round(w["endTime"] * 1000), w.get("confidence"))
        for w in asr["wordTimings"]
    ]
    return [w for w in words if w.text]


def turns_from_fluidaudio(diar: dict) -> list[Turn]:
    """`fluidaudiocli process --mode offline --output` → diarization turns (seconds → ms)."""
    return [
        Turn(s["speakerId"], round(s["startTimeSeconds"] * 1000), round(s["endTimeSeconds"] * 1000))
        for s in diar["segments"]
    ]


def speaker_summary(utterances: list[dict]) -> list[tuple[str, float, int, str]]:
    """(label, minutes, utterance count, longest line) per label, most talk time first."""
    minutes: dict[str, float] = defaultdict(float)
    count: dict[str, int] = defaultdict(int)
    sample: dict[str, str] = {}
    for u in utterances:
        spk = u["speaker"]
        minutes[spk] += (u["endMs"] - u["startMs"]) / 60000
        count[spk] += 1
        if len(u["text"]) > len(sample.get(spk, "")):
            sample[spk] = u["text"]
    return sorted(((s, minutes[s], count[s], sample[s]) for s in minutes), key=lambda r: -r[1])


def _run(args: list[str], out: Path, rerun: bool) -> dict:
    if rerun or not out.exists():
        subprocess.run([str(FLUIDAUDIO), *args], check=True)
    return json.loads(out.read_text())


def main(folder: str, rerun: bool = False) -> None:
    d = Path(folder).resolve()
    wav = d / "audio.16k.wav"
    if not wav.exists():
        raise SystemExit(f"{wav} missing — run tools/fetch-replays.sh first")
    asr_out, diar_out = d / "asr.fluidaudio.json", d / "diarization.fluidaudio.json"
    asr = _run(["transcribe", str(wav), "--word-timestamps", "--output-json", str(asr_out)], asr_out, rerun)
    diar = _run(["process", str(wav), "--mode", "offline", "--output", str(diar_out)], diar_out, rerun)
    utterances = merge(words_from_fluidaudio(asr), turns_from_fluidaudio(diar))
    (d / "transcript.utterances.json").write_text(json.dumps({"utterances": utterances}, indent=1))
    print(f"{len(utterances)} utterances from {len(asr['wordTimings'])} words")
    for spk, mins, n, line in speaker_summary(utterances):
        print(f"  {spk}: {mins:5.1f} min, {n:4d} utterances · \"{line[:110]}\"")
    print('Now set "speakerMap" in manifest.json, e.g. {"S1": "A", "S2": "B", "S3": "MOD"}')


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--rerun"]
    main(args[0] if args else ".", rerun="--rerun" in sys.argv)
