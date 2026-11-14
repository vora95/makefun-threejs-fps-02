// Every sound in the game is synthesised with WebAudio — no audio files, no network.
// One shared noise buffer, short envelopes, and a tiny helper per effect. The context
// is created lazily on the first user gesture (browsers block audio before that) and
// every call is a no-op until then.
let ctx = null;
let noiseBuffer = null;
let master = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const length = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  } catch {
    return false;
  }
}

function noise({ duration, type = 'lowpass', freq = 1200, gain = 0.5, at = 0, q = 1, sweepTo = null }) {
  if (!ctx || !noiseBuffer) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t);
  if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
  filter.Q.value = q;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter);
  filter.connect(amp);
  amp.connect(master);
  src.start(t);
  src.stop(t + duration + 0.05);
}

function tone({ freq = 440, to = null, duration = 0.1, type = 'sine', gain = 0.3, at = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(amp);
  amp.connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

// distance in metres softens and dulls a shot; a shot next to the player is a crack,
// one across the map is a dull thump.
export function playShot(kind, distance = 0) {
  if (!ctx) return;
  const near = Math.max(0, 1 - distance / 42);
  const vol = 0.18 + 0.5 * near;
  if (kind === 'sniper') {
    noise({ duration: 0.32, freq: 900 + 1400 * near, gain: vol, sweepTo: 140 });
    tone({ freq: 160, to: 55, duration: 0.22, type: 'sine', gain: vol * 0.9 });
  } else if (kind === 'smg') {
    noise({ duration: 0.09, freq: 2400, gain: vol * 0.8, sweepTo: 500 });
    tone({ freq: 220, to: 90, duration: 0.07, type: 'triangle', gain: vol * 0.5 });
  } else if (kind === 'pistol') {
    noise({ duration: 0.12, freq: 1800, gain: vol * 0.9, sweepTo: 300 });
  } else {
    noise({ duration: 0.14, freq: 1600, gain: vol, sweepTo: 220 });
    tone({ freq: 180, to: 70, duration: 0.1, type: 'triangle', gain: vol * 0.6 });
  }
}

export function playDryFire() {
  tone({ freq: 1400, duration: 0.03, type: 'square', gain: 0.12 });
}

export function playReload() {
  tone({ freq: 900, duration: 0.04, type: 'square', gain: 0.1, at: 0 });
  tone({ freq: 600, duration: 0.04, type: 'square', gain: 0.1, at: 0.28 });
  tone({ freq: 1100, duration: 0.05, type: 'square', gain: 0.12, at: 0.62 });
}

export function playHit(kill) {
  tone({ freq: kill ? 1560 : 1180, duration: 0.06, type: 'square', gain: 0.16 });
  if (kill) tone({ freq: 2090, duration: 0.09, type: 'square', gain: 0.14, at: 0.06 });
}

export function playHurt() {
  noise({ duration: 0.16, freq: 500, gain: 0.3, sweepTo: 120 });
  tone({ freq: 110, to: 70, duration: 0.16, type: 'sawtooth', gain: 0.16 });
}

export function playStep(running) {
  noise({ duration: 0.05, freq: 420, gain: running ? 0.1 : 0.05, sweepTo: 180 });
}

export function playPlantBeep(final) {
  tone({ freq: final ? 1900 : 1250, duration: 0.07, type: 'square', gain: 0.14 });
}

export function playDefuseTick() {
  tone({ freq: 980, duration: 0.05, type: 'square', gain: 0.1 });
}

export function playExplosion() {
  noise({ duration: 1.4, freq: 900, gain: 0.9, sweepTo: 60 });
  tone({ freq: 90, to: 28, duration: 1.1, type: 'sine', gain: 0.8 });
  noise({ duration: 0.5, freq: 3000, gain: 0.25, sweepTo: 800, at: 0.02 });
}

export function playGrenadePin() {
  tone({ freq: 1900, duration: 0.03, type: 'square', gain: 0.1 });
}

export function playSmokePop() {
  noise({ duration: 0.5, freq: 700, gain: 0.3, sweepTo: 200 });
}

export function playBuy() {
  tone({ freq: 660, duration: 0.06, type: 'triangle', gain: 0.18 });
  tone({ freq: 990, duration: 0.09, type: 'triangle', gain: 0.18, at: 0.07 });
}

export function playRoundEnd(won) {
  const notes = won ? [523, 659, 784] : [392, 330, 262];
  notes.forEach((freq, i) => tone({ freq, duration: 0.22, type: 'triangle', gain: 0.2, at: i * 0.13 }));
}

export function playUiClick() {
  tone({ freq: 800, duration: 0.04, type: 'square', gain: 0.08 });
}
