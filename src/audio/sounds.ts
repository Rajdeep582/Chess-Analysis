/**
 * Original board sounds, synthesized once per session into AudioBuffers (no audio files, no third-party samples).
 *
 * Each "piece on board" sound is modal synthesis of a felted wooden piece landing on a wooden board:
 *  - a very short bright contact transient (the felt/wood click),
 *  - a handful of damped resonant modes (the board body), lower modes ringing longest,
 *  - a short low thump (the table underneath).
 * Buffers are rendered up front so playback is sample-accurate and latency-free; a tiny room reverb,
 * slight per-play pitch/level variation and a limiter keep fast stepping natural and never harsh.
 */
export type SoundKind = 'move' | 'capture' | 'castle' | 'check' | 'mate' | 'promote' | 'back';

interface Impact {
  at: number; // seconds offset
  gain: number;
  pitch: number; // mode frequency multiplier
  bright: number; // contact click level
  thump: number; // low thump level
  decay?: number; // decay-time multiplier
}

/** Board/piece resonances: inharmonic, short-lived, higher modes dying fastest (wood, not a bell). */
const MODES: [freq: number, tau: number, amp: number][] = [
  [165, 0.024, 1],
  [342, 0.02, 0.9],
  [561, 0.016, 0.8],
  [793, 0.013, 0.7],
  [1084, 0.011, 0.6],
  [1423, 0.009, 0.5],
  [1838, 0.007, 0.42],
  [2357, 0.0055, 0.34],
  [3049, 0.0042, 0.26],
  [3912, 0.0032, 0.18],
  [5104, 0.0024, 0.12],
];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let wet: ConvolverNode | null = null;
const cache = new Map<SoundKind, AudioBuffer>();

/** Deterministic pseudo-random so every session renders identical sounds. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function renderImpacts(sr: number, impacts: Impact[], tail = 0.25, extra?: (d: Float32Array, sr: number) => void): Float32Array {
  const end = Math.max(...impacts.map((i) => i.at)) + tail;
  const n = Math.ceil(end * sr);
  const d = new Float32Array(n);
  const rand = rng(42);
  for (const im of impacts) {
    const o = Math.floor(im.at * sr);
    const dm = im.decay ?? 1;
    const len = Math.min(n - o, Math.ceil(tail * sr));
    // Excitation: an impulse plus a ~1.2 ms noise burst — the felt-and-wood contact.
    const exc = new Float32Array(len);
    exc[0] = 1;
    for (let i = 1; i < len; i++) exc[i] = (rand() * 2 - 1) * Math.exp(-i / (0.0012 * sr)) * 0.9;
    // Noise-excited two-pole resonators give each hit a natural, slightly irregular woody colour.
    const body = new Float32Array(len);
    for (const [f, tau, amp] of MODES) {
      const w = (2 * Math.PI * f * im.pitch) / sr;
      const r = Math.exp(-1 / (tau * dm * sr));
      const c1 = 2 * r * Math.cos(w);
      const c2 = -r * r;
      const g = amp * (1 - r) * 2.2;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < len; i++) {
        const y = g * exc[i] + c1 * y1 + c2 * y2;
        y2 = y1;
        y1 = y;
        body[i] += y;
      }
    }
    // Bright contact click (high-passed noise, ~1.4 ms) and a short low thump from the table.
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const nz = rand() * 2 - 1;
      hp = 0.55 * (hp + nz - prev);
      prev = nz;
      const click = hp * Math.exp(-t / 0.0014) * im.bright * 0.5;
      const tf = 92 * im.pitch * (1 - 0.3 * Math.min(1, t / 0.03));
      const thump = Math.sin(2 * Math.PI * tf * t) * Math.exp(-t / 0.018) * im.thump * 0.35;
      d[o + i] += im.gain * (body[i] + click + thump);
    }
  }
  extra?.(d, sr);
  // Gentle one-pole low-pass for warmth (≈ 7 kHz), then a 6 ms fade at the very end.
  const a = Math.exp((-2 * Math.PI * 7000) / sr);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = (1 - a) * d[i] + a * y;
    d[i] = y;
  }
  const fade = Math.floor(0.006 * sr);
  for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  return d;
}

/** Soft bell partials (used sparingly on check / promotion / mate). */
function addBell(d: Float32Array, sr: number, at: number, f: number, dur: number, gain: number, glideTo?: number) {
  const o = Math.floor(at * sr);
  const len = Math.min(d.length - o, Math.floor(dur * sr));
  const partials: [number, number][] = [
    [1, 1],
    [2.01, 0.28],
    [2.76, 0.16],
  ];
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.006) * Math.exp(-t / (dur * 0.32));
    const ff = glideTo ? f * Math.pow(glideTo / f, Math.min(1, t / (dur * 0.35))) : f;
    let s = 0;
    for (const [m, a] of partials) s += a * Math.sin(2 * Math.PI * ff * m * t);
    d[o + i] += gain * env * s;
  }
}

