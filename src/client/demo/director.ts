import { Vector3 } from "three";
import { BAR, bar, pulseAt } from "./timeline";

// ---------------------------------------------------------------- easing helpers
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const smoother = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const easeInOut3 = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
const easeOutBack = (x: number) => {
  const t = clamp01(x);
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const range = (t: number, b0: number, b1: number) => clamp01((t - bar(b0)) / (bar(b1) - bar(b0)));

type Ease = (x: number) => number;
/** Piecewise keyframes in bars. */
function keys(t: number, pts: [number, number][], ease: Ease = smooth): number {
  const b = t / BAR;
  if (b <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [b0, v0] = pts[i];
    const [b1, v1] = pts[i + 1];
    if (b < b1) return lerp(v0, v1, ease((b - b0) / (b1 - b0)));
  }
  return pts[pts.length - 1][1];
}

const DEG = Math.PI / 180;
export function dirAE(azDeg: number, elDeg: number, out = new Vector3()): Vector3 {
  const az = azDeg * DEG;
  const el = elDeg * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}
/** Must match frame() in the sky shader. */
function frame(c: Vector3, t1: Vector3, t2: Vector3) {
  const up = Math.abs(c.y) > 0.99 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  t1.crossVectors(up, c).normalize();
  t2.crossVectors(c, t1);
}

/** Visible fraction of a disk of radius a occluded by a disk of radius b at distance d. */
function visibleFraction(a: number, b: number, d: number): number {
  if (d >= a + b) return 1;
  if (d <= b - a) return 0;
  if (d <= a - b) return 1 - (b * b) / (a * a);
  const a2 = a * a;
  const b2 = b * b;
  const p1 = a2 * Math.acos((d * d + a2 - b2) / (2 * d * a));
  const p2 = b2 * Math.acos((d * d + b2 - a2) / (2 * d * b));
  const p3 = 0.5 * Math.sqrt((-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b));
  return clamp01(1 - (p1 + p2 - p3) / (Math.PI * a2));
}

// ---------------------------------------------------------------- world layout
export const ORB_CENTER = new Vector3(0, 7, 0);
export const ORB_RADIUS = 4.2;
export const SUN_R = 0.05;
export const MOON_R = 0.054;
const SUN_ECLIPSE = dirAE(4, 18);
const OFFSET_DIR = { x: 0.92, y: 0.39 };

export interface Shot {
  pos: Vector3;
  target: Vector3;
  fov: number;
  roll: number;
}

export interface WorldState {
  t: number;
  pulse: number;
  sunDir: Vector3;
  moonDir: Vector3;
  moonLightDir: Vector3;
  moonRadius: number;
  day: number;
  dawn: number;
  space: number;
  dark: number;
  totality: number;
  occlusion: number;
  sunVis: number;
  moonBright: number;
  moonVis: number;
  clouds: number;
  diamond: number;
  diamondDir: Vector3;
  milkyN: Vector3;
  waveScale: number;
  bio: number;
  foam: number;
  fogDensity: number;
  fogColor: [number, number, number];
  deepColor: [number, number, number];
  scatterColor: [number, number, number];
  sunSpec: number;
  moonSpec: number;
  orbPos: Vector3;
  orbForm: number;
  orbDissolve: number;
  orbGlow: number;
  orbColor: [number, number, number];
  stage: number;
  riseTime: number;
  burst: number;
  particleIntensity: number;
  spaceY: number;
  cam: Shot;
  lightDir: Vector3;
  exposure: number;
  bloom: number;
  bloomThreshold: number;
  rays: number;
  raysColor: [number, number, number];
  streak: number;
  ghost: number;
  flash: number;
  fade: number;
  ca: number;
  saturation: number;
  contrast: number;
  lift: [number, number, number];
  gain: [number, number, number];
  letterbox: number;
}

const mix3 = (a: number[], b: number[], t: number): [number, number, number] => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/** Automatic ripples (bar, x, z, strength) — the sea "breathes" with the music. */
export const AUTO_RIPPLES: [number, number, number, number][] = (() => {
  const out: [number, number, number, number][] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let b = 16; b < 20; b += 0.5) out.push([b, (rnd() - 0.5) * 40, 70 + rnd() * 25, 1]);
  for (let b = 24; b < 32; b += 1) out.push([b, (rnd() - 0.5) * 30, (rnd() - 0.5) * 30, 0.8]);
  out.push([40, ORB_CENTER.x, ORB_CENTER.z, 3]);
  for (let b = 40.5; b < 44; b += 0.5) out.push([b, (rnd() - 0.5) * 40, (rnd() - 0.5) * 40 + 5, 1]);
  out.push([44, ORB_CENTER.x, ORB_CENTER.z, 2]);
  return out;
})();

