// A procedural darkwave loop built entirely from Web Audio oscillators and noise: no audio files.
// 108 BPM, A minor, Am - G - F - E. Eight bars; the lead melody joins for the second four.

const BPM = 108;
const STEP = 60 / BPM / 4; // one 16th note, in seconds
const STEPS_PER_BAR = 16;
const BARS = 8;
const AHEAD = 0.25; // how far in advance (seconds) notes are scheduled
const MASTER_VOL = 0.6;

// Chord per bar (repeats every 4 bars). `chord` is MIDI note numbers. The E has a G# so it's major.
const PROGRESSION = [
  { root: 45, chord: [57, 60, 64] }, // Am
  { root: 43, chord: [55, 59, 62] }, // G
  { root: 41, chord: [53, 57, 60] }, // F
  { root: 40, chord: [52, 56, 59] }, // E
];

// Lead melody for bars 5-8, per chord: [step in bar, MIDI note, length in steps].
const LEAD = [
  [[0, 76, 4], [4, 72, 2], [6, 74, 2], [8, 76, 8]],
  [[0, 74, 4], [4, 71, 2], [6, 72, 2], [8, 74, 8]],
  [[0, 72, 4], [4, 69, 4], [8, 67, 4], [12, 69, 4]],
  [[0, 71, 4], [4, 68, 2], [6, 69, 2], [8, 71, 8]],
];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

let ctx = null;
let master = null;
let dryBus = null;
let reverbIn = null;
let delayIn = null;
let noiseBuf = null;
let timer = null;
let nextTime = 0;
let step = 0;
let muted = false;

// ---------- Audio graph ----------
function makeImpulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function buildGraph() {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = MASTER_VOL;
  compressor.connect(master);
  master.connect(ctx.destination);

  dryBus = ctx.createGain();
  dryBus.connect(compressor);

  // Reverb: a generated noise tail.
  reverbIn = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(2.6, 2.5);
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = 0.55;
  reverbIn.connect(convolver);
  convolver.connect(reverbOut);
  reverbOut.connect(compressor);

  // Echo: a dotted 8th (3 sixteenths), with a darkening low-pass in the feedback loop.
  delayIn = ctx.createGain();
  const delay = ctx.createDelay(2);
  delay.delayTime.value = STEP * 3;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2200;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.38;
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.7;
  delayIn.connect(delay);
  delay.connect(tone);
  tone.connect(feedback);
  feedback.connect(delay);
  tone.connect(delayOut);
  delayOut.connect(compressor);
  delayOut.connect(reverbIn);

  // One second of white noise, reused by the drums.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

// Sends a voice to the dry mix, and optionally to the reverb and echo.
function route(node, { rev = 0, delay = 0 } = {}) {
  node.connect(dryBus);
  if (rev > 0) {
    const g = ctx.createGain();
    g.gain.value = rev;
    node.connect(g);
    g.connect(reverbIn);
  }
  if (delay > 0) {
    const g = ctx.createGain();
    g.gain.value = delay;
    node.connect(g);
    g.connect(delayIn);
  }
}

function noise(t, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur);
  return src;
}

// A gain node that jumps in and decays away (percussive envelope).
function pluckGain(t, peak, dur) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

// ---------- Instruments ----------
function kick(t) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = pluckGain(t, 1.0, 0.4);
  osc.connect(g);
  route(g);
  osc.start(t);
  osc.stop(t + 0.45);
}

function snare(t) {
  const n = noise(t, 0.3);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1900;
  const g = pluckGain(t, 0.45, 0.28);
  n.connect(bp);
  bp.connect(g);
  route(g, { rev: 0.7 }); // lots of reverb: the 80s gated-snare sound

  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(220, t);
  body.frequency.exponentialRampToValueAtTime(120, t + 0.1);
  const bg = pluckGain(t, 0.35, 0.15);
  body.connect(bg);
  route(bg);
  body.start(t);
  body.stop(t + 0.2);
}

