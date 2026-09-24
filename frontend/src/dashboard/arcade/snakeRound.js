import { makeGame, step, canTurn } from "./snakeCore.js";

/**
 * Fluenci Arcade: one Snake round as the browser plays it.
 *
 * snakeCore.js holds the rules; this adds what only the player's side has: the
 * turns buffered between two steps, and the turn log a scored round sends to
 * the server, which replays it from the same seed. No DOM and no React, so a
 * test can play a round exactly the way SnakeGame.jsx does and check that the
 * server accepts the log it records.
 *
 *   const round = newRound(seed);
 *   queueTurn(round, "up");        // on every key press or swipe
 *   advance(round);                // on every tick (every round.game.speed ms)
 *   if (!round.game.alive) send({ inputs: round.inputs, score: round.game.score });
 *
 * A round is a mutable holder (the game loop never goes through React);
 * round.game itself is only ever replaced, never changed.
 */

// Two buffered turns, so a quick "up, left" inside one step is not lost.
const MAX_QUEUED = 2;

/** A new round: the core game, no buffered turns, an empty log. */
export function newRound(seed) {
  return { game: makeGame(seed), queue: [], inputs: [] };
}

/**
 * Buffers a turn (a direction name). Each one is checked against the turn
 * before it, so it can never fold the snake onto itself: the same way or
 * straight back is ignored, as is anything past two buffered turns.
 * Returns whether the turn was buffered.
 */
export function queueTurn(round, dir) {
  if (round.queue.length >= MAX_QUEUED) return false;
  const last = round.queue.length ? round.queue[round.queue.length - 1] : round.game.dir;
  if (!canTurn(last, dir)) return false;
  round.queue.push(dir);
  return true;
}

/**
 * One tick: takes the next buffered turn, logs it as [step index before this
 * step, dir] when it is a real turn, then moves. Returns { ate }.
 */
export function advance(round) {
  const next = round.queue.length ? round.queue.shift() : undefined;
  const dir = next !== undefined && canTurn(round.game.dir, next) ? next : undefined;
  if (dir !== undefined) round.inputs.push([round.game.steps, dir]);
  const before = round.game.score;
  round.game = step(round.game, dir);
  return { ate: round.game.score !== before };
}

/** A seed for a round nobody scores (a free round, or no server): any uint32. */
export function localSeed() {
  try {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  } catch {
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }
}