export class Director {
  private st: WorldState;
  private t1 = new Vector3();
  private t2 = new Vector3();
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  constructor() {
    const L1 = dirAE(-40, 35);
    const m0 = new Vector3().crossVectors(L1, new Vector3(0.5, 0.3, 0.8).normalize()).normalize();
    const milky = m0
      .clone()
      .multiplyScalar(Math.cos(0.75))
      .add(new Vector3().crossVectors(L1, m0).multiplyScalar(Math.sin(0.75)))
      .normalize();
    this.st = {
      t: 0,
      pulse: 0,
      sunDir: new Vector3(),
      moonDir: new Vector3(),
      moonLightDir: new Vector3(),
      moonRadius: MOON_R,
      day: 0,
      dawn: 0,
      space: 1,
      dark: 0,
      totality: 0,
      occlusion: 0,
      sunVis: 0,
      moonBright: 1,
      moonVis: 1,
      clouds: 0,
      diamond: 0,
      diamondDir: new Vector3(0, 1, 0),
      milkyN: milky,
      waveScale: 1,
      bio: 0,
      foam: 0.6,
      fogDensity: 0.001,
      fogColor: [0, 0, 0],
      deepColor: [0, 0, 0],
      scatterColor: [0, 0, 0],
      sunSpec: 0,
      moonSpec: 0,
      orbPos: ORB_CENTER.clone(),
      orbForm: 0,
      orbDissolve: 0,
      orbGlow: 1,
      orbColor: [0.2, 0.8, 1],
      stage: 0,
      riseTime: 0,
      burst: 0,
      particleIntensity: 1,
      spaceY: 260,
      cam: { pos: new Vector3(), target: new Vector3(), fov: 50, roll: 0 },
      lightDir: new Vector3(),
      exposure: 1,
      bloom: 1,
      bloomThreshold: 1,
      rays: 0,
      raysColor: [1, 1, 1],
      streak: 0,
      ghost: 0,
      flash: 0,
      fade: 0,
      ca: 0.3,
      saturation: 1,
      contrast: 1,
      lift: [0, 0, 0],
      gain: [1, 1, 1],
      letterbox: 0,
    };
  }