function hat(t, open) {
  const dur = open ? 0.22 : 0.05;
  const n = noise(t, dur + 0.02);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7500;
  const g = pluckGain(t, open ? 0.14 : 0.1, dur);
  n.connect(hp);
  hp.connect(g);
  route(g, { rev: 0.15 });
}

function bass(t, midi, dur) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 4;
  lp.frequency.setValueAtTime(1100, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.18); // filter "pluck"
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
  g.gain.setValueAtTime(0.32, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(lp);
  lp.connect(g);
  route(g);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Slow-swelling chord of detuned saws; each bar's pad overlaps the next.
function pad(t, midis, dur) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1300;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.045, t + 0.6);
  g.gain.setValueAtTime(0.045, t + dur - 0.2);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.5);
  lp.connect(g);
  route(g, { rev: 0.5 });
  for (const m of midis) {
    for (const cents of [-8, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = mtof(m);
      osc.detune.value = cents;
      osc.connect(lp);
      osc.start(t);
      osc.stop(t + dur + 0.55);
    }
  }
}

function arp(t, midi, dur) {
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const g = pluckGain(t, 0.06, dur);
  osc.connect(lp);
  lp.connect(g);
  route(g, { rev: 0.3, delay: 0.55 });
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function lead(t, midi, dur) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = mtof(midi);
  // Gentle vibrato.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 9; // cents
  lfo.connect(lfoDepth);
  lfoDepth.connect(osc.detune);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.09, t + 0.03);
  g.gain.setValueAtTime(0.09, t + dur * 0.8);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.12);
  osc.connect(lp);
  lp.connect(g);
  route(g, { rev: 0.6, delay: 0.5 });
  osc.start(t);
  lfo.start(t);
  osc.stop(t + dur + 0.15);
  lfo.stop(t + dur + 0.15);
}

// ---------- Sequencer ----------
function playStep(n, t) {
  const bar = Math.floor(n / STEPS_PER_BAR);
  const s = n % STEPS_PER_BAR;
  const { root, chord } = PROGRESSION[bar % 4];

  if (s === 0) pad(t, chord, STEP * STEPS_PER_BAR);

  // Drums: kick on 1 and 3 (plus a push before beat 4 every other bar), snare on 2 and 4.
  if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1)) kick(t);
  if (s === 4 || s === 12) snare(t);
  if (bar >= 1) {
    if (s === 14) hat(t, true);
    else if (s % 2 === 0) hat(t, false);
  }

  // Bass on the 8ths, jumping an octave on the last one. The arp fills the gaps between.
  if (s % 2 === 0) bass(t, root + (s === 14 ? 12 : 0), STEP * 1.8);
  if (s % 2 === 1) arp(t, chord[[0, 1, 2, 1][((s - 1) / 2) % 4]] + 12, STEP * 1.5);

  if (bar >= 4) {
    for (const [ls, midi, len] of LEAD[bar % 4]) {
      if (ls === s) lead(t, midi, len * STEP);
    }
  }
}

// Looks a little ahead and schedules any notes that fall inside the window.
function schedule() {
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05; // fell behind: resync
  while (nextTime < ctx.currentTime + AHEAD) {
    playStep(step, nextTime);
    nextTime += STEP;
    step = (step + 1) % (STEPS_PER_BAR * BARS);
  }
}

// ---------- Public API ----------
// Browsers only allow audio after a user gesture, so call this from a key press or click.
export function startMusic() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  ctx = new AudioContext();
  buildGraph();
  nextTime = ctx.currentTime + 0.1;
  timer = setInterval(schedule, 25);

  // Pause with the tab so the music and the game stay together.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ctx.suspend();
    else ctx.resume();
  });
}

// Returns true if the music is now muted (false if unmuted or never started).
export function toggleMute() {
  if (!ctx) return false;
  muted = !muted;
  master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, ctx.currentTime, 0.05);
  return muted;
}
