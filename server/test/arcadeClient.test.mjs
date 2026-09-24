// The app's side of the Arcade against the real routes: the frontend's own
// sign-in, Snake round and leaderboard code (frontend/src/dashboard/arcade/
// arcadeApi.js and snakeRound.js) talking to mountArcade over HTTP. Rounds are
// played the way SnakeGame.jsx plays them - key presses buffered between ticks,
// one advance() per tick - and the server must accept exactly the turn log they
// record. The snake service and the leaderboard run on a fake clock, so a
// round's minimum play time passes instantly.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const FRONT = path.resolve(here, "../../frontend/src/dashboard/arcade");
const load = (f) => import(pathToFileURL(path.join(FRONT, f)).href);
const api = await load("arcadeApi.js");
const ui = await load("snakeRound.js");
const esmCore = await load("snakeCore.js");

const express = require("express");
const { ethers } = require("ethers");
const cjsCore = require("../arcade/snakeCore.js");
const { createAuth, signInMessage } = require("../auth.js");
const { mountArcade } = require("../arcade/routes.js");
const { createSnakeService } = require("../arcade/snake.js");
const { createLeaderboard, isoWeek } = require("../arcade/leaderboard.js");
const { chooseDir } = require("./helpers/snakeBot.js");

const SECRET = "arcade-client-test-secret-0123456789abcdef";
const NAMES = ["up", "down", "left", "right"];
// A Wednesday noon (UTC), so hours of fake play stay inside one ISO week.
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);

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

/**
 * One round exactly as SnakeGame.jsx drives it: between two ticks the player
 * presses nothing, one key or a burst of keys (a sensible move, or any
 * direction at all - repeats and reverses included), each through queueTurn();
 * each tick is one advance(). After `stopPressingAt` steps the player lets go
 * and the snake runs straight into a wall, as a real game always ends.
 */
function playLikeTheUi(seed, rngSeed, { skill = 0.8, stopPressingAt = 4000 } = {}) {
  const rand = mulberry(rngSeed);
  const round = ui.newRound(seed);
  while (round.game.alive) {
    if (round.game.steps < stopPressingAt) {
      const presses = rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 3);
      for (let i = 0; i < presses; i++) {
        const dir = rand() < skill ? chooseDir(esmCore, round.game) : NAMES[Math.floor(rand() * 4)];
        ui.queueTurn(round, dir);
      }
    }
    ui.advance(round);
    assert.ok(round.game.steps <= 40000, "a round always ends");
  }
  return round;
}

