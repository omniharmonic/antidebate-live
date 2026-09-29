"""Live capture loop (ARCHITECTURE §2.1; WS1). One mic channel per person.

    uv run --extra mac --extra live python -m adl_capture.live --list-devices
    uv run --extra mac --extra live python -m adl_capture.live --session <id> \
        --channels "1=A,2=B,3=MOD" [--device 3] [--api http://localhost:3000 | --out ../../.data/<id>.events.jsonl]

Signal path per 30 ms frame: per-channel level → channel gate (gate.py: the loudest
channel by ≥ 6 dB owns the frame; the rest is bleed) → per-channel segmenter
(speech starts when a channel owns frames above the speech floor, ends after 0.7 s
without ownership, or at 15 s on the next pause) → Parakeet (MLX) with word timings
→ `utterance.final` posted to /api/events (durable spool, emit.py) or appended to a
local event file. The worker engine tails the log exactly as it does for replays.

Attribution confidence comes from the gate: a segment owned throughout is 0.97; one
with overlap is held (< 0.85) for operator confirmation (ARCHITECTURE §2.1).
"""
from __future__ import annotations

import argparse
import json
import queue
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .gate import SILENCE_DBFS, assign_owner, rms_dbfs

SAMPLE_RATE = 16_000
FRAME_MS = 30
FRAME = SAMPLE_RATE * FRAME_MS // 1000
SPEECH_FLOOR_DBFS = -42.0
END_SILENCE_MS = 700
MAX_MS = 15_000
MIN_MS = 400


@dataclass
class Segment:
    key: str
    start_ms: int
    frames: list[np.ndarray] = field(default_factory=list)
    owned: int = 0
    overlapped: int = 0
    last_voice_ms: int = 0

    @property
    def duration_ms(self) -> int:
        return len(self.frames) * FRAME_MS


class Segmenter:
    """Per-channel speech segments from gated frames. Pure: feed frames, collect closed segments."""

    def __init__(self, channel_keys: dict[str, str]):
        self.keys = channel_keys  # channel id → participant key
        self.open: dict[str, Segment] = {}

    def push(self, t_ms: int, frames: dict[str, np.ndarray]) -> list[Segment]:
        levels = {ch: rms_dbfs(x) for ch, x in frames.items()}
        own = assign_owner(levels)
        speaking = {ch for ch in own.owners if levels[ch] > SPEECH_FLOOR_DBFS}
        closed: list[Segment] = []
        for ch, key in self.keys.items():
            seg = self.open.get(ch)
            if ch in speaking:
                if seg is None:
                    seg = self.open[ch] = Segment(key, t_ms)
                seg.frames.append(frames[ch])
                seg.last_voice_ms = t_ms
                seg.owned += 1
                if own.kind == "overlap":
                    seg.overlapped += 1
            elif seg is not None:
                seg.frames.append(frames[ch])
                quiet_for = t_ms - seg.last_voice_ms
                if quiet_for >= END_SILENCE_MS or (seg.duration_ms >= MAX_MS and quiet_for >= 2 * FRAME_MS):
                    closed.append(self.open.pop(ch))
        return [s for s in closed if s.owned * FRAME_MS >= MIN_MS]

    def flush(self) -> list[Segment]:
        out = [s for s in self.open.values() if s.owned * FRAME_MS >= MIN_MS]
        self.open.clear()
        return out


def words_from_tokens(tokens, offset_ms: int) -> list[dict]:
    """Parakeet subword tokens → words (a token starting with a space opens a word)."""
    words: list[dict] = []
    for tok in tokens:
        text = tok.text
        if not words or text.startswith(" "):
            words.append({"text": text.strip(), "startMs": offset_ms + int(tok.start * 1000), "endMs": offset_ms + int(tok.end * 1000), "confidence": float(tok.confidence)})
        else:
            w = words[-1]
            w["text"] += text
            w["endMs"] = offset_ms + int(tok.end * 1000)
            w["confidence"] = min(w["confidence"], float(tok.confidence))
    return [w for w in words if w["text"]]


