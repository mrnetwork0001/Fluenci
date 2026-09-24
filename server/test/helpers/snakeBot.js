// A simple Snake player for tests: breadth-first search to the food over the
// cells the body doesn't cover, otherwise any safe move. It records turns the
// way the browser must: [the step index before the step, dir], real turns only.
"use strict";

function chooseDir(core, g) {
  const { COLS, ROWS, DIRS, DIR_NAMES } = core;
  const head = g.snake[0];
  const cell = (x, y) => y * COLS + x;
  const blocked = new Set(g.snake.slice(0, -1).map((p) => cell(p.x, p.y))); // the tail moves away
  const allowedFirst = (name) => name === g.dir || core.canTurn(g.dir, name);
  const start = cell(head.x, head.y);
  const prev = new Map([[start, null]]);
  const queue = [start];
  const target = g.food ? cell(g.food.x, g.food.y) : -1;
  while (queue.length) {
    const c = queue.shift();
    if (c === target) {
      let at = c;
      let dir = null;
      while (prev.get(at)) { [at, dir] = [prev.get(at)[0], prev.get(at)[1]]; }
      return dir;
    }
    const x = c % COLS;
    const y = (c - x) / COLS;
    for (const name of DIR_NAMES) {
      if (c === start && !allowedFirst(name)) continue;
      const [dx, dy] = DIRS[name];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const n = cell(nx, ny);
      if (blocked.has(n) || prev.has(n)) continue;
      prev.set(n, [c, name]);
      queue.push(n);
    }
  }
  for (const name of [g.dir, ...DIR_NAMES]) {
    if (!allowedFirst(name)) continue;
    const [dx, dy] = DIRS[name];
    const nx = head.x + dx;
    const ny = head.y + dy;
    if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && !blocked.has(cell(nx, ny))) return name;
  }
  return g.dir;
}

/**
 * Plays one game for `seed`. Heads for food until `stopAtScore`, then goes
 * straight until the game ends. -> { inputs, state }
 * `onStep(prevState, dir, nextState)` sees every step (for lockstep comparisons).
 */
function playBot(core, seed, { stopAtScore = Infinity, maxSteps = 20000, onStep = null } = {}) {
  let g = core.makeGame(seed);
  const inputs = [];
  while (g.alive && g.steps < maxSteps) {
    let dir = g.score >= stopAtScore ? undefined : chooseDir(core, g);
    if (dir !== undefined && core.canTurn(g.dir, dir)) inputs.push([g.steps, dir]);
    else dir = undefined;
    const next = core.step(g, dir);
    if (onStep) onStep(g, dir, next);
    g = next;
  }
  return { inputs, state: g };
}

module.exports = { chooseDir, playBot };
