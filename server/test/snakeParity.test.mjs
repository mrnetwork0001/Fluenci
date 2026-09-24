// The browser's Snake core (ESM, frontend) and the server's copy (CommonJS)
// must be the same code and play every game identically, step by step.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const sync = require("../scripts/sync-snake-core.js");
const esm = await import(pathToFileURL(sync.SOURCE).href);
const cjs = require("../arcade/snakeCore.js");
const { playBot, chooseDir } = require("./helpers/snakeBot.js");

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEEDS = [0, 1, 2, 42, 1990, 123456789, 0x7fffffff, 0x80000000, 0xffffffff,
  ...Array.from({ length: 40 }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 0))];

test("the server copy is the frontend core, regenerated (run server/scripts/sync-snake-core.js)", () => {
  const source = fs.readFileSync(sync.SOURCE, "utf8");
  const target = fs.readFileSync(sync.TARGET, "utf8");
  assert.equal(sync.coreBody(target), sync.coreBody(source), "core bodies are byte-for-byte identical");
  assert.equal(target, sync.render(source), "the copy is exactly what the sync script writes");
  assert.equal(path.relative(path.resolve(here, ".."), sync.TARGET), path.join("arcade", "snakeCore.js"));
});

test("same exports and the same rules constants as the game", () => {
  assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
  for (const name of ["COLS", "ROWS", "POINTS", "START_SPEED", "MIN_SPEED", "SPEED_STEP", "SPEED_EVERY", "MAX_STEPS"]) {
    assert.equal(esm[name], cjs[name], name);
  }
  assert.deepEqual(
    { COLS: esm.COLS, ROWS: esm.ROWS, POINTS: esm.POINTS, START_SPEED: esm.START_SPEED, MIN_SPEED: esm.MIN_SPEED, SPEED_STEP: esm.SPEED_STEP },
    { COLS: 20, ROWS: 25, POINTS: 10, START_SPEED: 220, MIN_SPEED: 90, SPEED_STEP: 8 },
    "board, points and speed schedule as in SnakeGame.jsx"
  );
  assert.deepEqual(esm.DIRS, cjs.DIRS);
  assert.deepEqual(esm.DIR_NAMES, cjs.DIR_NAMES);
});

test("seeded bot games: identical states every step, and the same replay", () => {
  let steps = 0;
  let best = 0;
  for (const seed of SEEDS) {
    let other = cjs.makeGame(seed);
    const { inputs, state } = playBot(esm, seed, {
      onStep: (prev, dir, next) => {
        assert.deepStrictEqual(other, prev, `seed ${seed}: states before step ${prev.steps}`);
        other = cjs.step(other, dir);
        assert.deepStrictEqual(other, next, `seed ${seed}: states after step ${next.steps}`);
        steps++;
      },
    });
    assert.equal(state.alive, false);
    best = Math.max(best, state.score);
    const a = esm.replay(seed, inputs);
    const b = cjs.replay(seed, inputs);
    assert.deepStrictEqual(a, b, `seed ${seed}: replay`);
    assert.equal(a.ok, true);
    assert.deepStrictEqual(a.state, state, `seed ${seed}: the replay lands on the played game`);
  }
  assert.ok(best >= 300, `long games reach higher speeds (best ${best})`);
  assert.ok(steps > 20000, `${steps} steps compared`);
});

test("mixed games (bot moves, random reverses and repeats, junk): identical states every step", () => {
  const junk = [undefined, null, "", "UP", "north", "constructor", "__proto__", 3, ["up"], { dir: "up" }];
  let steps = 0;
  for (const seed of SEEDS) {
    const rnd = mulberry(seed ^ 0x5bd1e995);
    let a = esm.makeGame(seed);
    let b = cjs.makeGame(seed);
    assert.deepStrictEqual(a, b, `seed ${seed}: new game`);
    while (a.alive && a.steps < 5000) {
      const r = rnd();
      const dir = r < 0.85 ? chooseDir(esm, a) : r < 0.97 ? esm.DIR_NAMES[Math.floor(rnd() * 4)] : junk[Math.floor(rnd() * junk.length)];
      a = esm.step(a, dir);
      b = cjs.step(b, dir);
      assert.deepStrictEqual(a, b, `seed ${seed}: after step ${a.steps} (dir ${String(dir)})`);
      steps++;
    }
    assert.deepStrictEqual(esm.step(a, "up"), a, "a finished game doesn't move");
  }
  assert.ok(steps > 5000, `${steps} steps compared`);
});

test("seeds are folded to uint32 the same way, and step() never mutates its input", () => {
  for (const seed of ["123", -1, 2 ** 32 + 5, 1.9, NaN, "junk"]) {
    assert.deepStrictEqual(esm.makeGame(seed), cjs.makeGame(seed), `seed ${String(seed)}`);
  }
  assert.deepStrictEqual(esm.makeGame(-1), esm.makeGame(0xffffffff));
  const g = esm.makeGame(7);
  const copy = structuredClone(g);
  esm.step(g, "up");
  cjs.step(g, "down");
  assert.deepStrictEqual(g, copy);
});

test("replay rejects the same malformed logs in both copies", () => {
  const seed = 99;
  const { inputs } = playBot(esm, seed, { stopAtScore: 40 });
  const bad = {
    unordered: [inputs[1], inputs[0], ...inputs.slice(2)],
    duplicate: [inputs[0], inputs[0], ...inputs.slice(1)],
    afterEnd: [...inputs, [1e6, "up"]],
    badDir: [[0, "north"]],
    notArray: "nope",
    tooLong: Array.from({ length: 50 }, (_, i) => [i, ["down", "left", "up", "right"][i % 4]]),
  };
  for (const [name, log] of Object.entries(bad)) {
    const opts = name === "tooLong" ? { maxSteps: 50 } : undefined;
    const a = esm.replay(seed, log, opts);
    assert.deepStrictEqual(a, cjs.replay(seed, log, opts), name);
    assert.equal(a.ok, false, name);
    assert.equal(a.code, name === "tooLong" ? "too_long" : "mismatch", name);
  }
});