def utterance_event(session: str, seq: int, seg: Segment, words: list[dict], channel: str) -> dict:
    text = " ".join(w["text"] for w in words).strip()
    overlap_share = seg.overlapped / max(seg.owned, 1)
    confidence = 0.97 if overlap_share == 0 else max(0.5, 0.84 - overlap_share)
    uid = f"{session}:live:{seq:05d}"
    end_ms = seg.start_ms + seg.duration_ms
    return {
        "eventId": f"{uid}:final",
        "sessionId": session,
        "type": "utterance.final",
        "actor": "system",
        "mediaMs": end_ms,
        "wallTs": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "payload": {
            "utterance": {
                "id": uid,
                "participantKey": seg.key,
                "startMs": seg.start_ms,
                "endMs": end_ms,
                "text": text,
                "words": words,
                "attribution": {"confidence": round(confidence, 3), "signals": {"channel": channel}, "confirmedBy": "auto"},
                "overlapsWith": [],
            }
        },
    }


def main() -> None:  # pragma: no cover - needs audio hardware
    import sounddevice as sd

    ap = argparse.ArgumentParser()
    ap.add_argument("--list-devices", action="store_true")
    ap.add_argument("--session")
    ap.add_argument("--channels", help='channel→participant, 1-based: "1=A,2=B,3=MOD"')
    ap.add_argument("--device", type=int)
    ap.add_argument("--api", help="web base URL, e.g. http://localhost:3000 (uses CAPTURE_TOKEN)")
    ap.add_argument("--out", help="append events to this JSONL file instead of POSTing")
    ap.add_argument("--model", default="mlx-community/parakeet-tdt-0.6b-v3")
    a = ap.parse_args()
    if a.list_devices:
        print(sd.query_devices())
        return
    if not (a.session and a.channels and (a.api or a.out)):
        ap.error("--session, --channels and one of --api/--out are required")

    import os

    import mlx.core as mx
    from parakeet_mlx import from_pretrained
    from parakeet_mlx.audio import get_logmel

    keys = {c.split("=")[0].strip(): c.split("=")[1].strip() for c in a.channels.split(",")}
    n_in = max(int(c) for c in keys)
    model = from_pretrained(a.model)
    print(f"model ready · channels {keys}")

    if a.api:
        from .emit import Emitter

        emitter = Emitter(a.api, os.environ.get("CAPTURE_TOKEN", ""), Path(f".spool/{a.session}.jsonl"))
        threading.Thread(target=emitter.run_forever, daemon=True).start()
        send = emitter.enqueue
    else:
        out = Path(a.out)

        def send(ev: dict) -> None:
            with out.open("a") as f:
                f.write(json.dumps(ev) + "\n")

    frames_q: queue.Queue[np.ndarray] = queue.Queue()
    segs_q: queue.Queue[Segment] = queue.Queue()

    def on_audio(indata, _frames, _time, status):
        if status:
            print(status)
        frames_q.put(indata.copy())

    def asr_worker():
        seq = 0
        while True:
            seg = segs_q.get()
            audio = np.concatenate(seg.frames).astype(np.float32)
            mel = get_logmel(mx.array(audio), model.preprocessor_config)
            result = model.generate(mel)[0]
            words = words_from_tokens(result.tokens, seg.start_ms)
            if not words:
                continue
            ch = next(c for c, k in keys.items() if k == seg.key)
            ev = utterance_event(a.session, seq, seg, words, ch)
            seq += 1
            send(ev)
            u = ev["payload"]["utterance"]
            print(f"{u['startMs'] / 1000:7.1f}s {seg.key} ({u['attribution']['confidence']:.2f}): {u['text']}")

    threading.Thread(target=asr_worker, daemon=True).start()
    seg = Segmenter(keys)
    t_ms = 0
    buf = np.zeros((0, n_in), dtype=np.float32)
    with sd.InputStream(device=a.device, channels=n_in, samplerate=SAMPLE_RATE, blocksize=FRAME, dtype="float32", callback=on_audio):
        print("listening · Ctrl-C to stop")
        try:
            while True:
                buf = np.concatenate([buf, frames_q.get()])
                while len(buf) >= FRAME:
                    frame, buf = buf[:FRAME], buf[FRAME:]
                    per = {c: frame[:, int(c) - 1] for c in keys}
                    for s in seg.push(t_ms, per):
                        segs_q.put(s)
                    t_ms += FRAME_MS
        except KeyboardInterrupt:
            for s in seg.flush():
                segs_q.put(s)
            time.sleep(3)


if __name__ == "__main__":  # pragma: no cover
    main()
