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
const { createAuth, parseSignInMessage } = require("../auth");
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
    const { message, nonce } = n.body;
    const v = await call("POST", "/auth/verify", { body: { address: wallet.address, nonce, message, signature: await wallet.signMessage(message) } });
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
        ["POST", "/auth/verify", { address: holder.address, nonce: "a".repeat(32), signature: "0x" }],
        ["GET", "/arcade/pass"],
        ["POST", "/arcade/snake/start"],
        ["POST", "/arcade/snake/finish", { ticket: "x", inputs: [], score: 0 }],
      ]) {
        const r = await app.call(method, p, { body, token: "a.b" });
        assert.equal(r.status, 503, `${method} ${p}`);
        assert.equal(r.body.code, "not_configured", `${method} ${p}`);
        assert.equal(typeof r.body.error, "string");
      }
      const board = await app.call("GET", "/arcade/leaderboard");
      assert.equal(board.status, 200, "the public leaderboard still answers");
      assert.equal(board.body.you, null);
      // A token can't be accepted without the secret: 401, so the app drops it (F7).
      const withToken = await app.call("GET", "/arcade/leaderboard", { token: "a.b" });
      assert.deepEqual([withToken.status, withToken.body.code], [401, "unauthorized"]);
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
    const { message, nonce } = n.body;
    // F4: an EIP-4361 message for www.fluenci.xyz, for the checksummed wallet, with this nonce.
    const parsed = parseSignInMessage(message);
    assert.deepEqual([parsed.domain, parsed.uri, parsed.version, parsed.chainId, parsed.address, parsed.nonce, parsed.expirationTime],
      ["www.fluenci.xyz", "https://www.fluenci.xyz", "1", 1990, holder.address, nonce, n.body.expiresAt]);

    const sig = await holder.signMessage(message);
    const bad = await app.call("POST", "/auth/verify", { body: { address: holder.address, nonce, signature: await lapsed.signMessage(message) } });
    assert.deepEqual([bad.status, bad.body.code], [401, "bad_signature"]);
    const edited = await app.call("POST", "/auth/verify", { body: { address: holder.address, nonce, message: message.replace("Version: 1", "Version: 1 "), signature: sig } });
    assert.deepEqual([edited.status, edited.body.code], [400, "bad_message"]);
    const ok = await app.call("POST", "/auth/verify", { body: { address: holder.address, nonce, message, signature: sig } });
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(ok.body).sort(), ["address", "expiresAt", "token"]);
    assert.equal(ok.body.address, holder.address);
    const reused = await app.call("POST", "/auth/verify", { body: { address: holder.address, nonce, signature: sig } });
    assert.deepEqual([reused.status, reused.body.code], [401, "expired_nonce"]);
    assert.match(reused.body.error, /no longer has this sign-in request/);

    for (const body of [{}, { address: "0x123" }, { address: 42 }]) {
      const r = await app.call("POST", "/auth/nonce", { body });
      assert.deepEqual([r.status, r.body.code], [400, "bad_request"], JSON.stringify(body));
    }
    // F3: verify needs the nonce (or the message) as well as the signature.
    for (const body of [
      { address: holder.address },
      { address: holder.address, signature: sig },
      { address: holder.address, signature: sig, nonce: "" },
      { address: holder.address, signature: sig, nonce: 42 },
      { address: holder.address, signature: sig, nonce: "x".repeat(200) },
      { address: holder.address, signature: sig, message: 42 },
    ]) {
      const r = await app.call("POST", "/auth/verify", { body });
      assert.deepEqual([r.status, r.body.code], [400, "bad_request"], JSON.stringify(body).slice(0, 80));
    }
    const junk = await app.call("POST", "/auth/nonce", { raw: "{nope" });
    assert.deepEqual([junk.status, junk.body.code], [400, "bad_request"]);
  } finally { await app.close(); }
});

test("F3 over HTTP: nonce requests for someone else's wallet can't cancel their sign-in", async () => {
  const app = await startApp();
  try {
    // The victim asks for a nonce and opens their wallet...
    const mine = await app.call("POST", "/auth/nonce", { body: { address: holder.address } });
    // ...while someone else asks for nonces for the same wallet.
    const others = [];
    for (let i = 0; i < 6; i++) others.push(await app.call("POST", "/auth/nonce", { body: { address: holder.address } }));
    assert.deepEqual(others.map((r) => r.status), [200, 200, 200, 200, 429, 429]);
    assert.equal(others[4].body.code, "rate_address");
    assert.match(others[4].body.error, /already has 5 sign-in requests waiting/);
    // The victim's signature over their own message still signs in.
    const { message, nonce } = mine.body;
    const v = await app.call("POST", "/auth/verify", { body: { address: holder.address, nonce, message, signature: await holder.signMessage(message) } });
    assert.equal(v.status, 200);
    assert.equal(v.body.address, holder.address);
    // Someone else's nonce for this wallet can't be used with the victim's signature either.
    const theirs = others[0].body;
    const cross = await app.call("POST", "/auth/verify", { body: { address: holder.address, nonce: theirs.nonce, signature: await holder.signMessage(message) } });
    assert.deepEqual([cross.status, cross.body.code], [401, "bad_signature"]);
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
    // F7: a token that is sent but can't be accepted is 401, never an anonymous answer.
    for (const bad of ["x.y", `${token}x`]) {
      const bogus = await app.call("GET", "/arcade/leaderboard", { token: bad });
      assert.deepEqual([bogus.status, bogus.body.code, bogus.body.you], [401, "unauthorized", undefined], bad);
    }
    const stillValid = await app.call("GET", "/arcade/leaderboard", { token });
    assert.equal(stillValid.status, 200, "the valid token still reads the board");

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

test("F1: snake/start is limited per IP before the session check, and per wallet before the chain read", async () => {
  // Per IP, ahead of everything: unauthenticated floods get 429 without touching the session or the chain.
  const a = await startApp({ limits: { startIp: { windowMs: 600000, max: 3 } } });
  try {
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await a.call("POST", "/arcade/snake/start", { token: "junk.token" })).status);
    assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
    const r = await a.call("POST", "/arcade/snake/start");
    assert.deepEqual([r.status, r.body.code], [429, "rate_ip"]);
    assert.equal(a.passChecker.calls, 0);
  } finally { await a.close(); }

  // Per wallet, before the pass check: a wallet with no pass stops costing chain reads at its limit.
  const b = await startApp({ limits: { start: { windowMs: 3600000, max: 2 } } });
  try {
    const lt = await b.signIn(lapsed);
    const first = await b.call("POST", "/arcade/snake/start", { token: lt });
    const second = await b.call("POST", "/arcade/snake/start", { token: lt });
    assert.deepEqual([first.status, second.status], [403, 403]);
    assert.equal(b.passChecker.calls, 2);
    for (let i = 0; i < 5; i++) {
      const r = await b.call("POST", "/arcade/snake/start", { token: lt });
      assert.deepEqual([r.status, r.body.code], [429, "rate_address"]);
    }
    assert.equal(b.passChecker.calls, 2, "no pass check once the wallet is over its limit");
    // Another wallet has its own allowance.
    const ht = await b.signIn(holder);
    assert.equal((await b.call("POST", "/arcade/snake/start", { token: ht })).status, 200);
  } finally { await b.close(); }
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
