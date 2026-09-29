import numpy as np

from adl_capture.live import FRAME, FRAME_MS, Segmenter, utterance_event, words_from_tokens


def tone(db: float) -> np.ndarray:
    amp = 10 ** (db / 20) * np.sqrt(2)
    return (amp * np.sin(np.linspace(0, 60, FRAME))).astype(np.float32)


SILENT = np.zeros(FRAME, dtype=np.float32)


def run(frames):
    s, out, t = Segmenter({"1": "A", "2": "B"}), [], 0
    for f in frames:
        out += s.push(t, f)
        t += FRAME_MS
    return out + s.flush()


def test_owner_channel_gets_the_segment_and_bleed_is_ignored():
    # A speaks loud on ch1; ch2 picks it up 15 dB quieter (bleed); then silence
    frames = [{"1": tone(-20), "2": tone(-35)}] * 40 + [{"1": SILENT, "2": SILENT}] * 30
    segs = run(frames)
    assert [s.key for s in segs] == ["A"]
    assert segs[0].overlapped == 0


def test_turn_taking_produces_two_segments():
    frames = [{"1": tone(-20), "2": SILENT}] * 30 + [{"1": SILENT, "2": SILENT}] * 30 + [{"1": SILENT, "2": tone(-22)}] * 30 + [{"1": SILENT, "2": SILENT}] * 30
    assert [s.key for s in run(frames)] == ["A", "B"]


def test_crosstalk_lowers_confidence():
    frames = [{"1": tone(-20), "2": tone(-22)}] * 30 + [{"1": SILENT, "2": SILENT}] * 30
    segs = run(frames)
    ev = utterance_event("s", 0, segs[0], [{"text": "hi", "startMs": 0, "endMs": 100, "confidence": 1}], "1")
    assert ev["payload"]["utterance"]["attribution"]["confidence"] < 0.85


class Tok:
    def __init__(self, text, start, dur, conf=0.9):
        self.text, self.start, self.end, self.confidence = text, start, start + dur, conf


def test_subword_tokens_join_into_words():
    words = words_from_tokens([Tok(" Aud", 0.0, 0.2), Tok("its", 0.2, 0.1), Tok(" are", 0.35, 0.1), Tok(" fine.", 0.5, 0.2)], 1000)
    assert [w["text"] for w in words] == ["Audits", "are", "fine."]
    assert words[0]["startMs"] == 1000 and words[0]["endMs"] == 1300
