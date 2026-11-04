"""Use the offline Windows SAPI voice; rendered WAV can be forwarded through TS3 mic."""
from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import wave

import numpy as np

from engine import RATE


def text_to_pcm(text: str) -> np.ndarray:
    if not text.strip():
        raise ValueError('Tekst is leeg')
    script = Path(__file__).with_name('tts_windows.ps1')
    with tempfile.TemporaryDirectory(prefix='heerlen_tts_') as temp:
        wavfile = Path(temp, 'announcement.wav')
        proc = subprocess.run(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
             '-File', str(script), '-Message', text, '-OutputFile', str(wavfile)],
            capture_output=True, text=True, timeout=35, check=False,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        )
        if proc.returncode != 0 or not wavfile.exists():
            raise RuntimeError((proc.stderr or proc.stdout or 'Geen spraakbestand').strip()[-500:])
        with wave.open(str(wavfile), 'rb') as w:
            src_rate, channels, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
            if width != 2:
                raise ValueError('Windows TTS gaf geen 16-bit WAV')
            pcm = np.frombuffer(w.readframes(n), dtype='<i2').astype(np.float32).reshape(-1, channels)
            signal = pcm.mean(axis=1) / 32768.0
    if len(signal) == 0:
        raise ValueError('Lege TTS-opname')
    dest_count = int(round(len(signal) * RATE / src_rate))
    resampled = np.interp(
        np.arange(dest_count, dtype=np.float64) * src_rate / RATE,
        np.arange(len(signal), dtype=np.float64),
        signal
    ).astype(np.float32)
    return np.concatenate((np.zeros(int(.16 * RATE), dtype=np.float32),
                           resampled,
                           np.zeros(int(.3 * RATE), dtype=np.float32)))
