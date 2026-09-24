import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fluenci Arcade: Snake for the v2 dashboard.
 *
 * Ported from the v1 game in components/QieDoodleGame.jsx, with everything about
 * payments removed. Access (QIE Pass, subscription) is the parent's job; this
 * component only plays and reports. `disabled` is the one lever the parent has.
 *
 *   <SnakeGame disabled={!hasAccess} onGameOver={({ score, durationMs }) => ...} />
 */

// Same board as v1 so scores stay comparable across the two versions.
const COLS = 20;
const ROWS = 25;
const CELL = 16;               // logical px; the canvas is scaled to fit, this only fixes the aspect
const BOARD_W = COLS * CELL;   // 320
const BOARD_H = ROWS * CELL;   // 400
const MAX_W = 420;

const BEST_KEY = "fluenci_snake_best";
const POINTS = 10;
const START_SPEED = 220;       // ms per step
const MIN_SPEED = 90;
const SPEED_STEP = 8;          // faster by this much every 5 food
const SWIPE_MIN = 20;          // css px before a touch counts as a swipe

const DIR = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
const KEY_DIR = {
  ArrowUp: DIR.UP, w: DIR.UP, W: DIR.UP,
  ArrowDown: DIR.DOWN, s: DIR.DOWN, S: DIR.DOWN,
  ArrowLeft: DIR.LEFT, a: DIR.LEFT, A: DIR.LEFT,
  ArrowRight: DIR.RIGHT, d: DIR.RIGHT, D: DIR.RIGHT,
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

const initialSnake = () => {
  const x = Math.floor(COLS / 2);
  const y = Math.floor(ROWS / 2);
  return [{ x, y }, { x: x - 1, y }, { x: x - 2, y }];
};

// Drawn behind the "ready" overlay so the board never looks empty or broken.
const PREVIEW = { snake: initialSnake(), dir: DIR.RIGHT, food: null, pulse: 0 };

// Random probing is fine while the board is mostly empty; the scan fallback keeps
// a near-full board from spinning forever (v1's do/while could).
const spawnFood = (snake) => {
  const taken = (x, y) => snake.some((p) => p.x === x && p.y === y);
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(Math.random() * COLS);
    const y = Math.floor(Math.random() * ROWS);
    if (!taken(x, y)) return { x, y };
  }
  const free = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!taken(x, y)) free.push({ x, y });
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
};

// Up to two buffered turns, each checked against the one before it, so a quick
// "up, left" inside one step is not lost and can never fold the snake onto itself.
const queueTurn = (s, d) => {
  if (s.queue.length >= 2) return;
  const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
  if (d[0] === last[0] && d[1] === last[1]) return;
  if (d[0] === -last[0] && d[1] === -last[1]) return;
  s.queue.push(d);
};

// One movement step. Returns { alive, ate }.
const step = (s) => {
  if (s.queue.length) s.dir = s.queue.shift();
  const head = { x: s.snake[0].x + s.dir[0], y: s.snake[0].y + s.dir[1] };

  if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) return { alive: false, ate: false };

  const ate = !!s.food && head.x === s.food.x && head.y === s.food.y;
  // The tail moves out of the way this step unless we grow, so it is not an obstacle.
  const body = ate ? s.snake : s.snake.slice(0, -1);
  if (body.some((p) => p.x === head.x && p.y === head.y)) return { alive: false, ate: false };

  s.snake.unshift(head);
  if (ate) {
    s.eaten += 1;
    s.score += POINTS;
    if (s.eaten % 5 === 0 && s.speed > MIN_SPEED) s.speed = Math.max(MIN_SPEED, s.speed - SPEED_STEP);
    s.food = spawnFood(s.snake);
    if (!s.food) return { alive: false, ate }; // board is full: nothing left to eat
  } else {
    s.snake.pop();
  }
  return { alive: true, ate };
};

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

