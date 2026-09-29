import numpy as np
from adl_capture.scenarios import make_tracks, reference_turns


def test_reference_turns_maps_labels_and_marks_audience_unknown():
    u = {"utterances": [{"speaker": "S1", "startMs": 0, "endMs": 1000}, {"speaker": "S9", "startMs": 1000, "endMs": 2000}]}
    assert reference_turns(u, {"S1": "B"}) == [(0, 1000, "B"), (1000, 2000, "UNK")]


def test_tracks_mask_other_speakers_and_bleed_adds_them_quietly():
    sr = 16000
    mix = np.ones(sr * 2, dtype=np.float32)
    turns = [(0, 1000, "A"), (1000, 2000, "B")]
    t = make_tracks(mix, sr, turns, ["A", "B"], bleed_db=None)
    assert t["A"][:sr].min() == 1.0 and np.abs(t["A"][sr:]).max() == 0.0
    b = make_tracks(mix, sr, turns, ["A", "B"], bleed_db=-15.0)
    assert np.isclose(b["A"][sr:].max(), 10 ** (-15 / 20), atol=1e-4)