function normalize(d: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (const v of d) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

const MOVE: Impact = { at: 0, gain: 1, pitch: 1, bright: 0.55, thump: 0.5 };

/** Renders one sound to raw samples (also used by tests). */
export function renderSound(kind: SoundKind, sr: number): Float32Array {
  switch (kind) {
    case 'move':
      return normalize(renderImpacts(sr, [MOVE]), 0.62);
    case 'back':
      return normalize(renderImpacts(sr, [{ ...MOVE, pitch: 0.96, bright: 0.4 }]), 0.48);
    case 'capture':
      // A brighter, harder knock followed by the captured piece's lighter clack.
      return normalize(
        renderImpacts(sr, [
          { at: 0, gain: 1, pitch: 1.18, bright: 1.15, thump: 0.62, decay: 0.85 },
          { at: 0.021, gain: 0.5, pitch: 1.52, bright: 0.9, thump: 0.1, decay: 0.6 },
        ]),
        0.8,
      );
    case 'castle':
      return normalize(
        renderImpacts(sr, [
          { ...MOVE, gain: 1 },
          { ...MOVE, at: 0.125, gain: 0.82, pitch: 0.93 },
        ]),
        0.64,
      );
    case 'check':
      return normalize(renderImpacts(sr, [{ ...MOVE, bright: 0.7 }], 0.55, (d, r) => addBell(d, r, 0.012, 1318, 0.36, 0.05)), 0.66);
    case 'promote':
      return normalize(renderImpacts(sr, [MOVE], 0.6, (d, r) => addBell(d, r, 0.03, 784, 0.55, 0.07, 1175)), 0.64);
    case 'mate':
      return normalize(
        renderImpacts(sr, [{ ...MOVE, bright: 0.9, thump: 0.7 }], 1.2, (d, r) => {
          addBell(d, r, 0.03, 523.25, 1.1, 0.07);
          addBell(d, r, 0.03, 659.25, 1.1, 0.05);
          addBell(d, r, 0.03, 261.63, 1.2, 0.06);
        }),
        0.7,
      );
  }
}

function roomImpulse(c: AudioContext): AudioBuffer {
  const len = Math.floor(c.sampleRate * 0.38);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const r = rng(7 + ch);
    const d = b.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / c.sampleRate;
      lp = 0.55 * lp + 0.45 * (r() * 2 - 1);
      d[i] = lp * Math.exp(-t / 0.075) * (t < 0.004 ? 0 : 1);
    }
  }
  return b;
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor({ latencyHint: 'interactive' });
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    limiter.connect(ctx.destination);
    master = ctx.createGain();
    master.connect(limiter);
    wet = ctx.createConvolver();
    wet.buffer = roomImpulse(ctx);
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.16;
    wet.connect(wetGain).connect(limiter);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function buffer(c: AudioContext, kind: SoundKind): AudioBuffer {
  let b = cache.get(kind);
  if (!b) {
    const data = renderSound(kind, c.sampleRate);
    b = c.createBuffer(1, data.length, c.sampleRate);
    b.getChannelData(0).set(data);
    cache.set(kind, b);
  }
  return b;
}

/** Unlocks audio on the first user gesture and pre-renders the common sounds so the first move is instant. */
export function warmUpSounds(): void {
  if (typeof window === 'undefined') return;
  const go = () => {
    const c = audio();
    if (!c) return;
    for (const k of ['move', 'capture', 'back', 'castle', 'check'] as SoundKind[]) buffer(c, k);
  };
  window.addEventListener('pointerdown', go, { once: true, capture: true });
  window.addEventListener('keydown', go, { once: true, capture: true });
}

/**
 * Plays a board sound. `delay` (seconds) lets the sound land with the piece at the end of its slide.
 */
export function playSound(kind: SoundKind, volume = 0.7, delay = 0): void {
  if (volume <= 0) return;
  const c = audio();
  if (!c || !master || !wet) return;
  const src = c.createBufferSource();
  src.buffer = buffer(c, kind);
  // ±2.5 % pitch and ±1 dB level so repeated moves never sound machine-gunned.
  src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.05;
  const g = c.createGain();
  g.gain.value = Math.min(1, volume) * (1 + (Math.random() - 0.5) * 0.24);
  src.connect(g);
  g.connect(master);
  g.connect(wet);
  src.start(c.currentTime + Math.max(0, delay));
}

/** Picks the sound for a move from its SAN and capture flag. */
export function soundForMove(san: string, captured?: boolean): SoundKind {
  if (san.includes('#')) return 'mate';
  if (san.includes('+')) return 'check';
  if (san.includes('=')) return 'promote';
  if (san.startsWith('O-O')) return 'castle';
  if (captured || san.includes('x')) return 'capture';
  return 'move';
}
