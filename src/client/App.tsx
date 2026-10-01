import { useCallback, useEffect, useRef, useState } from "react";
import { type Phase, Player } from "./demo/Player";
import { BAR, CHAPTERS, chapterAt, END_TIME } from "./demo/timeline";
import { composeShareImage } from "./ui/capture";
import { Icon } from "./ui/Icon";

const params = new URLSearchParams(location.search);
const STILL = params.has("still") ? Number(params.get("still")) || 0 : null;
const START = Number(params.get("t")) || 0;
const MOBILE = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 700;
const WEBGL2 = (() => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
})();
const SHARE_TEXT =
  "蒼の日蝕 — Azure Eclipse. A real-time audiovisual poem of water, moon and light. Built with Three.js.";

const fmt = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [time, setTime] = useState(0);
  const [chapter, setChapter] = useState(-1);
  const [muted, setMuted] = useState(false);
  const [idle, setIdle] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const error = WEBGL2 ? null : "This piece needs WebGL2. Try a recent Chrome, Safari or Firefox.";
  const [leaving, setLeaving] = useState(false);

  // ------------------------------------------------ boot
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !WEBGL2) return;
    const player = new Player(canvas, { mobile: MOBILE, still: STILL });
    playerRef.current = player;
    player.onEnd = () => setPhase("ended");
    const onResize = () => player.engine.resize();
    window.addEventListener("resize", onResize);
    player.init().then(() => setPhase(player.phase));
    return () => {
      window.removeEventListener("resize", onResize);
      player.dispose();
    };
  }, []);

  // ------------------------------------------------ UI clock (10 Hz is plenty for text)
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      setTime(p.time);
      if (p.phase === "playing" || p.phase === "paused") setChapter(chapterAt(p.time));
      if (p.phase !== phase && p.phase !== "loading") setPhase(p.phase);
    }, 100);
    return () => window.clearInterval(id);
  }, [phase]);

  // ------------------------------------------------ idle → hide chrome
  useEffect(() => {
    let id = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(id);
      id = window.setTimeout(() => setIdle(true), 2600);
    };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
      window.clearTimeout(id);
    };
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const enter = useCallback(async () => {
    const p = playerRef.current;
    if (!p || p.phase !== "ready") return;
    setLeaving(true);
    await p.start(START);
    setPhase("playing");
    setChapter(chapterAt(START));
  }, []);

  const replay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (!p.music) void p.start(0);
    else p.seek(0);
    setPhase("playing");
  }, []);

  const toggleMute = useCallback(() => {
    const m = playerRef.current?.music;
    if (!m) return;
    m.setMuted(!m.isMuted);
    setMuted(m.isMuted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }, []);

  const capture = useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    const blob = await p.engine.capture();
    if (!blob) return;
    const ch = CHAPTERS[chapterAt(p.time)];
    const out = await composeShareImage(blob, ch);
    const file = new File([out], `azure-eclipse-${fmt(p.time).replace(":", "m")}s.jpg`, {
      type: "image/jpeg",
    });
    if (MOBILE && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: SHARE_TEXT, url: location.origin });
        return;
      } catch {
        /* fall through to download */
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    flash("Frame captured — share it ✦");
  }, [flash]);

  const shareX = useCallback(() => {
    const u = new URL("https://x.com/intent/post");
    u.searchParams.set("text", SHARE_TEXT);
    u.searchParams.set("url", location.origin);
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  }, []);

  const jump = useCallback((t: number) => playerRef.current?.seek(t), []);

  // ------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = playerRef.current;
      if (!p) return;
      if (e.key === "Enter" && p.phase === "ready") void enter();
      if (p.phase !== "playing" && p.phase !== "paused") return;
      if (e.key === " ") {
        e.preventDefault();
        p.togglePause();
        setPhase(p.phase);
      } else if (e.key === "m") toggleMute();
      else if (e.key === "f") toggleFullscreen();
      else if (e.key === "c") void capture();
      else if (e.key === "ArrowRight") p.seek(p.time + 10);
      else if (e.key === "ArrowLeft") p.seek(p.time - 10);
      else if (/^[1-5]$/.test(e.key)) p.seek(CHAPTERS[Number(e.key) - 1].bar * BAR);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enter, toggleMute, toggleFullscreen, capture]);

  // ------------------------------------------------ interaction: parallax + ripples
  const onPointerMove = (e: React.PointerEvent) => {
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    playerRef.current?.engine.setPointer(nx, ny);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    const p = playerRef.current;
    if (!p || p.phase !== "playing") return;
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -(e.clientY / window.innerHeight) * 2 + 1;
    if (p.engine.addRippleAtScreen(nx, ny, p.time)) p.music?.chime(nx);
  };

  const playing = phase === "playing" || phase === "paused";
  const showChrome = playing && !idle;
  const ch = chapter >= 0 ? CHAPTERS[chapter] : null;
  const chapterStart = ch ? ch.bar * BAR : 0;
  const hint = chapter === 1 && time - chapterStart > 9 && time - chapterStart < 16;
  const cardVisible = playing && ch !== null && time - chapterStart < 7.5 && time - chapterStart > 0.4;

  if (STILL !== null) {
    return <canvas ref={canvasRef} className="stage" />;
  }

  return (
    <main className={`app ${showChrome ? "chrome" : ""}`} onPointerMove={onPointerMove}>
      <canvas ref={canvasRef} className="stage" onPointerDown={onPointerDown} />

      {/* ---------------- intro ---------------- */}
      {(phase === "loading" || phase === "ready" || leaving) && !playing && (
        <section className={`intro ${leaving ? "leaving" : ""}`}>
          <div className="intro-veil" />
          <p className="intro-kicker">A real-time audiovisual poem</p>
          <h1 className="intro-title">
            <span className="intro-title-en">Azure Eclipse</span>
          </h1>
          <p className="intro-jp" lang="ja">
            蒼の日蝕
          </p>
          <p className="intro-lede">
            Water, moon and light, rendered and composed live in your browser. <br />
            No video, no samples. Every wave and every note is born in real time.
          </p>
          <button
            type="button"
            className={`enter ${phase === "ready" ? "is-ready" : ""}`}
            onClick={enter}
            disabled={phase !== "ready"}
            aria-label="Enter the experience"
          >
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="enter-ring" cx="60" cy="60" r="54" />
              <circle className="enter-moon" cx="60" cy="60" r="38" />
            </svg>
            <span>{phase === "ready" ? "Enter" : "Tuning"}</span>
          </button>
          <ul className="intro-meta">
            <li>
              <Icon name="headphones" /> Headphones on
            </li>
            <li>3 min</li>
            <li>Tap the sea</li>
          </ul>
          {error && <p className="intro-error">{error}</p>}
        </section>
      )}

      {/* ---------------- chapter card ---------------- */}
      {ch && (
        <div key={chapter} className={`card ${cardVisible ? "is-on" : ""}`} aria-live="polite">
          <span className="card-num">{ch.numeral}</span>
          <span className="card-jp" lang="ja">
            {[...ch.jp].map((c, i) => (
              <span key={c + String(i)} style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
                {c}
              </span>
            ))}
          </span>
          <span className="card-en">{ch.en}</span>
          <span className="card-line">{ch.line}</span>
        </div>
      )}

      {hint && playing && <p className="hint">Touch the sea — it answers.</p>}

      {/* ---------------- HUD ---------------- */}
      {playing && (
        <>
          <header className="hud-top">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true" />
              <span>Azure Eclipse</span>
            </div>
            {ch && (
              <div className="hud-chapter">
                <span>{ch.numeral}</span>
                <span lang="ja">{ch.jp}</span>
              </div>
            )}
          </header>
          <footer className="hud-bottom">
            <div className="timeline">
              {CHAPTERS.map((c, i) => {
                const s = c.bar * BAR;
                const e = i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].bar * BAR : END_TIME;
                const fill = Math.max(0, Math.min(1, (time - s) / (e - s)));
                return (
                  <button
                    key={c.numeral}
                    type="button"
                    className={`seg ${i === chapter ? "is-current" : ""}`}
                    style={{ flexGrow: e - s }}
                    onClick={() => jump(s)}
                    aria-label={`Chapter ${c.numeral}: ${c.en}`}
                  >
                    <span className="seg-bar">
                      <span className="seg-fill" style={{ transform: `scaleX(${fill})` }} />
                    </span>
                    <span className="seg-label">
                      {c.numeral} · {c.en}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="controls">
              <span className="tc">
                {fmt(time)} <i>/</i> {fmt(END_TIME)}
              </span>
              <button
                type="button"
                onClick={() => playerRef.current?.togglePause()}
                aria-label="Play / pause"
              >
                <Icon name={phase === "paused" ? "play" : "pause"} />
              </button>
              <button type="button" onClick={toggleMute} aria-label="Sound">
                <Icon name={muted ? "mute" : "sound"} />
              </button>
              <button type="button" onClick={capture} aria-label="Capture frame">
                <Icon name="camera" />
              </button>
              <button type="button" onClick={shareX} aria-label="Share on X">
                <Icon name="x" />
              </button>
              <button type="button" onClick={toggleFullscreen} aria-label="Fullscreen">
                <Icon name="expand" />
              </button>
            </div>
          </footer>
        </>
      )}

      {/* ---------------- end ---------------- */}
      {phase === "ended" && (
        <section className="end">
          <p className="intro-kicker">Thank you for breathing with us</p>
          <h2 className="end-title">Azure Eclipse</h2>
          <p className="intro-jp" lang="ja">
            蒼の日蝕
          </p>
          <div className="end-actions">
            <button type="button" className="pill" onClick={replay}>
              <Icon name="replay" /> Replay
            </button>
            <button type="button" className="pill" onClick={shareX}>
              <Icon name="x" /> Share
            </button>
          </div>
          <p className="credits">Three.js · Web Audio · Hono on Cloudflare Workers</p>
        </section>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
