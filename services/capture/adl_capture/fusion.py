"""Attribution fusion (ARCHITECTURE §2.1 step 8).

Combines the channel-ownership margin, voiceprint similarity to the channel's
expected owner, and diarizer agreement into one confidence. Below the threshold
an utterance is emitted with ``attribution.pending`` and held from release.
"""
from __future__ import annotations

from dataclasses import dataclass

AUTO_THRESHOLD = 0.85


@dataclass(frozen=True)
class Signals:
    channel_margin_db: float | None  # None for shared/mixed channels
    voiceprint_similarity: float | None  # cosine to the expected speaker, 0..1
    diarizer_agrees: bool | None
    overlap: bool


def _clip(x: float) -> float:
    return max(0.0, min(1.0, x))


def fuse(s: Signals) -> float:
    """Heuristic starting point; tune weights on the G5 audio gold set (QUALITY §2)."""
    parts: list[tuple[float, float]] = []  # (weight, score)
    if s.channel_margin_db is not None:
        parts.append((0.5, _clip(s.channel_margin_db / 12.0)))
    if s.voiceprint_similarity is not None:
        parts.append((0.35, _clip((s.voiceprint_similarity - 0.4) / 0.4)))
    if s.diarizer_agrees is not None:
        parts.append((0.15, 1.0 if s.diarizer_agrees else 0.0))
    if not parts:
        return 0.0
    score = sum(w * v for w, v in parts) / sum(w for w, _ in parts)
    if s.overlap:
        score *= 0.8
    return round(_clip(score), 3)


def needs_operator(confidence: float, threshold: float = AUTO_THRESHOLD) -> bool:
    return confidence < threshold
