import { useCallback, useEffect, useRef, useState } from "react";
import { COLS, ROWS, DIRS, initialSnake } from "./snakeCore";
import { newRound, queueTurn, advance, localSeed } from "./snakeRound";

/**
 * Fluenci Arcade: Snake for the v2 dashboard.
 *
 * The rules (board, food, speed, collisions) are snakeCore.js, the same code the
 * server replays a scored round with; snakeRound.js adds the buffered turns and
 * the turn log. This component draws, takes input and reports. Access is the
 * parent's job: `disabled` is its lever, and `scoring` is how a round goes on
 * the weekly board. With `scoring` null (a free round, or a player who isn't
 * signed in) a round never talks to the server and plays fine offline.
 *
 *   <SnakeGame disabled={!hasAccess} onGameOver={({ score, durationMs }) => ...} />
 *
 *   scoring = {
 *     start:  () => Promise<{ ok: true, ticket, seed, owner } | { ok: false, message }>,
 *     finish: ({ ticket, owner, inputs, score, durationMs }) =>
 *               Promise<{ ok: true, score, best, rank } | { ok: false, message }>,
 *   }
 */

const CELL = 16;               // logical px; the canvas is scaled to fit, this only fixes the aspect
const BOARD_W = COLS * CELL;   // 320
const BOARD_H = ROWS * CELL;   // 400
const MAX_W = 420;

const BEST_KEY = "fluenci_snake_best";
const SWIPE_MIN = 20;          // css px before a touch counts as a swipe

const KEY_DIR = {
  ArrowUp: "up", w: "up", W: "up",
  ArrowDown: "down", s: "down", S: "down",
  ArrowLeft: "left", a: "left", A: "left",
  ArrowRight: "right", d: "right", D: "right",
};

const C = {
  bg: "#0a0a0a",
  grid: "rgba(255, 255, 255, 0.035)",
  head: "#0ab6d8",             // a step brighter than the accent so direction reads at a glance
  body: "7, 154, 183",         // --fl-accent as rgb, alpha fades toward the tail
  food: "#f59e0b",
  foodGlow: "rgba(245, 158, 11, 0.45)",
  eye: "#0a0a0a",
};

const readBest = () => {
  try { return parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0; } catch { return 0; }
};

// Drawn behind the "ready" overlay so the board never looks empty or broken.
const PREVIEW = { round: { game: { snake: initialSnake(), dir: "right", food: null } }, pulse: 0 };

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.fill();
};

const PHASE_PILL = {
  ready: { cls: "fl-pill--off", text: "Ready" },
  playing: { cls: "fl-pill--on", text: "Playing" },
  gameover: { cls: "fl-pill--warn", text: "Game over" },
};

const IDLE_SUBMIT = { status: "idle" };
const FINISH_FAILED = "Couldn't send this score to the board.";