  update(t: number): WorldState {
    const s = this.st;
    s.t = t;
    s.pulse = pulseAt(t);
    const b = t / BAR;

    // ------------------------------------------------ sun path
    const sunEl = keys(t, [
      [0, -20],
      [23, -8],
      [30, 6],
      [33, 15],
      [36, 18],
      [44, 18],
      [51, 8],
    ]);
    if (b < 33) dirAE(lerp(10, 4, range(t, 23, 33)), sunEl, s.sunDir);
    else if (b < 36) s.sunDir.lerpVectors(dirAE(4, 15, this.tmp), SUN_ECLIPSE, range(t, 33, 36)).normalize();
    else s.sunDir.copy(dirAE(4, sunEl, this.tmp));
    const sunAbove = smooth((sunEl + 3) / 4);

    // ------------------------------------------------ moon path & eclipse geometry
    frame(s.sunDir, this.t1, this.t2);
    const mag = keys(
      t,
      [
        [30, 0.17],
        [32, 0.104],
        [39.8, MOON_R - SUN_R + 0.0009],
        [40, 0.0024],
        [44, -0.0024],
        [44.2, -(MOON_R - SUN_R) - 0.0009],
        [50, -0.11],
        [56, -0.22],
      ],
      (x) => x,
    );
    const eclMoon = this.tmp2
      .copy(s.sunDir)
      .addScaledVector(this.t1, OFFSET_DIR.x * mag)
      .addScaledVector(this.t2, OFFSET_DIR.y * mag)
      .normalize();
    const moonEl = keys(t, [
      [0, 14],
      [4, 14],
      [8.5, 6],
      [20, 8],
      [30, 12],
    ]);
    const nightMoon = dirAE(lerp(-2, 1, range(t, 8, 30)), moonEl, this.tmp);
    if (b < 26) s.moonDir.copy(nightMoon);
    else s.moonDir.lerpVectors(nightMoon, eclMoon, smoother(range(t, 26, 31.5))).normalize();
    s.moonVis = 1 - range(t, 45, 49);
    s.moonRadius = keys(
      t,
      [
        [0, 0.42],
        [4, 0.36],
        [8.6, 0.066],
        [26, 0.062],
        [31, MOON_R],
      ],
      easeInOut3,
    );

    const vis = b > 28 ? visibleFraction(SUN_R, MOON_R, Math.abs(mag)) : 1;
    s.sunVis = vis * sunAbove;
    s.dark = (1 - smooth(vis / 0.5)) * smooth((b - 30) / 2);
    s.totality = 1 - smooth(vis / 0.015);
    s.occlusion = smooth((1 - vis) / 0.6);
    s.diamond = vis > 0 && vis < 0.04 ? smooth((0.04 - vis) / 0.03) * smooth(vis / 0.0012) * 1.0 : 0;
    // diamond point: the sun limb furthest from the moon centre
    const sgn = Math.sign(mag) || 1;
    s.diamondDir
      .copy(s.sunDir)
      .addScaledVector(this.t1, -OFFSET_DIR.x * sgn * SUN_R * 0.98)
      .addScaledVector(this.t2, -OFFSET_DIR.y * sgn * SUN_R * 0.98)
      .normalize();

    // ------------------------------------------------ sky
    s.space = keys(t, [
      [0, 1],
      [6.5, 1],
      [9, 0],
      [51, 0],
      [55, 1],
    ]);
    s.day = keys(t, [
      [27, 0],
      [33, 1],
    ]);
    s.dawn = keys(t, [
      [24, 0],
      [29, 1],
      [34, 0.15],
      [44, 0.15],
      [47, 0.75],
      [51, 0.9],
      [54, 0.2],
    ]);
    s.clouds = keys(t, [
      [8, 0.25],
      [20, 0.4],
      [26, 0.6],
      [31, 0.6],
      [34, 0.15],
      [44, 0.15],
      [48, 0.6],
    ]);
    s.moonBright = keys(t, [
      [0, 1.5],
      [6, 1.6],
      [9, 2.6],
      [26, 2.2],
      [31, 0.9],
    ]);
    // moon terminator: gibbous at night, turning toward the sun by day
    frame(s.moonDir, this.t1, this.t2);
    const nightLight = this.tmp
      .copy(s.moonDir)
      .negate()
      .addScaledVector(this.t1, -0.5)
      .addScaledVector(this.t2, 0.25)
      .normalize();
    const dayW = smooth(range(t, 24, 32));
    s.moonLightDir.copy(nightLight).lerp(s.sunDir, dayW).normalize();

    // ------------------------------------------------ ocean
    s.waveScale = keys(t, [
      [8, 1],
      [20, 1],
      [28, 0.75],
      [33, 0.32],
      [44, 0.3],
      [48, 0.55],
    ]);
    s.bio = keys(t, [
      [9, 0],
      [11.5, 1],
      [24, 1],
      [30, 0.25],
      [36, 0.35],
      [39.5, 1.0],
      [40, 1.5],
      [44, 1.2],
      [47, 0.15],
    ]);
    s.fogDensity = keys(t, [
      [0, 0.05],
      [6.5, 0.05],
      [9, 0.0011],
      [30, 0.0016],
    ]);
    const lightAmt = clamp01(s.day * (1 - s.dark) + s.dawn * 0.35);
    s.deepColor = mix3([0.0, 0.004, 0.012], [0.0, 0.035, 0.062], lightAmt);
    s.scatterColor = mix3([0.0, 0.045, 0.06], [0.02, 0.24, 0.22], lightAmt);
    // horizon haze colour, mirrors the sky shader's horizon palette
    let fog = mix3([0.012, 0.03, 0.07], [0.42, 0.62, 0.9], s.day);
    fog = mix3(fog, [1.0, 0.45, 0.24], s.dawn * 0.8);
    fog = mix3(fog, [0.55, 0.22, 0.08], s.dark);
    s.fogColor = mix3(fog, [0, 0, 0], s.space);
    s.sunSpec = s.sunVis * (1 - s.space);
    s.moonSpec = s.moonBright * 0.5 * (1 - s.day) * (1 - s.space * 0.7);

    // ------------------------------------------------ orb
    const collapse = range(t, 46, 47.6);
    s.orbForm = easeOutBack(range(t, 23.5, 26.5)) * (1 - collapse * collapse * collapse);
    s.orbDissolve = 0;
    s.orbPos.set(ORB_CENTER.x, ORB_CENTER.y + Math.sin(t * 0.55) * 0.35, ORB_CENTER.z);
    s.orbGlow =
      keys(t, [
        [23, 0.6],
        [28, 1.0],
        [34, 0.6],
        [39.5, 1.2],
        [44, 1.2],
        [46, 1.5],
        [47.5, 6.0],
      ]) *
      (1 + s.pulse * 0.6);
    s.orbColor = mix3([0.15, 0.75, 1.0], [1.0, 0.72, 0.42], range(t, 44, 47));

    // ------------------------------------------------ particles
    s.stage = keys(t, [
      [6, 0],
      [9.5, 1],
      [21, 1],
      [26.5, 2],
      [47.2, 2],
      [48.2, 3],
    ]);
    s.riseTime = Math.max(0, t - bar(47.2));
    const xb = t - bar(40);
    s.burst = xb > 0 ? (1 - Math.exp(-xb * 5)) * Math.exp(-xb * 0.7) * 0.9 : 0;
    s.particleIntensity = keys(t, [
      [0, 0.0],
      [0.5, 1.0],
      [8, 0.7],
      [10, 1.0],
      [46, 1.0],
      [49, 0.55],
      [54, 0.45],
      [56, 0],
    ]);

    // ------------------------------------------------ camera
    this.camera(t, s.cam);
    s.spaceY = 260;

    // ------------------------------------------------ post
    const telephoto = (b >= 36 && b < 38) || (b >= 44 && b < 46);
    s.exposure = keys(t, [
      [0, 1.35],
      [9, 1.55],
      [24, 1.45],
      [31, 0.95],
      [36, 1.1],
      [40, 1.55],
      [44, 1.1],
      [48, 0.95],
      [54, 1.3],
    ]);
    s.bloomThreshold = lerp(1.0, 2.6, clamp01(s.day * (1 - s.dark) + s.dawn * 0.3));
    if (telephoto) {
      s.exposure *= 0.42;
      s.bloom *= 0.3;
      s.bloomThreshold *= 2.5;
      s.ghost = 0;
    }
    s.bloom = keys(t, [
      [0, 0.9],
      [36, 0.9],
      [40, 1.25],
      [44, 1.0],
    ]);
    s.flash =
      (xb > 0 ? Math.exp(-xb * 5) : 0) +
      (t > bar(44) ? Math.exp(-(t - bar(44)) * 4.5) * 0.6 : 0) +
      (t > bar(47.4) && t < bar(49) ? Math.exp(-(t - bar(47.4)) * 3) * 0.35 : 0) +
      (t > bar(20) && t < bar(21) ? Math.exp(-(t - bar(20)) * 4) * 0.25 : 0);
    s.fade = Math.max(1 - clamp01(t / 4), smooth((b - 55) / 1));
    s.streak = keys(t, [
      [0, 0.15],
      [9, 0.35],
      [26, 0.25],
      [38, 0.4],
      [40, 0.7],
      [44, 1.0],
      [46, 0.3],
    ]);
    s.ghost = keys(t, [
      [0, 0.0],
      [30, 0.12],
      [36, 0.2],
      [48, 0.12],
    ]);
    // god rays follow the moon at night, the sun by day
    const useSun = b >= 29;
    s.lightDir.copy(useSun ? s.sunDir : s.moonDir);
    s.rays = keys(t, [
      [0, 0.0],
      [7, 0.0],
      [9, 0.55],
      [20, 0.6],
      [29, 0.4],
      [38, 0.5],
      [40, 1.3],
      [44, 0.9],
      [50, 0.5],
    ]);
    s.rays *= 1 - 0.75 * clamp01(s.day * (1 - s.dark));
    s.streak *= 1 - 0.8 * clamp01(s.day * (1 - s.dark)) * (telephoto ? 0 : 1);
    s.raysColor = useSun ? mix3([1.0, 0.75, 0.5], [0.75, 0.85, 1.0], s.totality) : [0.6, 0.75, 1.0];
    s.ca = 0.35 + s.pulse * 0.6 + s.flash * 1.5;
    s.saturation = keys(t, [
      [0, 1.05],
      [36, 1.0],
      [40, 1.1],
      [46, 1.1],
    ]);
    s.contrast = 1.05;
    const warm = range(t, 44, 48) * (1 - range(t, 51, 54));
    s.lift = mix3([0.0, 0.008, 0.022], [0.012, 0.006, 0.0], warm);
    s.gain = mix3([0.98, 1.0, 1.04], [1.05, 1.0, 0.93], warm);
    s.letterbox = 0;
    return s;
  }

