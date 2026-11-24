// Effetti sonori sintetizzati con WebAudio (nessun file audio): calcio, rimbalzo, fischio, folla.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let noiseBuf: AudioBuffer | null = null;

try {
  muted = localStorage.getItem('sc-muted') === '1';
} catch {
  /* storage non disponibile */
}

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Va chiamata su un gesto dell'utente (tocco, tasto) per sbloccare l'audio. */
export function unlockAudio(): void {
  ensure();
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem('sc-muted', muted ? '1' : '0');
  } catch {
    /* ignora */
  }
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
  const c = ensure();
  if (!c || !master || muted) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, filterFreq: number, q = 1, attack = 0.005): void {
  const c = ensure();
  if (!c || !master || !noiseBuf || muted) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = filterFreq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  kick(power: number) {
    const k = Math.min(1, power / 28);
    tone(140 - k * 40, 0.12, 'sine', 0.5 + k * 0.4, 50);
    noise(0.06, 0.25 + k * 0.3, 1800, 0.8);
  },
  pass() {
    tone(180, 0.08, 'sine', 0.35, 90);
    noise(0.04, 0.15, 2200);
  },
  bounce(power: number) {
    tone(110, 0.07, 'sine', Math.min(0.35, power / 25), 70);
  },
  wall(power: number) {
    noise(0.18, Math.min(0.4, power / 40), 900, 3);
    tone(320, 0.1, 'square', Math.min(0.08, power / 300), 260);
  },
  post() {
    tone(880, 0.5, 'triangle', 0.25, 860);
    tone(1320, 0.35, 'sine', 0.12);
  },
  tackle() {
    noise(0.12, 0.35, 500, 0.7);
    tone(90, 0.1, 'sine', 0.3, 60);
  },
  whoosh() {
    noise(0.22, 0.2, 1200, 0.6, 0.06);
  },
  save() {
    noise(0.15, 0.35, 700, 0.8);
    tone(200, 0.12, 'sine', 0.3, 120);
  },
  whistle(long = false) {
    const c = ensure();
    if (!c || !master || muted) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const lfo = c.createOscillator();
    const lg = c.createGain();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = 2600;
    lfo.frequency.value = 28;
    lg.gain.value = 120;
    lfo.connect(lg).connect(o.frequency);
    const dur = long ? 0.9 : 0.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  },
  crowd() {
    noise(2.4, 0.35, 650, 0.4, 0.25);
    noise(2.0, 0.2, 1400, 0.5, 0.3);
  },
  /** Un difensore sta per entrare: breve "tic" acuto, da sentire senza guardare. */
  warn() {
    tone(1250, 0.05, 'square', 0.07, 1500);
  },
  ui() {
    tone(660, 0.06, 'square', 0.08, 880);
  },
};
