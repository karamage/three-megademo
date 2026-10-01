import { BAR, END_TIME, kickAt, STEP, TOTAL_BARS } from "../timeline";

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Deterministic per-step random so a seek always replays the same notes. */
function rand(i: number, salt = 0): number {
  let x = (i * 374761393 + salt * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- harmony
type Chord = { notes: number[]; bass: number };
const C = {
  Dmaj9: { notes: [50, 57, 61, 64, 66], bass: 38 },
  Bm9: { notes: [47, 54, 57, 61, 62], bass: 35 },
  Gmaj9: { notes: [43, 50, 54, 57, 59], bass: 31 },
  Asus: { notes: [45, 52, 57, 59, 64], bass: 33 },
  DF: { notes: [42, 50, 57, 61, 64], bass: 30 },
  Em9: { notes: [40, 47, 50, 54, 55], bass: 28 },
  Cmaj7: { notes: [36, 43, 47, 50, 54], bass: 24 },
  Fsus: { notes: [42, 49, 54, 59, 61], bass: 30 },
  G711: { notes: [43, 50, 54, 57, 61], bass: 31 },
  A: { notes: [45, 52, 57, 61, 64], bass: 33 },
} satisfies Record<string, Chord>;

const SECTIONS: { from: number; to: number; prog: Chord[] }[] = [
  { from: 0, to: 8, prog: [C.Dmaj9, C.Dmaj9, C.Bm9, C.Gmaj9] },
  { from: 8, to: 20, prog: [C.Dmaj9, C.Bm9, C.Gmaj9, C.Asus] },
  { from: 20, to: 32, prog: [C.Gmaj9, C.Asus, C.Bm9, C.DF] },
  { from: 32, to: 40, prog: [C.Em9, C.Cmaj7, C.Em9, C.Fsus] },
  { from: 40, to: 44, prog: [C.G711, C.A] },
  { from: 44, to: 52, prog: [C.Dmaj9, C.Asus, C.Bm9, C.Gmaj9] },
  { from: 52, to: 57, prog: [C.Gmaj9, C.Dmaj9, C.Dmaj9] },
];

function chordAt(b: number): Chord {
  const sec = SECTIONS.find((s) => b >= s.from && b < s.to) ?? SECTIONS[SECTIONS.length - 1];
  const idx = Math.floor((b - sec.from) / 2) % sec.prog.length;
  return sec.prog[idx];
}

// ---------------------------------------------------------------- engine
export class Music {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private master: GainNode;
  private session: GainNode;
  private sessRev: GainNode;
  private sessDel: GainNode;
  private dry: GainNode;
  private padBus: GainNode;
  private reverbIn: GainNode;
  private delayIn: GainNode;
  private noise: AudioBuffer;
  private startAt = 0;
  private nextStep = 0;
  private timer = 0;
  private playing = false;
  private muted = false;
  private pausedAt = 0;
  private freq: Uint8Array<ArrayBuffer>;
  level = { low: 0, mid: 0, high: 0 };

  constructor() {
    const ctx = new AudioContext({ latencyHint: "playback" });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.75;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    comp.connect(limiter).connect(this.master).connect(ctx.destination);
    this.master.connect(this.analyser);

    // shared FX
    this.noise = this.makeNoise(4);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(5.5, 2.6);
    this.reverbIn = ctx.createGain();
    const revOut = ctx.createGain();
    revOut.gain.value = 0.85;
    this.reverbIn.connect(reverb).connect(revOut).connect(comp);

    this.delayIn = ctx.createGain();
    const dl = ctx.createDelay(2);
    const dr = ctx.createDelay(2);
    dl.delayTime.value = STEP * 3;
    dr.delayTime.value = STEP * 6;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3200;
    const merger = ctx.createChannelMerger(2);
    this.delayIn.connect(dl);
    dl.connect(lp).connect(fb).connect(dr);
    dr.connect(dl);
    dl.connect(merger, 0, 0);
    dr.connect(merger, 0, 1);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.5;
    merger.connect(delayOut);
    delayOut.connect(comp);
    delayOut.connect(this.reverbIn);

    this.session = ctx.createGain();
    this.sessRev = ctx.createGain();
    this.sessDel = ctx.createGain();
    this.dry = ctx.createGain();
    this.padBus = ctx.createGain();
    this.dry.connect(comp);
    this.wireSession();
  }

  private wireSession() {
    this.session = this.ctx.createGain();
    this.session.connect(this.dry);
    this.sessRev = this.ctx.createGain();
    this.sessRev.connect(this.reverbIn);
    this.sessDel = this.ctx.createGain();
    this.sessDel.connect(this.delayIn);
    this.padBus = this.ctx.createGain();
    this.padBus.connect(this.session);
  }

  private makeNoise(seconds: number): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        lp += (n - lp) * (0.9 - t * 0.75);
        const pre = Math.min(1, i / (sr * 0.02));
        d[i] = lp * (1 - t) ** decay * pre;
      }
    }
    return buf;
  }

  // ------------------------------------------------ transport
  get time(): number {
    if (!this.playing) return this.pausedAt;
    return this.ctx.currentTime - this.startAt;
  }
  get isPlaying() {
    return this.playing;
  }

  async play(from = 0) {
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.seek(from);
  }

  seek(t: number) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // fade out and release everything scheduled on the old session
    for (const old of [this.session, this.sessRev, this.sessDel]) {
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + 0.12);
      setTimeout(() => old.disconnect(), 400);
    }
    this.wireSession();

    const tt = Math.max(0, Math.min(t, END_TIME));
    this.startAt = now + 0.06 - tt;
    this.nextStep = Math.ceil(tt / STEP - 1e-6);
    this.playing = true;
    // re-voice the current chord so a seek never lands in silence
    const b = tt / BAR;
    if (b < TOTAL_BARS)
      this.pad(
        chordAt(Math.floor(b)),
        now + 0.06,
        Math.max(1.5, (2 - (b % 2)) * BAR),
        this.padLevel(b) * 0.8,
        0.4,
      );
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.time;
    this.playing = false;
    window.clearInterval(this.timer);
    void this.ctx.suspend();
  }

  async resume() {
    if (this.playing) return;
    await this.ctx.resume();
    this.seek(this.pausedAt);
  }

  setMuted(m: boolean) {
    this.muted = m;
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(m ? 0 : 0.9, now + 0.3);
  }
  get isMuted() {
    return this.muted;
  }

  /** An interactive chime, always consonant with the current chord. */
  chime(pan: number) {
    if (!this.playing) return;
    const ch = chordAt(Math.floor(this.time / BAR));
    const tones = ch.notes.slice(1);
    const n = tones[Math.floor(Math.random() * tones.length)] + 24;
    const when = this.ctx.currentTime + 0.005;
    this.bell(n, when, 0.75, pan * 0.8);
    this.bell(n + 7, when + STEP, 0.35, -pan * 0.6);
  }

  /** Smoothed band energies for visuals. */
  sample() {
    this.analyser.getByteFrequencyData(this.freq);
    const band = (a: number, b: number) => {
      let s = 0;
      for (let i = a; i < b; i++) s += this.freq[i];
      return s / ((b - a) * 255);
    };
    const l = band(1, 6);
    const m = band(6, 60);
    const h = band(60, 220);
    this.level.low += (l - this.level.low) * 0.3;
    this.level.mid += (m - this.level.mid) * 0.3;
    this.level.high += (h - this.level.high) * 0.3;
    return this.level;
  }

  private schedule() {
    if (!this.playing) return;
    // background tabs throttle timers to ~1 s, so schedule further ahead there
    const horizon = this.ctx.currentTime + (document.hidden ? 1.6 : 0.3);
    const total = TOTAL_BARS * 16;
    while (this.nextStep < total && this.startAt + this.nextStep * STEP < horizon) {
      const when = Math.max(this.ctx.currentTime, this.startAt + this.nextStep * STEP);
      this.step(this.nextStep, when);
      this.nextStep++;
    }
  }

  // ------------------------------------------------ arrangement
  private padLevel(b: number): number {
    if (b < 1) return 0.45;
    if (b < 8) return 0.75;
    if (b < 20) return 0.72;
    if (b < 32) return 0.6;
    if (b < 40) return 0.5;
    if (b < 44) return 0.75;
    if (b < 52) return 0.65;
    return 0.6 * Math.max(0, 1 - (b - 54) / 2);
  }

  private step(i: number, when: number) {
    const b = Math.floor(i / 16);
    const s = i % 16;
    const ch = chordAt(b);
    const chordStart = s === 0 && b % 2 === 0;

    // pads
    if (chordStart && b < 56) this.pad(ch, when, BAR * 2 + 0.6, this.padLevel(b), b < 2 ? 2.5 : 0.9);

    // singing bowls on section downbeats
    if (s === 0 && [0, 8, 20, 32, 52].includes(b)) this.bowl(b === 32 ? 57 : 62, when, 0.5);
    if (s === 0 && b === 40) this.bowl(50, when, 0.9);
    if (s === 0 && b === 44) this.bowl(62, when, 0.7);

    // space shimmer + drone
    if (s === 0 && (b < 9 || b >= 50) && b % 2 === 0) this.shimmer(ch, when, BAR * 2.2, b < 9 ? 0.5 : 0.4);
    if (s === 0 && b < 8 && b % 4 === 0) this.drone(26, when, BAR * 4.3, 0.35);

    // ocean
    if (s === 0 && b >= 7 && b < 54) this.wave(when, b);

    // bells / arps
    this.bells(i, b, s, ch, when);

    // bass
    if (b >= 12 && b < 32 && s === 0) this.sub(ch.bass, when, BAR * 0.98, b < 20 ? 0.45 : 0.55);
    if (b >= 24 && b < 32 && s % 4 === 2) this.pluckBass(ch.bass + 12, when, 0.18);
    if (b >= 32 && b < 40 && s === 0) this.sub(ch.bass, when, BAR, 0.4);
    if (b >= 40 && b < 50 && s % 2 === 0)
      this.pluckBass(ch.bass + (s % 8 === 6 ? 19 : 12), when, s % 4 === 0 ? 0.1 : 0.22);
    if (b >= 40 && b < 50 && s === 0) this.sub(ch.bass, when, BAR, 0.5);

    // drums
    const kv = kickAt(b, s);
    if (kv > 0) {
      this.kick(when, kv);
      this.duck(when, kv);
    }
    if (b >= 22 && b < 36 && s % 2 === 1) this.hat(when, 0.05 + rand(i, 3) * 0.04, 0.03);
    if (b >= 40 && b < 48) {
      if (s % 4 === 2) this.hat(when, 0.14, 0.06);
      else if (s % 2 === 1) this.hat(when, 0.05, 0.025);
      if (s === 4 || s === 12) this.clap(when, 0.35);
    }
    if (b >= 28 && b < 36 && (s === 4 || s === 12)) this.clap(when, 0.18);

    // choir
    if (chordStart && b >= 38 && b < 52) this.choir(ch, when, BAR * 2 + 0.5, b < 40 ? 0.12 : 0.22);

    // build & impact
    if (b === 36 && s === 0) this.riser(when, BAR * 4);
    if (b === 39 && s === 0) this.reverseSwell(when, BAR);
    if (b === 40 && s === 0) this.impact(when, 1);
    if (b === 43 && s === 8) this.reverseSwell(when, BAR / 2);
    if (b === 44 && s === 0) this.impact(when, 0.6);
    if (b === 20 && s === 0) this.impact(when, 0.3);
  }

  private bells(i: number, b: number, s: number, ch: Chord, when: number) {
    let prob = 0;
    let every = 2;
    if (b >= 3 && b < 8) prob = 0.22;
    else if (b >= 10 && b < 20) prob = b < 14 ? 0.4 : 0.55;
    else if (b >= 20 && b < 32) {
      prob = 0.6;
      every = b >= 26 ? 1 : 2;
    } else if (b >= 32 && b < 40) prob = 0.25;
    else if (b >= 40 && b < 44) {
      prob = 0.85;
      every = 1;
    } else if (b >= 44 && b < 52) {
      prob = 0.55;
      every = b < 48 ? 1 : 2;
    } else if (b >= 52 && b < 55) prob = 0.2;
    if (s % every !== 0 || rand(i, 1) > prob) return;
    const tones = ch.notes.slice(1).map((n) => n + 12);
    const arpIdx = (i * 3 + Math.floor(rand(b, 2) * 4)) % (tones.length * 2);
    const oct = arpIdx >= tones.length ? 12 : 0;
    const note = tones[arpIdx % tones.length] + oct + (b >= 40 && b < 44 ? 12 : 0);
    const vel = (s % 4 === 0 ? 1 : 0.7) * (0.6 + rand(i, 5) * 0.4);
    this.bell(note, when, vel * (b < 8 ? 0.35 : 0.3), rand(i, 9) * 1.6 - 0.8);
  }

  // ------------------------------------------------ instruments
  private env(g: AudioParam, when: number, a: number, peak: number, hold: number, rel: number) {
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(peak, when + a);
    g.setValueAtTime(peak, when + Math.max(a, hold));
    g.exponentialRampToValueAtTime(0.0001, when + Math.max(a, hold) + rel);
  }

  private out(node: AudioNode, dry: number, rev: number, delay = 0, pan = 0) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    const send = (amount: number, dest: AudioNode) => {
      const g = this.ctx.createGain();
      g.gain.value = amount;
      p.connect(g).connect(dest);
    };
    if (dry > 0) send(dry, this.session);
    if (rev > 0) send(rev, this.sessRev);
    if (delay > 0) send(delay, this.sessDel);
  }

  private pad(ch: Chord, when: number, dur: number, level: number, attack: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 0.6;
    f.frequency.setValueAtTime(500, when);
    f.frequency.linearRampToValueAtTime(1900, when + dur * 0.45);
    f.frequency.linearRampToValueAtTime(900, when + dur);
    this.env(g.gain, when, attack, level * 0.06, dur - 1.2, 2.8);
    f.connect(g);
    const stop = when + dur + 3;
    for (const n of ch.notes) {
      for (const det of [-9, 0, 8]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = mtof(n);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        o.connect(f);
        o.start(when);
        o.stop(stop);
      }
    }
    const tri = ctx.createOscillator();
    tri.type = "triangle";
    tri.frequency.value = mtof(ch.notes[0] - 12);
    const tg = ctx.createGain();
    tg.gain.value = 1.4;
    tri.connect(tg).connect(f);
    tri.start(when);
    tri.stop(stop);
    const p = ctx.createStereoPanner();
    g.connect(p);
    p.connect(this.padBus);
    const rs = ctx.createGain();
    rs.gain.value = 0.7;
    p.connect(rs).connect(this.sessRev);
  }

  private choir(ch: Chord, when: number, dur: number, level: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g.gain, when, 1.6, level * 0.05, dur - 1.5, 2.5);
    const formants = [
      [700, 6, 1],
      [1150, 8, 0.5],
      [2700, 10, 0.25],
    ];
    const sum = ctx.createGain();
    for (const [fq, q, a] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = fq;
      bp.Q.value = q;
      const ag = ctx.createGain();
      ag.gain.value = a * 3;
      sum.connect(bp).connect(ag).connect(g);
    }
    const stop = when + dur + 3;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.value = 9;
    vib.connect(vg);
    vib.start(when);
    vib.stop(stop);
    for (const n of ch.notes.slice(1)) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = mtof(n + 12);
        o.detune.value = det;
        vg.connect(o.detune);
        o.connect(sum);
        o.start(when);
        o.stop(stop);
      }
    }
    this.out(g, 0.6, 1.0);
  }

  private bell(note: number, when: number, vel: number, pan: number) {
    const ctx = this.ctx;
    const f = mtof(note);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 1.8, when);
    mg.gain.exponentialRampToValueAtTime(f * 0.05, when + 1.2);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel * 0.16, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 3.2);
    const sh = ctx.createOscillator();
    sh.frequency.value = f * 2;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(vel * 0.03, when);
    sg.gain.exponentialRampToValueAtTime(0.0001, when + 1.5);
    sh.connect(sg);
    car.connect(g);
    const sum = ctx.createGain();
    g.connect(sum);
    sg.connect(sum);
    for (const o of [car, mod, sh]) {
      o.start(when);
      o.stop(when + 3.4);
    }
    this.out(sum, 0.7, 0.55, 0.45, pan);
  }

  private bowl(note: number, when: number, vel: number) {
    const ctx = this.ctx;
    const f = mtof(note);
    const sum = ctx.createGain();
    const partials = [
      [1, 1, 9],
      [2.71, 0.5, 7],
      [5.18, 0.28, 5],
      [8.47, 0.14, 3.5],
      [12.1, 0.06, 2],
    ];
    for (const [r, a, d] of partials) {
      for (const beat of [-0.6, 0.7]) {
        const o = ctx.createOscillator();
        o.frequency.value = f * r + beat * r;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(a * vel * 0.09, when + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, when + d);
        o.connect(g).connect(sum);
        o.start(when);
        o.stop(when + d + 0.1);
      }
    }
    this.out(sum, 0.8, 0.8, 0.15);
  }

  private shimmer(ch: Chord, when: number, dur: number, level: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g.gain, when, dur * 0.4, level * 0.02, dur * 0.6, 2.5);
    for (const n of ch.notes.slice(2)) {
      for (const oct of [24, 36]) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = mtof(n + oct);
        const t = ctx.createGain();
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.2 + Math.random() * 1.2;
        const lg = ctx.createGain();
        lg.gain.value = 0.5;
        t.gain.value = 0.5;
        lfo.connect(lg).connect(t.gain);
        o.connect(t).connect(g);
        o.start(when);
        lfo.start(when);
        o.stop(when + dur + 3);
        lfo.stop(when + dur + 3);
      }
    }
    this.out(g, 0.5, 1.2, 0.3);
  }

  private drone(note: number, when: number, dur: number, level: number) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g.gain, when, 3, level * 0.12, dur - 3, 3);
    for (const [n, a] of [
      [note, 1],
      [note + 7, 0.5],
      [note + 12, 0.35],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = mtof(n);
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start(when);
      o.stop(when + dur + 3.5);
    }
    this.out(g, 0.8, 0.4);
  }

  private wave(when: number, b: number) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    const dur = BAR * 1.6;
    const peak = 300 + rand(b, 11) * 900;
    lp.frequency.setValueAtTime(200, when);
    lp.frequency.exponentialRampToValueAtTime(peak + 600, when + dur * 0.45);
    lp.frequency.exponentialRampToValueAtTime(250, when + dur);
    const g = ctx.createGain();
    const loud = b < 9 ? 0.4 : b >= 32 && b < 44 ? 0.35 : 1;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.05 * loud, when + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(lp).connect(g);
    src.start(when, rand(b, 12) * 3);
    src.stop(when + dur + 0.1);
    this.out(g, 1, 0.25, 0, rand(b, 13) * 1.2 - 0.6);
  }

  private sub(note: number, when: number, dur: number, level: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = mtof(note);
    const g = ctx.createGain();
    this.env(g.gain, when, 0.08, level * 0.32, dur - 0.3, 0.4);
    o.connect(g);
    o.start(when);
    o.stop(when + dur + 0.6);
    g.connect(this.session);
  }

  private pluckBass(note: number, when: number, level: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = mtof(note);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 4;
    f.frequency.setValueAtTime(1800, when);
    f.frequency.exponentialRampToValueAtTime(140, when + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(level * 0.35, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.35);
    o.connect(f).connect(g);
    o.start(when);
    o.stop(when + 0.4);
    this.out(g, 1, 0.05, 0.1);
  }

  private kick(when: number, vel: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(130, when);
    o.frequency.exponentialRampToValueAtTime(43, when + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel * 0.9, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.55);
    o.connect(g).connect(this.session);
    o.start(when);
    o.stop(when + 0.6);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 3500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.08, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 0.02);
    n.connect(hp).connect(ng).connect(this.session);
    n.start(when, Math.random());
    n.stop(when + 0.03);
  }

  private duck(when: number, amount: number) {
    const g = this.padBus.gain;
    g.setValueAtTime(1, when);
    g.linearRampToValueAtTime(1 - 0.55 * amount, when + 0.02);
    g.linearRampToValueAtTime(1, when + STEP * 3.5);
  }

  private hat(when: number, vel: number, dur: number) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.5, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    n.connect(hp).connect(g);
    n.start(when, Math.random() * 3);
    n.stop(when + dur + 0.02);
    this.out(g, 0.8, 0.1, 0.12, Math.random() * 0.6 - 0.3);
  }

  private clap(when: number, vel: number) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1600;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    for (const o of [0, 0.011, 0.022]) {
      g.gain.setValueAtTime(vel * 0.5, when + o);
      g.gain.exponentialRampToValueAtTime(vel * 0.08, when + o + 0.009);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.25);
    n.connect(bp).connect(g);
    n.start(when, Math.random() * 3);
    n.stop(when + 0.3);
    this.out(g, 0.7, 0.6);
  }

  private riser(when: number, dur: number) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(250, when);
    bp.frequency.exponentialRampToValueAtTime(7000, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.16, when + dur - 0.02);
    g.gain.linearRampToValueAtTime(0, when + dur);
    n.connect(bp).connect(g);
    n.start(when);
    n.stop(when + dur + 0.05);
    this.out(g, 0.7, 0.5, 0.2);
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(mtof(50), when);
    o.frequency.exponentialRampToValueAtTime(mtof(86), when + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, when);
    og.gain.exponentialRampToValueAtTime(0.04, when + dur - 0.02);
    og.gain.linearRampToValueAtTime(0, when + dur);
    o.connect(og);
    o.start(when);
    o.stop(when + dur + 0.05);
    this.out(og, 0.6, 0.6, 0.3);
  }

  private reverseSwell(when: number, dur: number) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(400, when);
    lp.frequency.exponentialRampToValueAtTime(9000, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.12, when + dur - 0.01);
    g.gain.linearRampToValueAtTime(0, when + dur);
    n.connect(lp).connect(g);
    n.start(when);
    n.stop(when + dur + 0.05);
    this.out(g, 0.6, 0.8);
  }

  private impact(when: number, vel: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(80, when);
    o.frequency.exponentialRampToValueAtTime(27, when + 2.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel * 0.75, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 3);
    o.connect(g).connect(this.session);
    o.start(when);
    o.stop(when + 3.1);
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(6000, when);
    lp.frequency.exponentialRampToValueAtTime(300, when + 2.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.3, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + 2.8);
    n.connect(lp).connect(ng);
    n.start(when);
    n.stop(when + 3);
    this.out(ng, 0.5, 1.2);
    const cr = ctx.createBufferSource();
    cr.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 5000;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(vel * 0.12, when);
    cg.gain.exponentialRampToValueAtTime(0.0001, when + 3.5);
    cr.connect(hp).connect(cg);
    cr.start(when, 0.5);
    cr.stop(when + 3.6);
    this.out(cg, 0.6, 0.6, 0, 0.2);
  }
}