export default function SnakeGame({
  disabled = false, onGameOver, onStart, startLabel = "Play",
  scoring = null, weekBest = null, note = null,
}) {
  const [phase, setPhase] = useState("ready"); // ready | playing | gameover
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(readBest);
  const [newBest, setNewBest] = useState(false);
  const [starting, setStarting] = useState(false);
  // The round on screen: scored or not, and why not when a scored start failed.
  const [roundInfo, setRoundInfo] = useState({ scored: false, notice: "" });
  const [submit, setSubmit] = useState(IDLE_SUBMIT);

  const canvasRef = useRef(null);
  const stateRef = useRef(null);     // mutable game state; the loop never goes through React
  const bestRef = useRef(best);
  const onGameOverRef = useRef(onGameOver);
  const onStartRef = useRef(onStart);
  const scoringRef = useRef(scoring);
  const roundId = useRef(0);
  const mounted = useRef(true);

  // The loop is started once per game, so it reads the latest callbacks through
  // refs instead of capturing whatever the parent passed when the game began.
  useEffect(() => { onGameOverRef.current = onGameOver; }, [onGameOver]);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);
  useEffect(() => { scoringRef.current = scoring; }, [scoring]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current || PREVIEW;
    const g = s.round.game;

    // Backing store is css size x devicePixelRatio; draw in logical board units.
    const sx = canvas.width / BOARD_W;
    const sy = canvas.height / BOARD_H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1 / sx; // one device pixel, whatever the scale
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) { ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, BOARD_H); }
    for (let y = 1; y < ROWS; y++) { ctx.moveTo(0, y * CELL); ctx.lineTo(BOARD_W, y * CELL); }
    ctx.stroke();

    if (g.food) {
      const pulse = 1 + Math.sin(s.pulse) * 0.15;
      ctx.shadowColor = C.foodGlow;
      ctx.shadowBlur = 8;
      ctx.fillStyle = C.food;
      ctx.beginPath();
      ctx.arc(g.food.x * CELL + CELL / 2, g.food.y * CELL + CELL / 2, (CELL / 2 - 2) * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const len = g.snake.length;
    for (let i = len - 1; i >= 0; i--) { // tail first so the head paints on top
      const seg = g.snake[i];
      const t = i / Math.max(len - 1, 1); // 0 = head, 1 = tail
      if (i === 0) {
        ctx.shadowColor = "rgba(10, 182, 216, 0.5)";
        ctx.shadowBlur = 6;
        ctx.fillStyle = C.head;
      } else {
        ctx.fillStyle = `rgba(${C.body}, ${(1 - t * 0.55).toFixed(3)})`;
      }
      roundRect(ctx, seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2, i === 0 ? 5 : 3);
      ctx.shadowBlur = 0;

      if (i === 0) {
        const [dx, dy] = DIRS[g.dir];
        ctx.fillStyle = C.eye;
        ctx.beginPath();
        if (dx !== 0) {
          const ex = seg.x * CELL + CELL / 2 + dx * 2;
          ctx.arc(ex, seg.y * CELL + 5, 1.8, 0, Math.PI * 2);
          ctx.arc(ex, seg.y * CELL + 11, 1.8, 0, Math.PI * 2);
        } else {
          const ey = seg.y * CELL + CELL / 2 + dy * 2;
          ctx.arc(seg.x * CELL + 5, ey, 1.8, 0, Math.PI * 2);
          ctx.arc(seg.x * CELL + 11, ey, 1.8, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  }, []);

  // Size the backing store to the rendered width so the board is crisp on high-DPI
  // screens. CSS keeps width at 100% (capped by the wrapper) and height:auto follows
  // the width/height attributes, so resizing the store never feeds back into layout.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let lastKey = "";
    const fit = () => {
      const cssW = canvas.clientWidth;
      if (!cssW) return;
      const dpr = window.devicePixelRatio || 1;
      const key = `${cssW}@${dpr}`;
      if (key === lastKey) return;
      lastKey = key;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssW * dpr * (BOARD_H / BOARD_W));
      draw();
    };
    fit();
    draw(); // in case layout had no width yet
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(canvas);
    // Browser zoom and moving between monitors change devicePixelRatio without a resize of the box.
    window.addEventListener("resize", fit);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [draw]);

  // A scored round's turn log goes to the server, which replays it from the seed.
  const sendScore = useCallback((s, finalScore, durationMs) => {
    setSubmit({ status: "sending" });
    const shown = (r) => { if (stateRef.current === s) setSubmit(r); };
    Promise.resolve()
      .then(() => s.finish({ ticket: s.ticket, owner: s.owner, inputs: s.round.inputs, score: finalScore, durationMs }))
      .then((r) => shown(r?.ok ? { status: "ok", score: r.score, best: r.best, rank: r.rank }
                                : { status: "failed", message: r?.message || FINISH_FAILED }))
      .catch(() => shown({ status: "failed", message: FINISH_FAILED }));
  }, []);

  const finish = useCallback((s) => {
    if (s.over) return; // exactly one onGameOver per game
    s.over = true;
    const finalScore = s.round.game.score;
    const durationMs = Math.max(0, Math.round(performance.now() - s.startedAt));
    const isBest = finalScore > bestRef.current;
    if (isBest) {
      bestRef.current = finalScore;
      setBest(finalScore);
      try { localStorage.setItem(BEST_KEY, String(finalScore)); } catch { /* private mode: keep it in memory */ }
    }
    setNewBest(isBest);
    setScore(finalScore);
    setPhase("gameover");
    onGameOverRef.current?.({ score: finalScore, durationMs });
    if (s.ticket) sendScore(s, finalScore, durationMs);
  }, [sendScore]);

  const begin = useCallback((seed, ticket, owner, finishFn, notice) => {
    stateRef.current = {
      round: newRound(seed),
      ticket,
      owner,
      finish: finishFn,
      pulse: 0,
      over: false,
      startedAt: performance.now(),
    };
    setRoundInfo({ scored: Boolean(ticket), notice });
    setSubmit(IDLE_SUBMIT);
    setScore(0);
    setNewBest(false);
    setPhase("playing");
  }, []);

  const start = useCallback(async () => {
    if (disabled || starting) return;
    // Fired when a game begins (not when it ends), so a round counts even if
    // the player leaves mid-game - e.g. to reuse a one-time free round.
    onStartRef.current?.();
    const my = ++roundId.current;
    const scorer = scoringRef.current;
    if (!scorer) {
      begin(localSeed(), null, null, null, "");
      return;
    }
    // A scored round plays the server's seed; if there's no ticket, it still plays, just unscored.
    setStarting(true);
    let r;
    try { r = await scorer.start(); } catch { r = { ok: false, message: "" }; }
    if (!mounted.current || my !== roundId.current) return;
    setStarting(false);
    if (r?.ok) begin(r.seed, r.ticket, r.owner, scorer.finish, "");
    else begin(localSeed(), null, null, null, r?.message || "The server couldn't start a scored round right now.");
  }, [disabled, starting, begin]);

  // Game loop: rAF for smooth rendering, movement gated by the current speed.
  useEffect(() => {
    if (phase !== "playing") return undefined;
    let raf = 0;
    let last = null;
    const frame = (t) => {
      const s = stateRef.current;
      if (!s || s.over) return;
      s.pulse = (s.pulse + 0.05) % (Math.PI * 2);
      // First step waits one full interval so the player sees the board before it moves.
      if (last === null) last = t;
      if (t - last >= s.round.game.speed) {
        last = t;
        const { ate } = advance(s.round);
        if (ate) setScore(s.round.game.score);
        if (!s.round.game.alive) {
          draw();
          finish(s);
          return;
        }
      }
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, draw, finish]);

  // Keyboard, only while playing, so the page scrolls normally the rest of the time.
  useEffect(() => {
    if (phase !== "playing") return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't steal keys from a text field (the Arcade chat sits beside this).
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const d = KEY_DIR[e.key];
      if (d) {
        if (e.key.startsWith("Arrow")) e.preventDefault();
        if (stateRef.current) queueTurn(stateRef.current.round, d);
      } else if (e.key === " ") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  // Swipe on the board. touch-action:none (set below while playing) stops the page
  // from scrolling under the finger, so these can stay passive.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (phase !== "playing" || !canvas) return undefined;
    let from = null;
    const onTouchStart = (e) => {
      const t = e.touches[0];
      from = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e) => {
      const t = e.changedTouches[0];
      const s = stateRef.current;
      if (!from || !t || !s) { from = null; return; }
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      from = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
      if (Math.abs(dx) > Math.abs(dy)) queueTurn(s.round, dx > 0 ? "right" : "left");
      else queueTurn(s.round, dy > 0 ? "down" : "up");
    };
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [phase]);

  const pill = PHASE_PILL[phase];
  const showWeek = Boolean(scoring) || roundInfo.scored;

  // One line under the board: what this round counts for, or the parent's hint.
  let footNote = null;
  if (phase !== "ready" && roundInfo.notice) {
    footNote = <span style={{ color: "var(--fl-warn)" }}>This round isn't scored: {roundInfo.notice}</span>;
  } else if (phase === "playing" && roundInfo.scored) {
    footNote = "This round counts for this week's board once the server has checked it.";
  } else if (phase !== "playing" && note) {
    footNote = note;
  }

  let result = null;
  if (submit.status === "sending") {
    result = <span style={{ color: "var(--fl-fg-3)" }}>Checking your score…</span>;
  } else if (submit.status === "ok") {
    result = submit.rank
      ? <span style={{ color: "var(--fl-fg-2)" }}>
          {submit.best === submit.score && submit.score > 0 ? "Your best this week" : `Best this week ${submit.best}`}
          {" · "}#{submit.rank} on the board
        </span>
      : <span style={{ color: "var(--fl-fg-3)" }}>Eat at least one dot to get on the board.</span>;
  } else if (submit.status === "failed") {
    result = <span style={{ color: "var(--fl-warn)" }}>{submit.message}</span>;
  }

  return (
    <div className="fl-card" style={{ padding: 20 }}>
      <div className="fl-row--between" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <div className="fl-row" style={{ gap: 26, flexWrap: "wrap", rowGap: 10 }}>
          <div>
            <div className="fl-lbl">Score</div>
            <div className="fl-mono" style={{ color: "var(--fl-accent)", fontSize: 21, fontWeight: 600, marginTop: 3 }}>
              {score}
            </div>
          </div>
          <div>
            <div className="fl-lbl">Best</div>
            <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 21, fontWeight: 600, marginTop: 3 }}>
              {best}
            </div>
          </div>
          {showWeek && (
            <div>
              <div className="fl-lbl">Best this week</div>
              <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 21, fontWeight: 600, marginTop: 3 }}>
                {weekBest ?? "-"}
              </div>
            </div>
          )}
        </div>
        <span className={`fl-pill ${pill.cls}`} aria-live="polite">{pill.text}</span>
      </div>

      <div style={{
        position: "relative", width: "100%", maxWidth: MAX_W, margin: "0 auto",
        border: "1px solid var(--fl-border)", borderRadius: 10, overflow: "hidden", background: C.bg,
      }}>
        <canvas
          ref={canvasRef}
          width={BOARD_W}
          height={BOARD_H}
          role="img"
          aria-label={
            phase === "playing"
              ? `Snake game board. Score ${score}. Steer with arrow keys, WASD or swipes.`
              : "Snake game board"
          }
          style={{ display: "block", width: "100%", height: "auto",
                   touchAction: phase === "playing" ? "none" : "auto" }}
        />

        {phase !== "playing" && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", textAlign: "center", padding: 20,
            background: "rgba(10, 10, 10, 0.78)", backdropFilter: "blur(2px)",
          }}>
            {phase === "ready" ? (
              <>
                <div className="fl-h" style={{ color: "var(--fl-fg)", fontSize: 19, fontWeight: 700, marginBottom: 6 }}>
                  Snake
                </div>
                <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.55, maxWidth: 230, marginBottom: 18 }}>
                  Eat the amber dots. Every five makes you faster. Don't hit a wall or yourself.
                </div>
                <button type="button" className="fl-btn fl-btn--primary" style={{ minWidth: 140 }}
                        disabled={disabled || starting} onClick={start}>
                  {starting ? "Starting…" : startLabel}
                </button>
              </>
            ) : (
              <>
                <div className="fl-lbl">Game over</div>
                <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 38, fontWeight: 600, margin: "6px 0 4px" }}>
                  {score}
                </div>
                <div style={{ marginBottom: result ? 8 : 18, minHeight: 20 }}>
                  {newBest && score > 0 ? (
                    <span className="fl-pill fl-pill--warn">New best</span>
                  ) : (
                    <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>Best {best}</span>
                  )}
                </div>
                {result && (
                  <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 260, marginBottom: 16 }} aria-live="polite">
                    {result}
                  </div>
                )}
                <button type="button" className="fl-btn fl-btn--primary" style={{ minWidth: 140 }}
                        disabled={disabled || starting} onClick={start}>
                  {starting ? "Starting…" : "Play again"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="fl-mono" style={{ textAlign: "center", color: "var(--fl-fg-3)", fontSize: 11, marginTop: 12 }}>
        Arrow keys or WASD · swipe on touch
      </div>
      {footNote && (
        <div style={{ textAlign: "center", color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.5, marginTop: 8 }}>
          {footNote}
        </div>
      )}
    </div>
  );
}
