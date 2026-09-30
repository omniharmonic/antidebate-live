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


def test_unmiked_moderator_has_no_track_and_lands_on_every_debater_mic():
    from adl_capture.scenarios import make_unmiked

    sr = 16000
    mix = np.ones(sr * 3, dtype=np.float32)
    turns = [(0, 1000, "A"), (1000, 2000, "B"), (2000, 3000, "MOD")]
    t = make_unmiked(mix, sr, turns, debaters=["A", "B"], moderators=["MOD"], bleed_db=-9.0, moderator_db=-3.0)
    assert sorted(t) == ["A", "B"]
    mod = 10 ** (-3 / 20)
    for k in ("A", "B"):
        assert np.isclose(t[k][2 * sr :].max(), mod, atol=1e-4) and np.isclose(t[k][2 * sr :].min(), mod, atol=1e-4)
    assert t["A"][:sr].min() == 1.0
    assert np.isclose(t["A"][sr : 2 * sr].max(), 10 ** (-9 / 20), atol=1e-4)


def test_bleed_levels_cover_the_realistic_range():
    from adl_capture.scenarios import BLEED_LEVELS

    assert BLEED_LEVELS == {"bleed": -15.0, "bleed-6": -6.0, "bleed-9": -9.0}
