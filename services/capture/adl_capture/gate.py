"""Channel gate: bleed suppression and overlap detection (ARCHITECTURE §2.1 step 4).

For a speech region detected on one or more mic channels, the channel that is
louder than every other active channel by at least ``margin_db`` owns it; the
quieter copies are bleed. Two or more channels within the margin are true
overlap and are kept as separate utterances.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Mapping

import numpy as np

SILENCE_DBFS = -50.0


def rms_dbfs(samples: np.ndarray) -> float:
    """RMS level of a float32 [-1, 1] buffer in dBFS (−inf-safe)."""
    if samples.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    return 20.0 * np.log10(max(rms, 1e-6))


@dataclass(frozen=True)
class Ownership:
    kind: Literal["silence", "single", "overlap"]
    owners: tuple[str, ...]
    margin_db: float  # loudest minus runner-up (inf when only one channel is active)


def assign_owner(levels_dbfs: Mapping[str, float], margin_db: float = 6.0, silence_dbfs: float = SILENCE_DBFS) -> Ownership:
    active = sorted(((lvl, ch) for ch, lvl in levels_dbfs.items() if lvl > silence_dbfs), reverse=True)
    if not active:
        return Ownership("silence", (), 0.0)
    if len(active) == 1:
        return Ownership("single", (active[0][1],), float("inf"))
    top_lvl, top_ch = active[0]
    runner_lvl = active[1][0]
    gap = top_lvl - runner_lvl
    if gap >= margin_db:
        return Ownership("single", (top_ch,), gap)
    overlapping = tuple(ch for lvl, ch in active if top_lvl - lvl < margin_db)
    return Ownership("overlap", overlapping, gap)
