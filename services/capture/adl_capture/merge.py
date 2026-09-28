"""Merge ASR words with diarization turns into utterances (offline replay path, ARCHITECTURE §2.3).

Output matches ``OfflineUtterance`` in packages/core/src/fixtures.ts:
    {"speaker", "startMs", "endMs", "text", "words": [{"text","startMs","endMs","confidence"}]}
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Word:
    text: str
    start_ms: int
    end_ms: int
    confidence: float | None = None


@dataclass(frozen=True)
class Turn:
    speaker: str
    start_ms: int
    end_ms: int


def speaker_for(word: Word, turns: list[Turn]) -> str:
    """The diarization turn with maximum temporal overlap; nearest turn if none overlaps."""
    best, best_overlap = None, 0
    for t in turns:
        ov = min(word.end_ms, t.end_ms) - max(word.start_ms, t.start_ms)
        if ov > best_overlap:
            best, best_overlap = t, ov
    if best is not None:
        return best.speaker
    if not turns:
        return "UNK"
    mid = (word.start_ms + word.end_ms) / 2
    return min(turns, key=lambda t: min(abs(mid - t.start_ms), abs(mid - t.end_ms))).speaker


def merge(words: list[Word], turns: list[Turn], pause_ms: int = 1200) -> list[dict]:
    utterances: list[dict] = []
    current: dict | None = None
    for w in sorted(words, key=lambda x: x.start_ms):
        spk = speaker_for(w, turns)
        new = current is None or current["speaker"] != spk or w.start_ms - current["endMs"] > pause_ms
        if new:
            if current:
                utterances.append(current)
            current = {"speaker": spk, "startMs": w.start_ms, "endMs": w.end_ms, "words": []}
        assert current is not None
        current["endMs"] = w.end_ms
        current["words"].append({"text": w.text, "startMs": w.start_ms, "endMs": w.end_ms, **({"confidence": w.confidence} if w.confidence is not None else {})})
    if current:
        utterances.append(current)
    for u in utterances:
        u["text"] = " ".join(x["text"] for x in u["words"]).replace(" ,", ",").replace(" .", ".").strip()
    return utterances
