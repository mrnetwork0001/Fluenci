// The Arcade routes over HTTP, with a stand-in pass checker (the on-chain
// checker is covered by test/integration/arcade.integration.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { ethers } = require("ethers");
const core = require("../arcade/snakeCore");
const { createAuth } = require("../auth");
const { mountArcade } = require("../arcade/routes");
const { createSnakeService } = require("../arcade/snake");
const { createLeaderboard } = require("../arcade/leaderboard");
const { playBot } = require("./helpers/snakeBot");

const SECRET = "routes-test-secret-0123456789abcdefghij";
const holder = ethers.Wallet.createRandom();
const lapsed = ethers.Wallet.createRandom();
const flaky = ethers.Wallet.createRandom();
const dirs = [];
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

async function startApp({ secret = SECRET, merchantSet = true, limits = {} } = {}) {
  const clock = { t: Date.now() };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fluenci-routes-"));
  dirs.push(dir);
  const passChecker = {
    calls: 0,
    async check(address) {
      this.calls++;
      if (!merchantSet) return { valid: false, reason: "not-configured" };
      if (address === holder.address) return { valid: true, reason: "ok" };
      if (address === flaky.address) return { valid: false, reason: "unavailable" };
      return { valid: false, reason: address === lapsed.address ? "insufficient-allowance" : "no-subscription" };
    },
  };
  const app = express();
  const snake = createSnakeService({ now: () => clock.t });
  const leaderboard = createLeaderboard({ file: path.join(dir, "arcade.json"), now: () => clock.t, log: { error() {} } });
  mountArcade(app, { auth: createAuth({ secret }), passChecker, snake, leaderboard, limits });
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, token, raw } = {}) => {
    const headers = {};
    if (body !== undefined || raw !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(base + p, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const signIn = async (wallet) => {
    const n = await call("POST", "/auth/nonce", { body: { address: wallet.address } });
    const v = await call("POST", "/auth/verify", { body: { address: wallet.address, signature: await wallet.signMessage(n.body.message) } });
    return v.body.token;
  };
  return { call, signIn, clock, passChecker, close: () => new Promise((r) => server.close(r)) };
}

test("missing SESSION_SECRET: every sign-in and gated route answers 503 not_configured", async () => {
  for (const secret of ["", "too-short-secret"]) {
    const app = await startApp({ secret });
    try {
      for (const [method, p, body] of [
        ["POST", "/auth/nonce", { address: holder.address }],
        ["POST", "/auth/verify", { address: holder.address, signature: "0x" }],
        ["GET", "/arcade/pass"],
        ["POST", "/arcade/snake/start"],
        ["POST", "/arcade/snake/finish", { ticket: "x", inputs: [], score: 0 }],
      ]) {
        const r = await app.call(method, p, { body, token: "a.b" });
        assert.equal(r.status, 503, `${method} ${p}`);
        assert.equal(r.body.code, "not_configured", `${method} ${p}`);
        assert.equal(typeof r.body.error, "string");
      }
      const board = await app.call("GET", "/arcade/leaderboard", { token: "a.b" });
      assert.equal(board.status, 200, "the public leaderboard still answers");
      assert.equal(board.body.you, null);
      assert.equal(app.passChecker.calls, 0, "nothing reached the chain");
    } finally { await app.close(); }
  }
});

test("sign-in over HTTP: nonce, verify, and the error codes", async () => {
  const app = await startApp();
  try {
    const n = await app.call("POST", "/auth/nonce", { body: { address: holder.address.toLowerCase() } });
    assert.equal(n.status, 200);
    assert.deepEqual(Object.keys(n.body).sort(), ["expiresAt", "message", "nonce"]);
    assert.ok(n.body.message.includes(`\n${holder.address}\n`), "checksummed address in the message");
    assert.ok(n.body.message.includes(`Nonce: ${n.body.nonce}`));

    const sig = await holder.signMessage(n.body.message);
    const bad = await app.call("POST", "/auth/verify", { body: { address: holder.address, signature: await lapsed.signMessage(n.body.message) } });
    assert.deepEqual([bad.status, bad.body.code], [401, "bad_signature"]);
    const ok = await app.call("POST", "/auth/verify", { body: { address: holder.address, signature: sig } });
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(ok.body).sort(), ["address", "expiresAt", "token"]);
    assert.equal(ok.body.address, holder.address);
    const reused = await app.call("POST", "/auth/verify", { body: { address: holder.address, signature: sig } });
    assert.deepEqual([reused.status, reused.body.code], [401, "expired_nonce"]);

    for (const body of [{}, { address: "0x123" }, { address: 42 }]) {
      const r = await app.call("POST", "/auth/nonce", { body });
      assert.deepEqual([r.status, r.body.code], [400, "bad_request"], JSON.stringify(body));
    }
    const noSig = await app.call("POST", "/auth/verify", { body: { address: holder.address } });
    assert.deepEqual([noSig.status, noSig.body.code], [400, "bad_request"]);
    const junk = await app.call("POST", "/auth/nonce", { raw: "{nope" });
    assert.deepEqual([junk.status, junk.body.code], [400, "bad_request"]);
  } finally { await app.close(); }
});

test("GET /arcade/pass: 401 without a valid token, the checker's verdict with one", async () => {
  const app = await startApp();
  try {
    assert.deepEqual((await app.call("GET", "/arcade/pass")).body.code, "unauthorized");
    const noAuth = await app.call("GET", "/arcade/pass");
    assert.equal(noAuth.status, 401);
    assert.equal((await app.call("GET", "/arcade/pass", { token: "abc.def" })).status, 401);
    const t = await app.signIn(holder);
    assert.deepEqual((await app.call("GET", "/arcade/pass", { token: t })).body, { valid: true, reason: "ok" });
    const l = await app.signIn(lapsed);
    assert.deepEqual((await app.call("GET", "/arcade/pass", { token: l })).body, { valid: false, reason: "insufficient-allowance" });
    const f = await app.signIn(flaky);
    assert.deepEqual((await app.call("GET", "/arcade/pass", { token: f })).body, { valid: false, reason: "unavailable" });
  } finally { await app.close(); }
});

test("snake start needs a pass; finish is replay-checked; the leaderboard shows it", async () => {
  const app = await startApp();
  try {
    const lt = await app.signIn(lapsed);
    const noPass = await app.call("POST", "/arcade/snake/start", { token: lt });
    assert.deepEqual([noPass.status, noPass.body.code, noPass.body.reason], [403, "no_pass", "insufficient-allowance"]);
    const ft = await app.signIn(flaky);
    const down = await app.call("POST", "/arcade/snake/start", { token: ft });
    assert.deepEqual([down.status, down.body.code, down.body.reason], [403, "no_pass", "unavailable"], "a failed chain read fails closed");
    assert.equal((await app.call("POST", "/arcade/snake/start")).status, 401);

    const token = await app.signIn(holder);
    const s = await app.call("POST", "/arcade/snake/start", { token });
    assert.equal(s.status, 200);
    assert.deepEqual(Object.keys(s.body).sort(), ["issuedAt", "seed", "ticket"]);
    const game = playBot(core, s.body.seed, { stopAtScore: 60 });
    const body = { ticket: s.body.ticket, inputs: game.inputs, score: game.state.score, durationMs: game.state.timeMs };

    // Another wallet can't use it, and a game finished instantly is refused.
    assert.equal((await app.call("POST", "/arcade/snake/finish", { token: lt, body })).body.code, "bad_ticket");
    const fast = await app.call("POST", "/arcade/snake/finish", { token, body });
    assert.deepEqual([fast.status, fast.body.accepted, fast.body.code], [400, false, "too_fast"]);

    const s2 = await app.call("POST", "/arcade/snake/start", { token });
    const g2 = playBot(core, s2.body.seed, { stopAtScore: 60 });
    app.clock.t += g2.state.timeMs;
    const tampered = await app.call("POST", "/arcade/snake/finish", { token, body: { ticket: s2.body.ticket, inputs: g2.inputs, score: g2.state.score + 10 } });
    assert.deepEqual([tampered.status, tampered.body.accepted, tampered.body.code], [400, false, "mismatch"]);

    const s3 = await app.call("POST", "/arcade/snake/start", { token });
    const g3 = playBot(core, s3.body.seed, { stopAtScore: 60 });
    app.clock.t += g3.state.timeMs;
    const done = await app.call("POST", "/arcade/snake/finish", { token, body: { ticket: s3.body.ticket, inputs: g3.inputs, score: g3.state.score, durationMs: g3.state.timeMs } });
    assert.equal(done.status, 200);
    assert.deepEqual(done.body, { accepted: true, score: g3.state.score, best: g3.state.score, rank: 1, week: done.body.week });
    assert.match(done.body.week, /^\d{4}-W\d{2}$/);

    const pub = await app.call("GET", "/arcade/leaderboard");
    assert.deepEqual(pub.body, { week: done.body.week, entries: [{ address: holder.address, score: g3.state.score }], you: null });
    const mine = await app.call("GET", "/arcade/leaderboard", { token });
    assert.deepEqual(mine.body.you, { best: g3.state.score, rank: 1 });
    const other = await app.call("GET", "/arcade/leaderboard", { token: lt });
    assert.equal(other.body.you, null, "signed in, no score this week");
    const bogus = await app.call("GET", "/arcade/leaderboard", { token: "x.y" });
    assert.equal(bogus.status, 200, "a bad token on the public board is just anonymous");

    // Oversized turn logs and broken JSON are refused in the finish format.
    const huge = await app.call("POST", "/arcade/snake/finish", { token, raw: JSON.stringify({ ticket: "x", inputs: "a".repeat(600 * 1024), score: 0 }) });
    assert.deepEqual([huge.status, huge.body.accepted, huge.body.code], [400, false, "too_long"]);
    const broken = await app.call("POST", "/arcade/snake/finish", { token, raw: "{" });
    assert.deepEqual([broken.status, broken.body.accepted, broken.body.code], [400, false, "bad_request"]);
  } finally { await app.close(); }
});

test("no Arcade merchant on the server: gated routes answer 503 not_configured", async () => {
  const app = await startApp({ merchantSet: false });
  try {
    const token = await app.signIn(holder);
    const r = await app.call("POST", "/arcade/snake/start", { token });
    assert.deepEqual([r.status, r.body.code], [503, "not_configured"]);
    assert.deepEqual((await app.call("GET", "/arcade/pass", { token })).body, { valid: false, reason: "not-configured" });
  } finally { await app.close(); }
});

test("limits: starts per wallet per hour, sign-in per IP", async () => {
  const app = await startApp({ limits: { start: { windowMs: 3600000, max: 2 }, nonce: { windowMs: 600000, max: 4 } } });
  try {
    const token = await app.signIn(holder); // nonce #1
    assert.equal((await app.call("POST", "/arcade/snake/start", { token })).status, 200);
    assert.equal((await app.call("POST", "/arcade/snake/start", { token })).status, 200);
    const third = await app.call("POST", "/arcade/snake/start", { token });
    assert.deepEqual([third.status, third.body.code], [429, "rate_address"]);
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await app.call("POST", "/auth/nonce", { body: { address: lapsed.address } })).status);
    assert.deepEqual(statuses, [200, 200, 200, 429]);
    assert.equal((await app.call("POST", "/auth/nonce", { body: { address: lapsed.address } })).body.code, "rate_ip");
  } finally { await app.close(); }
});
