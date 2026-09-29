from adl_capture.fusion import Signals, fuse, needs_operator
from adl_capture.merge import Turn, Word, merge


def test_merge_assigns_words_by_overlap_and_splits_on_speaker_change():
    words = [Word("Audits", 0, 400), Word("are", 450, 600), Word("fine.", 650, 900), Word("Licensing", 1000, 1500), Word("isn't.", 1550, 1900)]
    turns = [Turn("SPEAKER_01", 0, 950), Turn("SPEAKER_02", 960, 2000)]
    out = merge(words, turns)
    assert [u["speaker"] for u in out] == ["SPEAKER_01", "SPEAKER_02"]
    assert out[0]["text"] == "Audits are fine."
    assert out[1]["startMs"] == 1000


def test_fusion_confident_single_owner():
    assert not needs_operator(fuse(Signals(14.0, 0.82, True, False)))


def test_fusion_overlap_goes_to_operator():
    assert needs_operator(fuse(Signals(2.0, 0.55, None, True)))


def test_merge_splits_long_monologues_at_sentence_ends():
    from adl_capture.merge import Turn, Word, merge
    words = [Word(f"w{i}." if i % 5 == 4 else f"w{i}", i * 1000, i * 1000 + 800) for i in range(60)]
    utts = merge(words, [Turn("S1", 0, 61_000)], max_ms=20_000)
    assert len(utts) > 1
    assert all(u["text"].endswith(".") for u in utts[:-1])
    assert all(u["endMs"] - u["startMs"] <= 25_000 for u in utts)
