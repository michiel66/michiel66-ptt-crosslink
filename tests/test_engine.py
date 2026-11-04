import pathlib
import sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import numpy as np
from engine import Router, RouterOptions, BLOCK, beep, pad_frames

silence = np.zeros(BLOCK, dtype=np.float32)
signal = np.full(BLOCK, 0.20, dtype=np.float32)


def test_a_to_b_and_back():
    r = Router(RouterOptions(threshold=.02, hang_ms=40, courtesy=False))
    a, b = r.process(signal, silence, 1.0)
    assert not np.any(a) and np.any(b)
    assert r.route == 'A2B'
    # server B cannot take over while A speaks
    a, b = r.process(signal, signal, 1.02)
    assert not np.any(a) and np.any(b)
    r.process(silence, silence, 1.10)
    a, b = r.process(silence, signal, 1.12)
    assert np.any(a) and not np.any(b)
    assert r.route == 'B2A'


def test_timeout_rearms_only_after_silence():
    r = Router(RouterOptions(threshold=.02, hang_ms=40, tx_limit_seconds=1, courtesy=False))
    r.process(signal, silence, 0)
    a, b = r.process(signal, silence, 1.1)
    assert r.blocked == 'A2B' and r.route is None
    assert not np.any(a) and not np.any(b)
    r.process(signal, silence, 1.2)
    assert r.blocked == 'A2B'
    r.process(silence, silence, 1.27)
    assert r.blocked is None
    assert r.route is None
    r.process(signal, silence, 1.29)
    assert r.route == 'A2B'


def test_courtesy_tone_is_sent_to_receiver_only():
    r = Router(RouterOptions(threshold=.02, hang_ms=40, courtesy=True))
    r.process(signal, silence, 0)
    a, b = r.process(silence, silence, .08)
    assert r.route is None and not np.any(a)
    found_beep = np.any(b)
    for t in np.arange(.10, .4, .02):
        a, b = r.process(silence, silence, t)
        assert not np.any(a)
        found_beep |= np.any(b)
    assert found_beep


def test_system_announcement_goes_to_both_sides():
    r = Router(RouterOptions(threshold=.02))
    r.enqueue_announcement(beep(1000, 150), 'Identificatie')
    a, b = r.process(silence, silence, 1.0)
    assert np.any(a) and np.any(b)


def test_test_tone_only_selected_destination():
    r = Router(RouterOptions(threshold=.02))
    assert r.test_tone('A')
    a, b = r.process(silence, silence, 0)
    assert np.any(a) and not np.any(b)


def test_wave_frame_padding():
    frames = pad_frames(beep(duration_ms=127))
    assert all(x.shape == (BLOCK,) for x in frames)
