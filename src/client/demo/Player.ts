import { Music } from "./audio/Music";
import { Engine } from "./Engine";
import { BAR, DURATION, END_TIME } from "./timeline";

export type Phase = "loading" | "ready" | "playing" | "paused" | "ended";

/** Owns the render loop and keeps the visuals locked to the audio clock. */
export class Player {
  readonly engine: Engine;
  music: Music | null = null;
  phase: Phase = "loading";
  private visualTime = 0;
  private clockStart = 0;
  private raf = 0;
  private lastNow = performance.now();
  private idleStart = performance.now();
  private still: number | null;
  onEnd: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, opts: { mobile: boolean; still: number | null }) {
    this.engine = new Engine(canvas, { mobile: opts.mobile });
    this.still = opts.still;
    (window as unknown as { __player: Player }).__player = this;
    if (opts.still !== null) {
      // debug hook for frame-accurate review: window.__still(seconds)
      const w = window as unknown as { __still: (t: number) => void; __player: Player };
      w.__still = (t) => {
        this.still = t;
        this.engine.renderFrame(t);
      };
      w.__player = this;
    }
  }

  private disposed = false;

  async init() {
    await this.engine.warmup();
    if (this.disposed) return;
    this.phase = "ready";
    this.loop();
  }

  get time(): number {
    return this.visualTime;
  }

  /** Must be called from a user gesture (audio unlock). */
  async start(from = 0) {
    try {
      this.music ??= new Music();
      await this.music.play(from);
    } catch {
      this.music = null;
    }
    this.clockStart = performance.now() / 1000 - from;
    this.visualTime = from;
    this.phase = "playing";
  }

  seek(t: number) {
    const tt = Math.max(0, Math.min(END_TIME - 0.5, t));
    this.music?.seek(tt);
    this.clockStart = performance.now() / 1000 - tt;
    this.visualTime = tt;
    if (this.phase === "ended") this.phase = "playing";
  }

  togglePause() {
    if (this.phase === "playing") {
      this.music?.pause();
      this.phase = "paused";
    } else if (this.phase === "paused") {
      this.clockStart = performance.now() / 1000 - this.visualTime;
      void this.music?.resume();
      this.phase = "playing";
    }
  }

  private targetTime(now: number): number {
    if (this.music?.isPlaying) return this.music.time;
    return now / 1000 - this.clockStart;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;

    let t: number;
    if (this.still !== null) {
      t = this.still;
    } else if (this.phase === "playing") {
      // advance smoothly, then gently pull toward the audio clock
      this.visualTime += dt;
      const err = this.targetTime(now) - this.visualTime;
      if (Math.abs(err) > 0.25) this.visualTime += err;
      else this.visualTime += err * 0.08;
      t = this.visualTime;
      if (t >= DURATION) {
        this.phase = "ended";
        this.music?.pause();
        this.onEnd?.();
      }
    } else if (this.phase === "paused" || this.phase === "ended") {
      t = Math.min(this.visualTime, END_TIME);
    } else {
      // attract mode behind the intro: the corona, breathing slowly
      const e = (now - this.idleStart) / 1000;
      const span = BAR * 1.7;
      const k = (e * 0.3) % (span * 2);
      t = BAR * 40.7 + (k < span ? k : span * 2 - k);
    }
    this.engine.renderFrame(t, this.still === null);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.engine.dispose();
    void this.music?.ctx.close();
  }
}
