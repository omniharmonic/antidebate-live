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
