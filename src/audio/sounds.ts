/**
 * Original synthesized board sounds (Web Audio, no audio files):
 * move = soft wooden tap, capture = sharper double tap, castle = two taps,
 * check = two-note chime, checkmate = short descending cadence, promotion = rising glide.
 */
export type SoundKind = 'move' | 'capture' | 'castle' | 'check' | 'mate' | 'promote' | 'back';

let ctx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function noise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(c.sampleRate * 0.12);
  noiseBuffer = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  return noiseBuffer;
}

function tap(c: AudioContext, out: AudioNode, t: number, gain: number, freq: number, body: number) {
  // Click: band-passed noise burst.
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 1.4;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.1);
  // Body: short low sine thump.
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(body, t);
  o.frequency.exponentialRampToValueAtTime(body * 0.6, t + 0.08);
  const og = c.createGain();
  og.gain.setValueAtTime(gain * 0.55, t);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(og).connect(out);
  o.start(t);
  o.stop(t + 0.1);
}

function tone(c: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'triangle', toFreq?: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function playSound(kind: SoundKind, volume = 0.7): void {
  if (volume <= 0) return;
  const c = audio();
  if (!c) return;
  const out = c.createGain();
  out.gain.value = Math.min(1, volume);
  out.connect(c.destination);
  const t = c.currentTime + 0.005;
  switch (kind) {
    case 'move':
      tap(c, out, t, 0.9, 1700, 190);
      break;
    case 'back':
      tap(c, out, t, 0.45, 1500, 170);
      break;
    case 'capture':
      tap(c, out, t, 1.1, 2300, 210);
      tap(c, out, t + 0.035, 0.7, 1100, 150);
      break;
    case 'castle':
      tap(c, out, t, 0.85, 1700, 190);
      tap(c, out, t + 0.11, 0.85, 1500, 175);
      break;
    case 'promote':
      tap(c, out, t, 0.8, 1700, 190);
      tone(c, out, t + 0.04, 523, 0.22, 0.16, 'triangle', 1046);
      break;
    case 'check':
      tap(c, out, t, 0.8, 1800, 190);
      tone(c, out, t + 0.03, 880, 0.12, 0.16);
      tone(c, out, t + 0.13, 1318, 0.2, 0.14);
      break;
    case 'mate':
      tap(c, out, t, 1, 1900, 200);
      tone(c, out, t + 0.04, 784, 0.18, 0.15);
      tone(c, out, t + 0.2, 659, 0.18, 0.15);
      tone(c, out, t + 0.36, 523, 0.5, 0.17);
      tone(c, out, t + 0.36, 262, 0.6, 0.12, 'sine');
      break;
  }
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
