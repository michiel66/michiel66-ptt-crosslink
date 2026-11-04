'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const SAMPLE_RATE = 48000;
const FRAME = 960;

function tone(hz = 880, ms = 170, amplitude = 0.24) {
  const count = Math.ceil(ms * SAMPLE_RATE / 1000);
  const samples = new Float32Array(count);
  const edge = Math.min(400, count >> 1);
  for (let i = 0; i < count; i++) {
    const fade = edge ? Math.min(1, i / edge, (count - i - 1) / edge) : 1;
    samples[i] = Math.sin(2 * Math.PI * hz * i / SAMPLE_RATE) * amplitude * fade;
  }
  return samples;
}

function gap(ms = 80) { return new Float32Array(Math.round(ms * SAMPLE_RATE / 1000)); }
function join(...arrays) {
  const out = new Float32Array(arrays.reduce((s, a) => s + a.length, 0));
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function wavToPCM48(wav) {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Windows-spraak leverde geen geldig WAV-bestand');
  }
  let offset = 12, fmt = null, pcm = null;
  while (offset + 8 <= wav.length) {
    const name = wav.toString('ascii', offset, offset + 4);
    const length = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > wav.length) throw new Error('Beschadigd WAV-bestand');
    if (name === 'fmt ') fmt = wav.subarray(start, start + length);
    if (name === 'data') pcm = wav.subarray(start, start + length);
    offset = start + length + (length % 2);
  }
  if (!fmt || !pcm || fmt.length < 16) throw new Error('Onvolledig WAV-bestand');
  const format = fmt.readUInt16LE(0), channels = fmt.readUInt16LE(2);
  const rate = fmt.readUInt32LE(4), depth = fmt.readUInt16LE(14);
  if (format !== 1 || depth !== 16 || channels < 1 || channels > 2 || rate < 8000 || rate > 96000) {
    throw new Error('Verwacht PCM 16-bit mono/stereo');
  }
  const count = Math.floor(pcm.length / (channels * 2));
  const native = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let v = 0;
    for (let c = 0; c < channels; c++) v += pcm.readInt16LE((i * channels + c) * 2) / 32768;
    native[i] = v / channels;
  }
  const out = new Float32Array(Math.ceil(count * SAMPLE_RATE / rate));
  for (let i = 0; i < out.length; i++) {
    const at = Math.min(count - 1, i * rate / SAMPLE_RATE);
    const lo = Math.floor(at), hi = Math.min(lo + 1, count - 1);
    out[i] = native[lo] * (1 - (at - lo)) + native[hi] * (at - lo);
  }
  return out;
}

async function textToSamples(text) {
  if (process.platform !== 'win32') throw new Error('TTS werkt alleen op Windows');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptt-crosslink-'));
  const target = path.join(temp, 'spraak.wav');
  const script = path.join(__dirname, '..', 'tts_windows.ps1');
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-Message', text, '-OutputFile', target],
    { windowsHide: true, timeout: 40000, maxBuffer: 1024 * 1024 });
    return join(gap(160), wavToPCM48(fs.readFileSync(target)), gap(240));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function createEncoder() {
  const OpusScript = require('opusscript');
  const encoder = new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.VOIP);
  encoder.setBitrate?.(20000);
  return {
    encode(samples) {
      const packets = [];
      for (let p = 0; p < samples.length; p += FRAME) {
        const pcm = Buffer.alloc(FRAME * 2);
        for (let i = 0; i < FRAME; i++) {
          const sample = Math.max(-1, Math.min(1, samples[p + i] || 0));
          pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample * 32767))), i * 2);
        }
        packets.push(encoder.encode(pcm, FRAME));
      }
      return packets;
    },
    close() { encoder.delete(); }
  };
}

module.exports = { SAMPLE_RATE, FRAME, tone, gap, join, wavToPCM48, textToSamples, createEncoder };
