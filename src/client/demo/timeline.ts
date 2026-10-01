/** Musical clock shared by the score and the visuals. Everything is derived from it. */
export const BPM = 76;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
export const STEP = BEAT / 4;
export const TOTAL_BARS = 56;
export const END_TIME = TOTAL_BARS * BAR;
export const DURATION = END_TIME + 3;

export const bar = (n: number): number => n * BAR;

export interface Chapter {
  bar: number;
  numeral: string;
  jp: string;
  en: string;
  line: string;
}

export const CHAPTERS: Chapter[] = [
  { bar: 0, numeral: "I", jp: "宙", en: "Cosmos", line: "Before the tide, there was only light." },
  { bar: 8, numeral: "II", jp: "月の出", en: "Moonrise", line: "The sea remembers the moon." },
  { bar: 20, numeral: "III", jp: "浄化", en: "Purification", line: "Every drop returns to the sky." },
  { bar: 32, numeral: "IV", jp: "日蝕", en: "Eclipse", line: "Darkness, for a single breath." },
  { bar: 44, numeral: "V", jp: "還光", en: "Return", line: "And the light comes home." },
];

export function chapterAt(t: number): number {
  const b = t / BAR;
  let idx = 0;
  for (let i = 0; i < CHAPTERS.length; i++) if (b >= CHAPTERS[i].bar) idx = i;
  return idx;
}

/** Kick velocity at a given bar / sixteenth step (0 = silent). Shared by audio and visuals. */
export function kickAt(b: number, s: number): number {
  if (b >= 16 && b < 20) return s === 0 || s === 10 ? 0.45 : 0;
  if (b >= 24 && b < 36) return s % 4 === 0 ? (b < 28 ? 0.6 : 0.8) : 0;
  if (b >= 40 && b < 48) return s % 4 === 0 ? 1 : 0;
  if (b >= 48 && b < 50) return s === 0 || s === 8 ? 0.6 : 0;
  return 0;
}

/** Visual pulse envelope driven by the deterministic kick pattern. */
export function pulseAt(t: number): number {
  if (t < 0) return 0;
  const stepIdx = Math.floor(t / STEP);
  for (let k = 0; k < 8; k++) {
    const i = stepIdx - k;
    if (i < 0) break;
    const v = kickAt(Math.floor(i / 16), i % 16);
    if (v > 0) return v * Math.exp(-(t - i * STEP) * 7);
  }
  return 0;
}
