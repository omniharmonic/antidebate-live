import numpy as np

from adl_capture.gate import assign_owner, rms_dbfs


def test_rms_dbfs_full_scale_sine_is_about_minus_3():
    t = np.linspace(0, 1, 16000, endpoint=False)
    assert abs(rms_dbfs(np.sin(2 * np.pi * 220 * t).astype(np.float32)) + 3.01) < 0.05


def test_single_owner_with_bleed():
    o = assign_owner({"ch1": -18.0, "ch2": -31.0})
    assert o.kind == "single" and o.owners == ("ch1",)


def test_overlap_when_within_margin():
    o = assign_owner({"ch1": -18.0, "ch2": -21.0, "ch3": -60.0})
    assert o.kind == "overlap" and set(o.owners) == {"ch1", "ch2"}


def test_silence():
    assert assign_owner({"ch1": -70.0}).kind == "silence"
