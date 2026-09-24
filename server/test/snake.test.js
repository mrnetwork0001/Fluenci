"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../arcade/snakeCore");
const { createSnakeService, TICKET_TTL_MS, MAX_STEPS } = require("../arcade/snake");
const { playBot } = require("./helpers/snakeBot");

const ALICE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BOB = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

function fixture(opts = {}) {
  const clock = { t: 1_800_000_000_000 };
  const svc = createSnakeService({ now: () => clock.t, ...opts });
  return { svc, clock };
}

/** Starts a ticket and plays a bot game on its seed. */
function played(svc, address = ALICE, botOpts = {}) {
  const t = svc.start(address);
  const game = playBot(core, t.seed, botOpts);
  return { ...t, ...game };
}

test("start: a random ticket and a uint32 seed", () => {
  const { svc, clock } = fixture();
  const a = svc.start(ALICE);
  const b = svc.start(ALICE);
  assert.match(a.ticket, /^[0-9a-f]{32}$/);
  assert.notEqual(a.ticket, b.ticket);
  assert.ok(Number.isInteger(a.seed) && a.seed >= 0 && a.seed <= 0xffffffff);
  assert.equal(a.issuedAt, new Date(clock.t).toISOString());
});

test("legit seeded games are accepted (played at game speed)", () => {
  const { svc, clock } = fixture();
  let total = 0;
  for (let i = 0; i < 25; i++) {
    const g = played(svc, ALICE, { stopAtScore: i % 3 === 0 ? 50 : Infinity });
    clock.t += g.state.timeMs; // exactly the game's minimum duration
    const r = svc.finish(ALICE, { ticket: g.ticket, inputs: g.inputs, score: g.state.score });
    assert.equal(r.accepted, true, `game ${i} (score ${g.state.score}) accepted: ${JSON.stringify(r)}`);
    assert.equal(r.score, g.state.score);
    assert.equal(r.minDurationMs, g.state.timeMs);
    total += g.state.score;
  }
  assert.ok(total > 0, "the bot scores");
  // A game with no turns at all (straight into the wall) is still a valid game.
  const t = svc.start(ALICE);
  const straight = core.replay(t.seed, []).state;
  assert.equal(straight.steps, 10, "10 cells to the wall");
  clock.t += straight.timeMs;
  assert.equal(svc.finish(ALICE, { ticket: t.ticket, inputs: [], score: straight.score }).accepted, true);
});

test("altered score is rejected", () => {
  const { svc, clock } = fixture();
  for (const delta of [10, -10, 1, 1000]) {
    const g = played(svc);
    clock.t += g.state.timeMs * 2;
    const r = svc.finish(ALICE, { ticket: g.ticket, inputs: g.inputs, score: g.state.score + delta });
    assert.deepEqual(r, { accepted: false, code: "mismatch" }, `score ${delta > 0 ? "+" : ""}${delta}`);
  }
  for (const score of ["100", 10.5, -10, null, undefined]) {
    const g = played(svc);
    clock.t += g.state.timeMs * 2;
    assert.deepEqual(svc.finish(ALICE, { ticket: g.ticket, inputs: g.inputs, score }), { accepted: false, code: "mismatch" },
      `score ${JSON.stringify(score)}`);
  }
});

test("altered inputs are rejected", () => {
  const { svc, clock } = fixture();
  const variants = {
    "one turn changed": (inputs, seed, score) => {
      // The first single-turn change that gives the replay a different score.
      for (let i = 0; i < inputs.length; i++) {
        for (const dir of core.DIR_NAMES) {
          const alt = inputs.map((e, j) => (j === i ? [e[0], dir] : e));
          const r = core.replay(seed, alt);
          if (!r.ok || r.state.score !== score) return alt;
        }
      }
      throw new Error("no altering turn found");
    },
    "one turn dropped": (inputs, seed, score) => {
      for (let i = 0; i < inputs.length; i++) {
        const alt = inputs.filter((_, j) => j !== i);
        const r = core.replay(seed, alt);
        if (!r.ok || r.state.score !== score) return alt;
      }
      throw new Error("no altering drop found");
    },
    "a turn one step late": (inputs, seed, score) => {
      for (let i = 0; i < inputs.length; i++) {
        const alt = inputs.map((e, j) => (j === i ? [e[0] + 1, e[1]] : e));
        const r = core.replay(seed, alt);
        if (!r.ok || r.state.score !== score) return alt;
      }
      throw new Error("no altering delay found");
    },
    "all turns removed": () => [],
    "turns out of order": (inputs) => [inputs[1], inputs[0], ...inputs.slice(2)],
    "duplicate step index": (inputs) => [inputs[0], [inputs[0][0], inputs[0][1]], ...inputs.slice(1)],
    "a turn after the game ended": (inputs, seed) => [...inputs, [core.replay(seed, inputs).state.steps + 5, "up"]],
    "unknown direction": (inputs) => [[inputs[0][0], "north"], ...inputs.slice(1)],
    "inherited property as direction": (inputs) => [[inputs[0][0], "constructor"], ...inputs.slice(1)],
    "negative step": (inputs) => [[-1, "up"], ...inputs],
    "fractional step": (inputs) => [[0.5, "up"], ...inputs.slice(1)],
    "object instead of pair": (inputs) => [{ step: inputs[0][0], dir: inputs[0][1] }, ...inputs.slice(1)],
    "not an array": () => "up,down",
  };
  for (const [name, alter] of Object.entries(variants)) {
    const g = played(svc, ALICE, { stopAtScore: 60 });
    assert.ok(g.inputs.length >= 2 && g.state.score > 0, "a game with turns and a score");
    const inputs = alter(g.inputs, g.seed, g.state.score);
    clock.t += g.state.timeMs * 2;
    const r = svc.finish(ALICE, { ticket: g.ticket, inputs, score: g.state.score });
    assert.deepEqual(r, { accepted: false, code: "mismatch" }, name);
  }
});

