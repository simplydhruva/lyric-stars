// Listens to what the PC is playing (Windows system audio, through the desktop app) and feeds a BeatTracker.
// The audio never leaves this page: only a loudness-change number per 10 ms is kept, no sound is stored or sent.
import { BeatTracker } from './beat.js';

const FFT = 1024;
const LOW_HZ = 40;
const HIGH_HZ = 5000; // drums and bass live here; most of the "something started" energy too
const QUIET_RMS = 0.002; // below this the PC is playing nothing (or only the app's own silence)

// One onset strength from two consecutive spectra: how much louder each band got (half-wave), relative to how loud it
// has been lately, so a quiet song and a loud one both give numbers around 0..3. Exported for tests.
export function onsetStrength(prev, cur, avg) {
  let flux = 0;
  for (let i = 0; i < cur.length; i++) {
    const d = cur[i] - prev[i];
    if (d > 0) flux += d;
  }
  const level = avg.value;
  avg.value = level ? level * 0.97 + flux * 0.03 : flux;
  return level > 1e-9 ? flux / (level * 2) : 0;
}

export function supported() {
  return Boolean(navigator.mediaDevices?.getDisplayMedia && (window.AudioContext || window.webkitAudioContext));
}

export class AudioBeat {
  constructor() {
    this.tracker = new BeatTracker();
    this.state = 'off'; // off | starting | listening | failed
    this.error = '';
    this.silent = true;
    this._timer = null;
  }

  // Asks the desktop app for the system audio. Needs a click or key press that just happened.
  async start() {
    if (this.state === 'starting' || this.state === 'listening') return true;
    this.state = 'starting';
    this.error = '';
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      // Only the sound is wanted; drop the picture of the screen straight away.
      stream.getVideoTracks().forEach((t) => {
        t.stop();
        stream.removeTrack(t);
      });
      if (!stream.getAudioTracks().length) throw new Error('no audio track');
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const source = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT;
      this.analyser.smoothingTimeConstant = 0;
      source.connect(this.analyser); // not connected to the speakers: this must stay silent
      this.stream = stream;
      const hz = this.ctx.sampleRate / FFT;
      this.lo = Math.max(1, Math.floor(LOW_HZ / hz));
      this.hi = Math.min(this.analyser.frequencyBinCount - 1, Math.ceil(HIGH_HZ / hz));
      this.spec = new Float32Array(this.analyser.frequencyBinCount);
      this.time = new Float32Array(FFT);
      this.prev = new Float32Array(this.hi - this.lo + 1);
      this.cur = new Float32Array(this.hi - this.lo + 1);
      this.avg = { value: 0 };
      this.tracker.reset();
      this._timer = setInterval(() => this._tick(), 10);
      stream.getAudioTracks()[0].addEventListener('ended', () => this.stop());
      this.state = 'listening';
      return true;
    } catch (e) {
      this.state = 'failed';
      this.error = String(e?.message || e);
      this._release();
      return false;
    }
  }

  _tick() {
    const a = this.analyser;
    if (!a) return;
    const now = performance.now();
    a.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
    this.rms = Math.sqrt(sum / this.time.length);
    this.silent = this.rms < QUIET_RMS;
    if (this.silent) return this.tracker.push(now, 0);
    a.getFloatFrequencyData(this.spec);
    for (let i = this.lo; i <= this.hi; i++) this.cur[i - this.lo] = Math.pow(10, this.spec[i] / 20); // dB to amplitude
    this.tracker.push(now, onsetStrength(this.prev, this.cur, this.avg));
    this.prev.set(this.cur);
  }

  // 0..1 for the frame being drawn.
  pulse(now = performance.now()) {
    return this.state === 'listening' && !this.silent ? this.tracker.pulse(now) : 0;
  }

  get bpm() {
    return this.state === 'listening' ? this.tracker.bpm : 0;
  }

  _release() {
    clearInterval(this._timer);
    this._timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }

  stop() {
    this._release();
    this.tracker.reset();
    this.state = 'off';
  }
}