  // ------------------------------------------------ shots
  private camera(t: number, c: Shot) {
    const b = t / BAR;
    const O = ORB_CENTER;
    const look = (dir: Vector3) => c.target.copy(c.pos).addScaledVector(dir, 100);
    c.roll = 0;

    if (b < 4) {
      // S1 — deep space, slow roll through the milky way
      const u = range(t, 0, 4);
      c.pos.set(0, 260, 0);
      look(dirAE(lerp(-52, -34, u), lerp(40, 30, u), this.tmp));
      c.fov = lerp(58, 50, u);
      c.roll = lerp(-0.28, -0.12, u);
    } else if (b < 9) {
      // S2 — the moon, then the long fall into the atmosphere
      const u = range(t, 4, 9);
      const fall = easeInOut3(range(t, 5.5, 9));
      c.pos.set(0, lerp(260, 3.2, fall), lerp(0, 175, fall));
      look(dirAE(lerp(-11, -1, smooth(u)), lerp(16, 4.5, easeInOut3(range(t, 4, 9))), this.tmp));
      c.fov = lerp(38, 55, easeInOut3(range(t, 4.5, 9)));
      c.roll = lerp(-0.12, 0, smooth(u));
    } else if (b < 14) {
      // S3 — glide over the moonlit sea
      const u = range(t, 9, 14);
      c.pos.set(Math.sin(t * 0.3) * 1.5, 3.2 + Math.sin(t * 0.7) * 0.25, lerp(175, 125, u));
      look(dirAE(Math.sin(t * 0.2) * 3 - 1, lerp(4.5, 6, u), this.tmp));
      c.fov = 55;
      c.roll = Math.sin(t * 0.4) * 0.025;
    } else if (b < 17) {
      // S4 — low lateral track, waves cut against the moon path
      const u = range(t, 14, 17);
      c.pos.set(lerp(-26, 6, u), 1.5 + Math.sin(t * 0.9) * 0.15, 100);
      look(dirAE(-14, 3.0, this.tmp));
      c.fov = 34;
      c.roll = 0.02;
    } else if (b < 20) {
      // S5 — crane up over the glowing sea
      const u = smoother(range(t, 17, 20));
      c.pos.set(0, lerp(4, 28, u), lerp(92, 72, u));
      look(dirAE(-6, lerp(-52, -6, u), this.tmp));
      c.fov = lerp(60, 52, u);
    } else if (b < 24) {
      // S6 — the sea rises toward one point
      const u = range(t, 20, 24);
      c.pos.set(0, lerp(2.6, 3.6, u), lerp(46, 38, u));
      c.target.set(0, O.y + 3, O.z - 20);
      c.fov = lerp(50, 46, u);
    } else if (b < 28) {
      // S7 — orbit while the orb forms
      const u = smooth(range(t, 24, 28));
      const a = lerp(0.75, -0.55, u);
      c.pos.set(Math.sin(a) * 21, lerp(4, 8.5, u), Math.cos(a) * 21);
      c.target.set(O.x, O.y + 0.5, O.z);
      c.fov = 48;
    } else if (b < 32) {
      // S8 — macro: dawn through the water lens
      const u = smooth(range(t, 28, 32));
      const a = lerp(-0.3, 0.12, u);
      const r = lerp(17, 13.5, u);
      c.pos.set(Math.sin(a) * r, lerp(3.2, 4.2, u), Math.cos(a) * r);
      c.target.set(O.x, O.y + 1.5, O.z - 6);
      c.fov = 46;
    } else if (b < 36) {
      // S9 — wide: first contact over a calming sea
      const u = range(t, 32, 36);
      c.pos.set(0, lerp(2.2, 2.6, u), lerp(48, 41, u));
      const toSun = this.tmp.copy(this.st.sunDir);
      const toOrb = this.tmp2.copy(O).sub(c.pos).normalize();
      look(toSun.lerp(toOrb, 0.5).normalize());
      c.fov = 42;
    } else if (b < 38) {
      // S10 — telephoto: the last crescent
      const u = range(t, 36, 38);
      c.pos.set(0, 2.5, 40);
      look(this.tmp.copy(this.st.sunDir).addScaledVector(dirAE(0, 1, this.tmp2), -0.004));
      c.fov = lerp(9.5, 8, u);
    } else if (b < 40) {
      // S11 — orbit into darkness
      const u = smoother(range(t, 38, 40));
      const a = lerp(1.0, 0.15, u);
      c.pos.set(Math.sin(a) * 17, lerp(3.2, 2.4, u), Math.cos(a) * 17);
      c.target.set(O.x, O.y + 2, O.z);
      c.fov = lerp(52, 44, u);
    } else if (b < 42.5) {
      // S12 — totality: the hero frame
      const u = range(t, 40, 42.5);
      c.pos.set(0, lerp(2.0, 2.3, u), lerp(38, 32, u));
      look(dirAE(2.3, 12.5, this.tmp));
      c.fov = lerp(40, 37, u);
    } else if (b < 44) {
      // S13 — circling the orb in the 360° twilight
      const u = range(t, 42.5, 44);
      const a = lerp(-0.85, -0.45, u);
      c.pos.set(Math.sin(a) * 30, lerp(9, 7, u), Math.cos(a) * 30);
      c.target.set(O.x, O.y + 5, O.z - 6);
      c.fov = 58;
    } else if (b < 46) {
      // S14 — third contact, the diamond ring
      const u = range(t, 44, 46);
      c.pos.set(0, 2.5, 40);
      look(this.tmp.copy(this.st.sunDir));
      c.fov = lerp(10, 18, smooth(u));
    } else if (b < 50) {
      // S15 — the orb releases its light
      const u = smooth(range(t, 46, 50));
      const a = lerp(-0.25, 0.5, u);
      c.pos.set(Math.sin(a) * 26, lerp(4, 11, u), Math.cos(a) * 26);
      c.target.set(O.x, O.y + lerp(2, 8, u), O.z);
      c.fov = 52;
    } else {
      // S16 — ascend back into the stars, looking up and away from the sun
      const u = range(t, 50, 56);
      const up = easeInOut3(u);
      c.pos.set(Math.sin(0.5) * 26 * (1 - up), lerp(11, 360, up * up), lerp(Math.cos(0.5) * 26, 0, up));
      look(dirAE(lerp(-25, -50, up), lerp(10, 38, easeInOut3(range(t, 50, 55))), this.tmp));
      c.fov = lerp(55, 62, u);
      c.roll = lerp(0, -0.25, up);
    }
  }
}