export default function SnakeGame({ disabled = false, onGameOver, onStart, startLabel = "Play" }) {
  const [phase, setPhase] = useState("ready"); // ready | playing | gameover
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(readBest);
  const [newBest, setNewBest] = useState(false);

  const canvasRef = useRef(null);
  const stateRef = useRef(null);     // mutable game state; the loop never goes through React
  const bestRef = useRef(best);
  const onGameOverRef = useRef(onGameOver);
  const onStartRef = useRef(onStart);

  // The loop is started once per game, so it reads the latest callback through a ref
  // instead of capturing whatever the parent passed when the game began.
  useEffect(() => { onGameOverRef.current = onGameOver; }, [onGameOver]);
  useEffect(() => { onStartRef.current = onStart; }, [onStart]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current || PREVIEW;

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

    if (s.food) {
      const pulse = 1 + Math.sin(s.pulse) * 0.15;
      ctx.shadowColor = C.foodGlow;
      ctx.shadowBlur = 8;
      ctx.fillStyle = C.food;
      ctx.beginPath();
      ctx.arc(s.food.x * CELL + CELL / 2, s.food.y * CELL + CELL / 2, (CELL / 2 - 2) * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const len = s.snake.length;
    for (let i = len - 1; i >= 0; i--) { // tail first so the head paints on top
      const seg = s.snake[i];
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
        const [dx, dy] = s.dir;
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

  const finish = useCallback((s) => {
    if (s.over) return; // exactly one onGameOver per game
    s.over = true;
    const finalScore = s.score;
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
  }, []);

  const start = useCallback(() => {
    if (disabled) return;
    // Fired when a game begins (not when it ends), so a round counts even if
    // the player leaves mid-game - e.g. to reuse a one-time free round.
    onStartRef.current?.();
    const snake = initialSnake();
    stateRef.current = {
      snake,
      dir: DIR.RIGHT,
      queue: [],
      food: spawnFood(snake),
      score: 0,
      eaten: 0,
      speed: START_SPEED,
      pulse: 0,
      over: false,
      startedAt: performance.now(),
    };
    setScore(0);
    setNewBest(false);
    setPhase("playing");
  }, [disabled]);

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
      if (t - last >= s.speed) {
        last = t;
        const { alive, ate } = step(s);
        if (ate) setScore(s.score);
        if (!alive) {
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
        if (stateRef.current) queueTurn(stateRef.current, d);
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
    const onStart = (e) => {
      const t = e.touches[0];
      from = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onEnd = (e) => {
      const t = e.changedTouches[0];
      const s = stateRef.current;
      if (!from || !t || !s) { from = null; return; }
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      from = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
      if (Math.abs(dx) > Math.abs(dy)) queueTurn(s, dx > 0 ? DIR.RIGHT : DIR.LEFT);
      else queueTurn(s, dy > 0 ? DIR.DOWN : DIR.UP);
    };
    canvas.addEventListener("touchstart", onStart, { passive: true });
    canvas.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      canvas.removeEventListener("touchstart", onStart);
      canvas.removeEventListener("touchend", onEnd);
    };
  }, [phase]);

  const pill = PHASE_PILL[phase];

  return (
    <div className="fl-card" style={{ padding: 20 }}>
      <div className="fl-row--between" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <div className="fl-row" style={{ gap: 26 }}>
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
                        disabled={disabled} onClick={start}>
                  {startLabel}
                </button>
              </>
            ) : (
              <>
                <div className="fl-lbl">Game over</div>
                <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 38, fontWeight: 600, margin: "6px 0 4px" }}>
                  {score}
                </div>
                <div style={{ marginBottom: 18, minHeight: 20 }}>
                  {newBest && score > 0 ? (
                    <span className="fl-pill fl-pill--warn">New best</span>
                  ) : (
                    <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>Best {best}</span>
                  )}
                </div>
                <button type="button" className="fl-btn fl-btn--primary" style={{ minWidth: 140 }}
                        disabled={disabled} onClick={start}>
                  Play again
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="fl-mono" style={{ textAlign: "center", color: "var(--fl-fg-3)", fontSize: 11, marginTop: 12 }}>
        Arrow keys or WASD · swipe on touch
      </div>
    </div>
  );
}
