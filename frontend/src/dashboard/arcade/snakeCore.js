/**
 * Fluenci Arcade: the Snake rules, with no DOM and no React.
 *
 * This file is the one source of truth for how a game plays out. The browser
 * plays it, and the server replays a finished game with the same rules before a
 * score reaches the leaderboard. server/arcade/snakeCore.js is a CommonJS copy:
 * everything between the "core" markers must stay byte-for-byte identical, and
 * server/test/snakeParity.test.mjs checks that and runs seeded games through both.
 *
 * Everything that decides a game comes from the seed and the turns: food is
 * placed by a seeded PRNG (mulberry32) whose state lives in the game state, so
 * the same seed and the same turns always end on the same score.
 *
 *   let game = makeGame(seed);
 *   const turns = [];
 *   // on every tick (every game.speed ms), with the turn the player queued, if any:
 *   if (dir) turns.push([game.steps, dir]);   // the step index BEFORE this step
 *   game = step(game, dir);
 *   if (!game.alive) submit({ inputs: turns, score: game.score });
 *
 * step() never mutates the state it is given; it returns the next one.
 */

// --- core start ---
const COLS = 20;
const ROWS = 25;
const POINTS = 10;
const START_SPEED = 220;       // ms per step
const MIN_SPEED = 90;
const SPEED_STEP = 8;          // faster by this much every SPEED_EVERY food
const SPEED_EVERY = 5;
// Longest game a replay will run: 30 minutes at the fastest speed.
const MAX_STEPS = 20000;

const DIR_NAMES = ["up", "down", "left", "right"];
const DIRS = Object.freeze({
  up: Object.freeze([0, -1]),
  down: Object.freeze([0, 1]),
  left: Object.freeze([-1, 0]),
  right: Object.freeze([1, 0]),
});

const isDir = (d) => typeof d === "string" && DIR_NAMES.includes(d);

/** Seeds are unsigned 32-bit integers; anything else is folded into one. */
const normalizeSeed = (seed) => Number(seed) >>> 0;

// mulberry32: one uint32 of state. Advances `s.rng` and returns a float in [0, 1).
function random(s) {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The snake every game starts with: three cells in the middle, heading right. */
function initialSnake() {
  const x = Math.floor(COLS / 2);
  const y = Math.floor(ROWS / 2);
  return [{ x, y }, { x: x - 1, y }, { x: x - 2, y }];
}

// Random probing is fine while the board is mostly empty; the scan fallback keeps
// a near-full board from spinning forever. Returns null when no cell is free.
function spawnFood(s) {
  const taken = (x, y) => s.snake.some((p) => p.x === x && p.y === y);
  for (let i = 0; i < 60; i++) {
    const x = Math.floor(random(s) * COLS);
    const y = Math.floor(random(s) * ROWS);
    if (!taken(x, y)) return { x, y };
  }
  const free = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!taken(x, y)) free.push({ x, y });
  return free.length ? free[Math.floor(random(s) * free.length)] : null;
}

/** A turn from `from` to `to` counts only if it is a real direction change: never the same way or straight back. */
function canTurn(from, to) {
  if (!isDir(from) || !isDir(to)) return false;
  const [ax, ay] = DIRS[from];
  const [bx, by] = DIRS[to];
  if (ax === bx && ay === by) return false;
  return !(ax === -bx && ay === -by);
}

/** A new game for `seed`. Plain data only, so it can be copied, compared and serialised. */
function makeGame(seed) {
  const s = {
    seed: normalizeSeed(seed),
    rng: normalizeSeed(seed),
    snake: initialSnake(),
    dir: "right",
    food: null,
    score: 0,
    eaten: 0,
    speed: START_SPEED,
    steps: 0,       // steps taken so far; a turn is recorded against this index
    timeMs: 0,      // the least real time the steps so far can take (each waits `speed` first)
    alive: true,
  };
  s.food = spawnFood(s);
  return s;
}

/**
 * One movement step, turning to `dir` first when that is a real turn (anything
 * else - no turn, the same way, straight back, not a direction - goes straight on).
 * Returns the next state; a finished game is returned unchanged.
 */
function step(state, dir) {
  if (!state.alive) return state;
  const s = { ...state, snake: state.snake.slice() };
  if (canTurn(s.dir, dir)) s.dir = dir;
  s.steps += 1;
  s.timeMs += state.speed;

  const [dx, dy] = DIRS[s.dir];
  const head = { x: s.snake[0].x + dx, y: s.snake[0].y + dy };
  if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
    s.alive = false;
    return s;
  }

  const ate = !!s.food && head.x === s.food.x && head.y === s.food.y;
  // The tail moves out of the way this step unless we grow, so it is not an obstacle.
  const body = ate ? s.snake : s.snake.slice(0, -1);
  if (body.some((p) => p.x === head.x && p.y === head.y)) {
    s.alive = false;
    return s;
  }

  s.snake.unshift(head);
  if (ate) {
    s.eaten += 1;
    s.score += POINTS;
    if (s.eaten % SPEED_EVERY === 0 && s.speed > MIN_SPEED) s.speed = Math.max(MIN_SPEED, s.speed - SPEED_STEP);
    s.food = spawnFood(s);
    if (!s.food) s.alive = false; // board is full: nothing left to eat
  } else {
    s.snake.pop();
  }
  return s;
}

/**
 * Plays a recorded game again: `inputs` is [[stepIndex, dir], ...] with strictly
 * increasing step indexes, each turn applied at the start of that step. After
 * the last turn the snake goes straight on until the game ends. Returns
 * { ok: true, state } for the finished game, or { ok: false, code } where code
 * is "mismatch" (a malformed log, or turns after the game ended) or "too_long"
 * (still alive after `maxSteps` steps).
 */
function replay(seed, inputs, { maxSteps = MAX_STEPS } = {}) {
  if (!Array.isArray(inputs)) return { ok: false, code: "mismatch" };
  let prev = -1;
  for (const entry of inputs) {
    if (!Array.isArray(entry) || entry.length !== 2) return { ok: false, code: "mismatch" };
    const [at, dir] = entry;
    if (!Number.isSafeInteger(at) || at <= prev || !isDir(dir)) return { ok: false, code: "mismatch" };
    prev = at;
  }
  let s = makeGame(seed);
  let next = 0;
  while (s.alive) {
    if (s.steps >= maxSteps) return { ok: false, code: "too_long" };
    let dir;
    if (next < inputs.length && inputs[next][0] === s.steps) dir = inputs[next++][1];
    s = step(s, dir);
  }
  if (next < inputs.length) return { ok: false, code: "mismatch" };
  return { ok: true, state: s };
}
// --- core end ---

export {
  COLS, ROWS, POINTS, START_SPEED, MIN_SPEED, SPEED_STEP, SPEED_EVERY, MAX_STEPS,
  DIR_NAMES, DIRS, isDir, normalizeSeed, initialSnake, canTurn, makeGame, step, replay,
};