/** A wallet as the browser sees it: EIP-1193 personal_sign of hex-encoded UTF-8, as useFluenciV4.signMessage sends. */
function eip1193(wallet, { reject = false, signer = wallet } = {}) {
  return {
    requests: 0,
    async request({ method, params }) {
      this.requests++;
      assert.equal(method, "personal_sign");
      const [hex, address] = params;
      assert.ok(api.sameAddress(address, wallet.address), "asks the connected wallet to sign");
      if (reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      return signer.signMessage(ethers.getBytes(hex));
    },
  };
}
const signWith = (provider, account) => (message) =>
  provider.request({ method: "personal_sign", params: [ethers.hexlify(ethers.toUtf8Bytes(message)), account] });

const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

async function startApp({ holders }) {
  const clock = { t: T0 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fluenci-arcade-client-"));
  dirs.push(dir);
  const passChecker = {
    async check(address) {
      return holders.some((h) => h.address === address) ? { valid: true, reason: "ok" } : { valid: false, reason: "no-subscription" };
    },
  };
  const app = express();
  const snake = createSnakeService({ now: () => clock.t });
  const leaderboard = createLeaderboard({ file: path.join(dir, "arcade.json"), now: () => clock.t, log: { error() {} } });
  mountArcade(app, { auth: createAuth({ secret: SECRET }), passChecker, snake, leaderboard });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  return { apiBase: `http://127.0.0.1:${server.address().port}`, clock, close: () => new Promise((r) => server.close(r)) };
}

test("the UI's round logic: buffered turns, a real-turns-only log, same game as the server's core", () => {
  // A quick "up, left" inside one step keeps both turns, one per step.
  const r = ui.newRound(7);
  assert.equal(r.game.dir, "right");
  assert.equal(ui.queueTurn(r, "right"), false, "the same way is ignored");
  assert.equal(ui.queueTurn(r, "left"), false, "straight back is ignored");
  assert.equal(ui.queueTurn(r, "up"), true);
  assert.equal(ui.queueTurn(r, "down"), false, "checked against the turn before it, not the snake");
  assert.equal(ui.queueTurn(r, "left"), true);
  assert.equal(ui.queueTurn(r, "down"), false, "two buffered turns at most");
  ui.advance(r);
  ui.advance(r);
  ui.advance(r);
  assert.deepEqual(r.inputs, [[0, "up"], [1, "left"]]);
  assert.equal(r.game.dir, "left");

  let games = 0;
  let sped = 0;
  let top = 0;
  for (let i = 0; i < 150; i++) {
    const seed = Math.imul(i + 11, 2654435761) >>> 0;
    const round = playLikeTheUi(seed, i + 1, { skill: 0.6 + (i % 5) * 0.09 });
    // Every logged entry is a real turn at the step it names, in order.
    let g = esmCore.makeGame(seed);
    let next = 0;
    while (g.alive) {
      let dir;
      if (next < round.inputs.length && round.inputs[next][0] === g.steps) {
        dir = round.inputs[next++][1];
        assert.ok(esmCore.canTurn(g.dir, dir), `seed ${seed}: step ${g.steps} logs a real turn`);
      }
      g = esmCore.step(g, dir);
    }
    assert.equal(next, round.inputs.length, `seed ${seed}: no entry after the game ended, none out of order`);
    // What goes over the wire is JSON; the server's core must end on the very same game.
    const replayed = cjsCore.replay(seed, JSON.parse(JSON.stringify(round.inputs)));
    assert.equal(replayed.ok, true, `seed ${seed}: ${replayed.code}`);
    assert.equal(JSON.stringify(replayed.state), JSON.stringify(round.game), `seed ${seed}: identical final state`);
    games++;
    if (round.game.speed < esmCore.START_SPEED) sped++;
    top = Math.max(top, round.game.score);
  }
  assert.equal(games, 150);
  assert.ok(sped > 0 && top >= 100, `some rounds sped up (${sped}), best ${top}`);
  for (let i = 0; i < 20; i++) {
    const s = ui.localSeed();
    assert.ok(Number.isSafeInteger(s) && s >= 0 && s <= 0xffffffff, "local seeds are uint32");
  }
});

test("isSignInMessage: only the server's sign-in text for this exact wallet", () => {
  const w = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const msg = signInMessage({ address: w.address, nonce: "ab".repeat(16), issuedAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + 300000).toISOString() });
  assert.equal(api.isSignInMessage(msg, w.address), true);
  assert.equal(api.isSignInMessage(msg, w.address.toLowerCase()), true, "a lowercase account (as MetaMask reports it) still matches");
  assert.equal(api.isSignInMessage(msg, other.address), false);
  assert.equal(api.isSignInMessage(msg.replace("fluenci.xyz", "evil.example"), w.address), false);
  assert.equal(api.isSignInMessage("Transfer everything", w.address), false);
  assert.equal(api.isSignInMessage(msg, "not-an-address"), false);
});

test("sign-in from the app: one personal_sign, a token for that wallet; refusals are worded", async () => {
  const wallet = ethers.Wallet.createRandom();
  const app = await startApp({ holders: [wallet] });
  try {
    const account = wallet.address.toLowerCase(); // how an injected wallet reports it
    const provider = eip1193(wallet);
    const ok = await api.signInToArcade({ apiBase: app.apiBase, address: account, sign: signWith(provider, account) });
    assert.equal(ok.ok, true, ok.message);
    assert.equal(provider.requests, 1, "exactly one wallet prompt");
    assert.equal(ok.address, wallet.address);
    assert.ok(ok.token.includes(".") && Date.parse(ok.expiresAt) > Date.now());

    const refused = eip1193(wallet, { reject: true });
    const no = await api.signInToArcade({ apiBase: app.apiBase, address: account, sign: signWith(refused, account) });
    assert.deepEqual([no.ok, no.rejected, no.message], [false, true, "Sign-in was cancelled in your wallet."]);

    const wrong = eip1193(wallet, { signer: ethers.Wallet.createRandom() });
    const bad = await api.signInToArcade({ apiBase: app.apiBase, address: account, sign: signWith(wrong, account) });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /wasn't made by 0x/);

    const silent = await api.signInToArcade({ apiBase: app.apiBase, address: account, sign: () => new Promise(() => {}), signTimeoutMs: 50 });
    assert.equal(silent.ok, false);
    assert.match(silent.message, /didn't respond/);

    const down = await api.signInToArcade({ apiBase: "http://127.0.0.1:9", address: account, sign: signWith(provider, account) });
    assert.equal(down.ok, false);
    assert.match(down.message, /Couldn't reach the Fluenci server/);
  } finally { await app.close(); }
});

test("scored rounds from the app: the exact log the UI records is accepted with the exact score", async () => {
  const wallet = ethers.Wallet.createRandom();
  const stranger = ethers.Wallet.createRandom();
  const app = await startApp({ holders: [wallet] });
  try {
    const account = wallet.address.toLowerCase();
    const session = await api.signInToArcade({ apiBase: app.apiBase, address: account, sign: signWith(eip1193(wallet), account) });
    assert.equal(session.ok, true, session.message);
    const { token } = session;

    let best = 0;
    for (let i = 0; i < 30; i++) {
      const start = await api.startSnakeRound({ apiBase: app.apiBase, token });
      assert.equal(start.ok, true, start.message);
      const round = playLikeTheUi(start.seed, 1000 + i, { skill: 0.7 + (i % 4) * 0.08, stopPressingAt: 60 + i * 20 });
      // The UI can't finish sooner than its steps take: each waits its speed.
      app.clock.t += round.game.timeMs;
      const done = await api.finishSnakeRound({
        apiBase: app.apiBase, token, ticket: start.ticket, inputs: round.inputs, score: round.game.score, durationMs: round.game.timeMs,
      });
      assert.equal(done.ok, true, `round ${i} (seed ${start.seed}): ${done.message}`);
      assert.equal(done.score, round.game.score);
      best = Math.max(best, round.game.score);
      assert.equal(done.best, best);
      assert.equal(done.rank, best > 0 ? 1 : null);
      assert.equal(done.week, isoWeek(T0));
    }
    assert.ok(best > 0);

    const mine = await api.fetchLeaderboard({ apiBase: app.apiBase, token });
    assert.equal(mine.ok, true);
    assert.deepEqual(mine.entries, [{ address: wallet.address, score: best }]);
    assert.deepEqual(mine.you, { best, rank: 1 });
    assert.equal(api.weekLabel(mine.week), `Week ${Number(isoWeek(T0).slice(6))}`);
    const anon = await api.fetchLeaderboard({ apiBase: app.apiBase });
    assert.equal(anon.you, null, "without a token there is no 'you'");

    // The app's wording for what the server refuses.
    const s1 = await api.startSnakeRound({ apiBase: app.apiBase, token });
    const r1 = playLikeTheUi(s1.seed, 77, { stopPressingAt: 40 });
    const fast = await api.finishSnakeRound({ apiBase: app.apiBase, token, ticket: s1.ticket, inputs: r1.inputs, score: r1.game.score, durationMs: 1 });
    assert.deepEqual([fast.ok, fast.code], [false, "too_fast"]);
    assert.match(fast.message, /faster than it can be played/);
    const again = await api.finishSnakeRound({ apiBase: app.apiBase, token, ticket: s1.ticket, inputs: r1.inputs, score: r1.game.score, durationMs: 1 });
    assert.equal(again.code, "bad_ticket");

    const s2 = await api.startSnakeRound({ apiBase: app.apiBase, token });
    const r2 = playLikeTheUi(s2.seed, 78, { stopPressingAt: 40 });
    app.clock.t += r2.game.timeMs;
    const lie = await api.finishSnakeRound({ apiBase: app.apiBase, token, ticket: s2.ticket, inputs: r2.inputs, score: r2.game.score + 10, durationMs: 1 });
    assert.deepEqual([lie.ok, lie.code], [false, "mismatch"]);

    const expired = await api.startSnakeRound({ apiBase: app.apiBase, token: `${token}x` });
    assert.deepEqual([expired.ok, expired.unauthorized, expired.status], [false, true, 401]);

    const other = await api.signInToArcade({ apiBase: app.apiBase, address: stranger.address, sign: signWith(eip1193(stranger), stranger.address) });
    const noPass = await api.startSnakeRound({ apiBase: app.apiBase, token: other.token });
    assert.deepEqual([noPass.ok, noPass.code, noPass.unauthorized], [false, "no_pass", false]);
    assert.match(noPass.message, /doesn't see a valid Arcade Pass/);
  } finally { await app.close(); }
});
