"""Attribution scenarios from reference-labelled fixtures (host-onboarding plan 3).

tracks: each speaker's reference turns masked out of the mix (what separate mics give).
bleed:  tracks plus every other speaker at -15 dB (what well-separated mics give).
bleed-6, bleed-9: the same at -6 and -9 dB (mics close together on a stage).
unmiked: a mic per debater only; each debater mic hears the other debater at -9 dB and the
         moderators at -3 dB (a moderator sitting between the mics, with no mic of their own).
mono:   the mix itself (one room mic, or a video call's single feed).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[3]


def reference_turns(utterances_json: dict, speaker_map: dict[str, str]) -> list[tuple[int, int, str]]:
    return [(int(u["startMs"]), int(u["endMs"]), speaker_map.get(u["speaker"], "UNK")) for u in utterances_json["utterances"]]


def _mask(n: int, sr: int, turns, key: str) -> np.ndarray:
    m = np.zeros(n, dtype=np.float32)
    for s, e, k in turns:
        if k == key:
            m[int(s * sr / 1000) : int(e * sr / 1000)] = 1.0
    return m


def make_tracks(mix: np.ndarray, sr: int, turns, keys: list[str], bleed_db: float | None) -> dict[str, np.ndarray]:
    masks = {k: _mask(len(mix), sr, turns, k) for k in keys}
    out = {}
    for k in keys:
        own = mix * masks[k]
        if bleed_db is not None:
            others = np.clip(sum(masks[o] for o in keys if o != k), 0, 1) if len(keys) > 1 else 0
            own = own + mix * others * (10 ** (bleed_db / 20))
        out[k] = own.astype(np.float32)
    return out


BLEED_LEVELS = {"bleed": -15.0, "bleed-6": -6.0, "bleed-9": -9.0}
UNMIKED_BLEED_DB = -9.0
UNMIKED_MODERATOR_DB = -3.0


def make_unmiked(mix: np.ndarray, sr: int, turns, debaters: list[str], moderators: list[str], bleed_db: float, moderator_db: float) -> dict[str, np.ndarray]:
    """Debater tracks only: own speech, the other debaters at bleed_db, every moderator at moderator_db."""
    tracks = make_tracks(mix, sr, turns, debaters, bleed_db)
    mods = np.clip(sum((_mask(len(mix), sr, turns, m) for m in moderators), np.zeros(len(mix), dtype=np.float32)), 0, 1)
    return {k: (pcm + mix * mods * (10 ** (moderator_db / 20))).astype(np.float32) for k, pcm in tracks.items()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--minutes", type=float, default=20)
    ap.add_argument("--out", default=str(ROOT / ".data" / "scenarios"))
    ap.add_argument("--only", nargs="*", help="track sets to write (default all): tracks bleed bleed-6 bleed-9 unmiked")
    a = ap.parse_args()
    fx = ROOT / "fixtures" / "antidebate" / a.fixture
    manifest = json.loads((fx / "manifest.json").read_text())
    mix, sr = sf.read(fx / "audio.16k.wav", dtype="float32")
    start = int(manifest.get("programStartMs", 0))
    end = start + int(a.minutes * 60_000)
    mix = mix[int(start * sr / 1000) : int(end * sr / 1000)]
    turns = [(max(0, s - start), min(end, e) - start, k) for s, e, k in reference_turns(json.loads((fx / "transcript.utterances.json").read_text()), manifest["speakerMap"]) if e > start and s < end]
    keys = sorted({k for _, _, k in turns if k != "UNK"})
    out = Path(a.out) / a.fixture
    roles = {p["key"]: "debater" for p in manifest["participants"]}
    debaters = [k for k in keys if roles.get(k) == "debater"]
    moderators = [k for k in keys if roles.get(k) != "debater"]
    sets: dict[str, dict[str, np.ndarray]] = {}
    for sub, db in (("tracks", None), *BLEED_LEVELS.items()):
        sets[sub] = make_tracks(mix, sr, turns, keys, db)
    sets["unmiked"] = make_unmiked(mix, sr, turns, debaters, moderators, UNMIKED_BLEED_DB, UNMIKED_MODERATOR_DB)
    out.mkdir(parents=True, exist_ok=True)
    sf.write(out / "mono.wav", mix, sr, subtype="FLOAT")
    for sub, tracks in sets.items():
        if a.only and sub not in a.only:
            continue
        (out / sub).mkdir(parents=True, exist_ok=True)
        for k, pcm in tracks.items():
            sf.write(out / sub / f"{k}.wav", pcm, sr, subtype="FLOAT")
    participants = [{"key": k, "displayName": next((p["displayName"] for p in manifest["participants"] if p["key"] == k), k), "role": roles.get(k, "moderator")} for k in keys]
    (out / "reference.json").write_text(json.dumps({"turns": turns, "participants": participants}))
    print(f"{a.fixture}: {len(turns)} turns, speakers {keys} → {out}")


if __name__ == "__main__":
    main()
