"""Real-time audio router for two TeamSpeak clients using four independent virtual cables.

Does not speak TeamSpeak's wire protocol; the two official TS3 clients do that.
Audio frames and controller are decoupled for repeatable offline tests.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import queue
import threading
import time
from typing import Callable

import numpy as np

RATE = 48_000
BLOCK = 960                 # 20 ms
FRAME_SECS = BLOCK / RATE


def rms(frame: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(frame.astype(np.float64)))))


def beep(frequency: float = 880, duration_ms: int = 180, level: float = .28) -> np.ndarray:
    count = int(RATE * duration_ms / 1000)
    t = np.arange(count, dtype=np.float64) / RATE
    wav = (level * np.sin(2 * np.pi * frequency * t)).astype(np.float32)
    # Prevent clicks at both ends.
    fade = min(int(.008 * RATE), count // 2)
    if fade:
        wav[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
        wav[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    return wav


def pad_frames(wav: np.ndarray) -> deque[np.ndarray]:
    if not len(wav):
        return deque()
    padding = (-len(wav)) % BLOCK
    if padding:
        wav = np.pad(wav, (0, padding))
    return deque(wav.reshape(-1, BLOCK).astype(np.float32, copy=False).copy())


@dataclass
class RouterOptions:
    threshold: float = .025       # RMS amplitude (0 ... 1)
    hang_ms: int = 450
    tx_limit_seconds: int = 180
    courtesy: bool = True
    courtesy_hz: int = 880
    courtesy_ms: int = 180
    level: float = .9


class Router:
    """Half-duplex priority lock: no route reversal until current talker unkeys.

    A's RECEIVE audio goes to B's TRANSMIT audio, and vice versa.
    Scheduled speech/tone is inserted only after the bridge becomes idle.
    """

    def __init__(self, options: RouterOptions, events: Callable[[str], None] | None = None):
        self.options = options
        self.events = events or (lambda _: None)
        self.route: str | None = None
        self.last_voice: float = 0.0
        self.start_voice: float = 0.0
        self.blocked: str | None = None
        self.blocked_last_voice: float = 0.0
        self.out_a: deque[np.ndarray] = deque()
        self.out_b: deque[np.ndarray] = deque()
        self.announcement: queue.Queue[tuple[np.ndarray, str]] = queue.Queue(maxsize=12)
        self.last_rms_a = 0.0
        self.last_rms_b = 0.0

    def emit(self, message: str) -> None:
        self.events(message)

    def enqueue_announcement(self, samples: np.ndarray, name: str) -> bool:
        try:
            self.announcement.put_nowait((np.asarray(samples, dtype=np.float32).reshape(-1), name))
            return True
        except queue.Full:
            self.emit('Wachtrij voor meldingen is vol; aankondiging overgeslagen')
            return False

    def test_tone(self, destination: str) -> bool:
        samples = beep(750, 550, .32)
        return self.enqueue_announcement_to(samples, destination)

    def enqueue_announcement_to(self, samples: np.ndarray, destination: str) -> bool:
        try:
            self.announcement.put_nowait((np.asarray(samples, dtype=np.float32).reshape(-1), 'TEST:' + destination))
            return True
        except queue.Full:
            return False

    def queue_courtesy(self, destination: str) -> None:
        if not self.options.courtesy:
            return
        wav = np.concatenate((np.zeros(int(RATE * .09), dtype=np.float32),
                              beep(self.options.courtesy_hz, self.options.courtesy_ms)))
        if destination == 'A':
            self.out_a.extend(pad_frames(wav))
        else:
            self.out_b.extend(pad_frames(wav))

    def process(self, from_a: np.ndarray, from_b: np.ndarray, now: float) -> tuple[np.ndarray, np.ndarray]:
        assert from_a.shape == (BLOCK,) and from_b.shape == (BLOCK,)
        ra, rb = rms(from_a), rms(from_b)
        self.last_rms_a, self.last_rms_b = ra, rb
        gate_a, gate_b = ra >= self.options.threshold, rb >= self.options.threshold
        hang = max(0, self.options.hang_ms) / 1000.0

        # After a transmission timeout, require that speaker to go silent before rearming.
        if self.blocked == 'A2B':
            if gate_a:
                self.blocked_last_voice = now
            elif now - self.blocked_last_voice >= hang:
                self.blocked = None
                self.emit('Server A: opnieuw vrij na TX-timeout')
        elif self.blocked == 'B2A':
            if gate_b:
                self.blocked_last_voice = now
            elif now - self.blocked_last_voice >= hang:
                self.blocked = None
                self.emit('Server B: opnieuw vrij na TX-timeout')

        if self.route == 'A2B':
            if gate_a:
                self.last_voice = now
            if self.options.tx_limit_seconds > 0 and now - self.start_voice >= self.options.tx_limit_seconds:
                self.route = None
                self.blocked = 'A2B'
                self.blocked_last_voice = now
                self.emit('TX-timeout A → B: verzending geblokkeerd tot stilte')
            elif now - self.last_voice >= hang:
                self.route = None
                self.queue_courtesy('B')
                self.emit('RX A beëindigd · afvalpiep naar B')
        elif self.route == 'B2A':
            if gate_b:
                self.last_voice = now
            if self.options.tx_limit_seconds > 0 and now - self.start_voice >= self.options.tx_limit_seconds:
                self.route = None
                self.blocked = 'B2A'
                self.blocked_last_voice = now
                self.emit('TX-timeout B → A: verzending geblokkeerd tot stilte')
            elif now - self.last_voice >= hang:
                self.route = None
                self.queue_courtesy('A')
                self.emit('RX B beëindigd · afvalpiep naar A')

        if self.route is None and self.blocked is None:
            if gate_a or gate_b:
                if gate_a and (not gate_b or ra >= rb):
                    self.route = 'A2B'
                    self.emit('RX server A → TX server B')
                else:
                    self.route = 'B2A'
                    self.emit('RX server B → TX server A')
                self.start_voice = now
                self.last_voice = now

        a_out = np.zeros(BLOCK, dtype=np.float32)
        b_out = np.zeros(BLOCK, dtype=np.float32)
        if self.route == 'A2B':
            b_out = from_a * self.options.level
        elif self.route == 'B2A':
            a_out = from_b * self.options.level

        # A queued system announcement starts only after an active talker releases.
        if self.route is None and not self.out_a and not self.out_b:
            try:
                samples, name = self.announcement.get_nowait()
                frames = pad_frames(samples * .75)
                if name == 'TEST:A':
                    self.out_a.extend(frames)
                elif name == 'TEST:B':
                    self.out_b.extend(frames)
                else:
                    self.out_a.extend(frames)
                    self.out_b.extend(pad_frames(samples * .75))
                self.emit('Aankondiging gestart: ' + name)
            except queue.Empty:
                pass

        # Never send deferred tones on top of a talker in the same destination.
        if self.route is None:
            if self.out_a:
                a_out = np.clip(a_out + self.out_a.popleft(), -1, 1)
            if self.out_b:
                b_out = np.clip(b_out + self.out_b.popleft(), -1, 1)
        return a_out, b_out


class AudioBridge:
    def __init__(self, opts: RouterOptions, devices: dict[str, int], event: Callable[[str], None]):
        self.opts, self.devices, self.event = opts, devices, event
        self.router = Router(opts, event)
        self.stop_signal = threading.Event()
        self.thread: threading.Thread | None = None
        self.inputs = {k: queue.Queue(maxsize=6) for k in ('a_rx', 'b_rx')}
        self.outputs = {k: queue.Queue(maxsize=6) for k in ('a_tx', 'b_tx')}
        self.running = False

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.stop_signal.clear()
        self.thread = threading.Thread(target=self._run, name='HeerlenAudioBridge', daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_signal.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=3)

    @staticmethod
    def _put_latest(q: queue.Queue, item: np.ndarray) -> None:
        try:
            q.put_nowait(item)
        except queue.Full:
            try:
                q.get_nowait()
            except queue.Empty:
                pass
            try:
                q.put_nowait(item)
            except queue.Full:
                pass

    def _input(self, label: str):
        def callback(indata, frames, t, status):
            if frames == BLOCK:
                self._put_latest(self.inputs[label], indata[:, 0].copy())
        return callback

    def _output(self, label: str):
        def callback(outdata, frames, t, status):
            try:
                data = self.outputs[label].get_nowait()
                outdata[:, 0] = data
            except queue.Empty:
                outdata.fill(0)
        return callback

    def _run(self) -> None:
        try:
            import sounddevice as sd
            with sd.InputStream(device=self.devices['a_rx'], samplerate=RATE, blocksize=BLOCK,
                                channels=1, dtype='float32', callback=self._input('a_rx')) as ia, \
                 sd.InputStream(device=self.devices['b_rx'], samplerate=RATE, blocksize=BLOCK,
                                channels=1, dtype='float32', callback=self._input('b_rx')) as ib, \
                 sd.OutputStream(device=self.devices['a_tx'], samplerate=RATE, blocksize=BLOCK,
                                 channels=1, dtype='float32', callback=self._output('a_tx')) as oa, \
                 sd.OutputStream(device=self.devices['b_tx'], samplerate=RATE, blocksize=BLOCK,
                                 channels=1, dtype='float32', callback=self._output('b_tx')) as ob:
                self.running = True
                self.event('Audiobrug gestart op 48 kHz · 20 ms blokken')
                tick = time.perf_counter()
                silence = np.zeros(BLOCK, dtype=np.float32)
                while not self.stop_signal.is_set():
                    try:
                        a = self.inputs['a_rx'].get_nowait()
                    except queue.Empty:
                        a = silence
                    try:
                        b = self.inputs['b_rx'].get_nowait()
                    except queue.Empty:
                        b = silence
                    out_a, out_b = self.router.process(a, b, time.monotonic())
                    self._put_latest(self.outputs['a_tx'], out_a)
                    self._put_latest(self.outputs['b_tx'], out_b)
                    tick += FRAME_SECS
                    delay = tick - time.perf_counter()
                    if delay > 0:
                        self.stop_signal.wait(delay)
                    else:
                        tick = time.perf_counter()
        except Exception as exc:
            self.event('FOUT audiobesturing: ' + str(exc))
        finally:
            self.running = False
            self.event('Audiobrug gestopt')
