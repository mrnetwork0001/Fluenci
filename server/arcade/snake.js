// Snake tickets and score checks.
//
// A game starts with a ticket: a random seed the server remembers, bound to the
// wallet that asked for it. When the game ends the client sends the turns it
// played; the server replays them from the seed with the same rules as the
// browser (snakeCore.js) and only accepts a score the replay reaches, in no less
// time than those steps take to play.
"use strict";
const crypto = require("crypto");
const core = require("./snakeCore");

const TICKET_TTL_MS = 30 * 60 * 1000;
// Kept this much longer than the TTL so a late finish says "too_long", not "bad_ticket".
const TICKET_GRACE_MS = 10 * 60 * 1000;
// A replay can't be longer than the ticket allows at the fastest speed.
const MAX_STEPS = Math.ceil(TICKET_TTL_MS / core.MIN_SPEED);
// At most one turn per step.
const MAX_INPUTS = MAX_STEPS;
// Real time between start and finish must be at least this share of the replay's minimum.
const MIN_TIME_RATIO = 0.9;

function createSnakeService({
  now = Date.now,
  ticketTtlMs = TICKET_TTL_MS,
  graceMs = TICKET_GRACE_MS,
  maxSteps = MAX_STEPS,
  maxInputs = MAX_INPUTS,
  minTimeRatio = MIN_TIME_RATIO,
  maxTickets = 50000,
} = {}) {
  const tickets = new Map(); // ticket -> { key, seed, issuedAt }, oldest first

  function prune() {
    const t = now();
    for (const [id, entry] of tickets) if (t - entry.issuedAt > ticketTtlMs + graceMs) tickets.delete(id);
  }

  /** A new single-use ticket for `address`. */
  function start(address) {
    const ticket = crypto.randomBytes(16).toString("hex");
    const seed = crypto.randomBytes(4).readUInt32BE(0);
    const issued = now();
    tickets.set(ticket, { key: String(address).toLowerCase(), seed, issuedAt: issued });
    while (tickets.size > maxTickets) tickets.delete(tickets.keys().next().value);
    return { ticket, seed, issuedAt: new Date(issued).toISOString() };
  }

  /**
   * Checks a finished game for `address`.
   * -> { accepted: true, score, minDurationMs, steps } |
   *    { accepted: false, code: "bad_ticket" | "mismatch" | "too_fast" | "too_long" }
   * The ticket is used up by any attempt from its own wallet, accepted or not.
   */
  function finish(address, { ticket, inputs, score } = {}) {
    const entry = typeof ticket === "string" ? tickets.get(ticket) : null;
    // Another wallet's ticket is refused without using it up.
    if (!entry || entry.key !== String(address).toLowerCase()) return { accepted: false, code: "bad_ticket" };
    tickets.delete(ticket);

    const elapsed = now() - entry.issuedAt;
    if (elapsed > ticketTtlMs) return { accepted: false, code: "too_long" };
    if (!Array.isArray(inputs)) return { accepted: false, code: "mismatch" };
    if (inputs.length > maxInputs) return { accepted: false, code: "too_long" };
    if (!Number.isSafeInteger(score) || score < 0) return { accepted: false, code: "mismatch" };

    // Every step takes at least MIN_SPEED ms, so a game can't have more steps
    // than the time since the ticket allows. Capping the replay there keeps an
    // instant finish from costing a full 30-minute replay; a game that needs
    // more steps than that finished too fast by definition.
    const stepBudget = Math.floor(elapsed / (minTimeRatio * core.MIN_SPEED));
    const limit = Math.min(maxSteps, stepBudget);
    const result = core.replay(entry.seed, inputs, { maxSteps: limit });
    if (!result.ok) {
      if (result.code === "too_long" && limit < maxSteps) return { accepted: false, code: "too_fast" };
      return { accepted: false, code: result.code };
    }
    if (result.state.score !== score) return { accepted: false, code: "mismatch" };
    if (elapsed < minTimeRatio * result.state.timeMs) return { accepted: false, code: "too_fast" };
    return { accepted: true, score, minDurationMs: result.state.timeMs, steps: result.state.steps };
  }

  const timer = setInterval(prune, 60 * 1000);
  timer.unref?.();

  return { start, finish, prune, ticketCount: () => tickets.size };
}

module.exports = { TICKET_TTL_MS, MAX_STEPS, MAX_INPUTS, MIN_TIME_RATIO, createSnakeService };