test("time-compressed finish is rejected as too_fast", () => {
  const { svc, clock } = fixture();
  const g = played(svc, ALICE, { stopAtScore: 80 });
  clock.t += Math.floor(g.state.timeMs * 0.5);
  assert.deepEqual(svc.finish(ALICE, { ticket: g.ticket, inputs: g.inputs, score: g.state.score }), { accepted: false, code: "too_fast" });

  const instant = played(svc);
  assert.deepEqual(svc.finish(ALICE, { ticket: instant.ticket, inputs: instant.inputs, score: instant.state.score }),
    { accepted: false, code: "too_fast" }, "finished the moment it started");

  // 90% of the minimum is the line.
  const edge = played(svc, ALICE, { stopAtScore: 80 });
  clock.t += Math.ceil(edge.state.timeMs * 0.9);
  assert.equal(svc.finish(ALICE, { ticket: edge.ticket, inputs: edge.inputs, score: edge.state.score }).accepted, true);
  const under = played(svc, ALICE, { stopAtScore: 80 });
  clock.t += Math.ceil(under.state.timeMs * 0.9) - 5;
  assert.equal(svc.finish(ALICE, { ticket: under.ticket, inputs: under.inputs, score: under.state.score }).code, "too_fast");
});

test("reused ticket is rejected", () => {
  const { svc, clock } = fixture();
  const g = played(svc);
  clock.t += g.state.timeMs;
  const body = { ticket: g.ticket, inputs: g.inputs, score: g.state.score };
  assert.equal(svc.finish(ALICE, body).accepted, true);
  assert.deepEqual(svc.finish(ALICE, body), { accepted: false, code: "bad_ticket" });

  // A rejected attempt uses the ticket up too, so a score can't be brute-forced on one seed.
  const h = played(svc);
  clock.t += h.state.timeMs;
  assert.equal(svc.finish(ALICE, { ticket: h.ticket, inputs: h.inputs, score: h.state.score + 10 }).code, "mismatch");
  assert.equal(svc.finish(ALICE, { ticket: h.ticket, inputs: h.inputs, score: h.state.score }).code, "bad_ticket");

  assert.equal(svc.finish(ALICE, { ticket: "f".repeat(32), inputs: [], score: 0 }).code, "bad_ticket", "unknown ticket");
  assert.equal(svc.finish(ALICE, { inputs: [], score: 0 }).code, "bad_ticket", "no ticket");
  assert.equal(svc.finish(ALICE, { ticket: { $ne: null }, inputs: [], score: 0 }).code, "bad_ticket", "not a string");
});

test("another wallet's ticket is rejected, and stays usable by its owner", () => {
  const { svc, clock } = fixture();
  const g = played(svc, ALICE);
  clock.t += g.state.timeMs;
  const body = { ticket: g.ticket, inputs: g.inputs, score: g.state.score };
  assert.deepEqual(svc.finish(BOB, body), { accepted: false, code: "bad_ticket" });
  assert.equal(svc.finish(ALICE.toLowerCase(), body).accepted, true, "the owner, in any letter case");
});

test("too_long: late finish, oversized log, endless game", () => {
  const { svc, clock } = fixture();
  const late = played(svc);
  clock.t += TICKET_TTL_MS + 1;
  assert.deepEqual(svc.finish(ALICE, { ticket: late.ticket, inputs: late.inputs, score: late.state.score }), { accepted: false, code: "too_long" });

  const huge = svc.start(ALICE);
  clock.t += 60000;
  const inputs = Array.from({ length: MAX_STEPS + 1 }, (_, i) => [i, i % 2 ? "up" : "right"]);
  assert.equal(svc.finish(ALICE, { ticket: huge.ticket, inputs, score: 0 }).code, "too_long");

  // A snake that circles a 2x2 square forever never ends; with the whole
  // 30 minutes elapsed the replay stops at the step limit.
  const small = fixture({ maxSteps: 400 });
  const loop = small.svc.start(ALICE);
  const cycle = ["down", "left", "up", "right"];
  const circling = Array.from({ length: 400 }, (_, i) => [i, cycle[i % 4]]);
  assert.equal(core.replay(loop.seed, circling, { maxSteps: 400 }).code, "too_long", "the loop survives 400 steps");
  small.clock.t += TICKET_TTL_MS;
  assert.equal(small.svc.finish(ALICE, { ticket: loop.ticket, inputs: circling, score: 0 }).code, "too_long");
});

test("an instant finish never costs a long replay", () => {
  const { svc, clock } = fixture();
  const loop = svc.start(ALICE);
  const cycle = ["down", "left", "up", "right"];
  const circling = Array.from({ length: MAX_STEPS }, (_, i) => [i, cycle[i % 4]]);
  clock.t += 1000;
  const t0 = process.hrtime.bigint();
  assert.equal(svc.finish(ALICE, { ticket: loop.ticket, inputs: circling, score: 0 }).code, "too_fast");
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 50, `replay capped by elapsed time (${ms.toFixed(1)} ms)`);
});

test("expired tickets are pruned", () => {
  const { svc, clock } = fixture();
  svc.start(ALICE);
  svc.start(BOB);
  assert.equal(svc.ticketCount(), 2);
  clock.t += TICKET_TTL_MS + 11 * 60 * 1000;
  svc.prune();
  assert.equal(svc.ticketCount(), 0);
});
