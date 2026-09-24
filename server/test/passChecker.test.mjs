// The on-chain pass checker (server/arcade/pass.js createPassChecker) against a
// fake registry: the work per check is bounded (F2), and whenever it answers
// something other than "unavailable", the answer is the one the browser's own
// rules (frontend/src/dashboard/arcadePass.js, loaded through Vite) give over
// all of the wallet's subscriptions, the way Arcade.jsx checks a pass.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, "../../frontend");
const { ethers } = require("ethers");
const { createPassChecker } = require("../arcade/pass.js");

const M = "0x1111111111111111111111111111111111111111";       // the Arcade merchant
const OTHER = ["0x3333333333333333333333333333333333333333", "0x4444444444444444444444444444444444444444"];
const Q = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";       // qUSDC
const USDT = "0xCB7bBC584475dce754a918ccD92FF6E0211f3CEE";
const JUNK = "0x2222222222222222222222222222222222222222";
const REGISTRY = "0x5555555555555555555555555555555555555555";
const MONTH = 2592000, WEEK = 604800, DAY = 86400;
const T0 = 1_800_000_000_000;

async function loadFrontend() {
  const { createServer } = await import(pathToFileURL(path.join(FRONTEND, "node_modules/vite/dist/node/index.js")).href);
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "fluenci-noenv-"));
  process.env.VITE_ARCADE_MERCHANT = M;
  delete process.env.VITE_QUSDC_ADDRESS;
  const vite = await createServer({
    root: FRONTEND, envDir, configFile: false, logLevel: "error", appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  const pass = await vite.ssrLoadModule("/src/dashboard/arcadePass.js");
  return { pass, close: async () => { await vite.close(); fs.rmSync(envDir, { recursive: true, force: true }); } };
}
const fe = await loadFrontend();
test.after(() => fe.close());

// Arcade.jsx's REASON_ORDER.
const REASON_ORDER = ["insufficient-balance", "insufficient-allowance", "capped-below-price", "paused", "disputed",
  "cliff", "underpriced", "unsupported-token", "bad-period", "cancelled"];
const rank = (r) => { const i = REASON_ORDER.indexOf(r); return i === -1 ? 99 : i; };

// ---- a fake registry + tokens, answering eth_call like the real contracts ----------------
const registryIface = new ethers.Interface([
  "function getSubscriberSubscriptions(address subscriber) view returns (bytes32[])",
  "function getSubscription(bytes32 subId) view returns (tuple(address subscriber,address merchant,address tokenAddress,uint256 amountPerPeriod,uint256 periodSeconds,uint256 billedSeconds,uint256 settledAmount,uint256 settledFees,uint256 feeDust,uint256 lastTickTimestamp,uint256 startTime,uint256 cliffTime,uint256 stopTime,bool active,bool pausedByAI,uint8 dispute))",
  "function previewOwed(bytes32 subId) view returns (uint256)",
  "function spendCaps(address subscriber, address merchant) view returns (uint256 maxAmount, uint256 periodSeconds, uint256 windowStart, uint256 spentInWindow, bool set)",
]);
const erc20Iface = new ethers.Interface([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

function fakeChain() {
  const subs = new Map();      // id -> sub (merchant never changes; inactive is final, as in RegistryV4)
  const lists = new Map();     // lowercase wallet -> [id]
  const caps = new Map();      // lowercase wallet -> { set, maxAmount, periodSeconds }
  const tokens = new Map();    // `${token}:${wallet}` lowercase -> { balance, allowance }
  const calls = {};
  let n = 0;
  const count = (name) => { calls[name] = (calls[name] || 0) + 1; };
  const chain = {
    subs, caps, tokens, calls,
    reset: () => { for (const k of Object.keys(calls)) delete calls[k]; },
    add(wallet, fields) {
      const id = ethers.zeroPadValue(ethers.toBeHex(++n), 32);
      subs.set(id, { subscriber: wallet, merchant: M, tokenAddress: Q, amountPerPeriod: 1_000_000n, periodSeconds: MONTH,
        cliffTime: 0, stopTime: 0, active: true, pausedByAI: false, dispute: 0, owed: 0n, ...fields });
      const key = wallet.toLowerCase();
      lists.set(key, [...(lists.get(key) || []), id]);
      return id;
    },
    addMany(wallet, count, fields) { for (let i = 0; i < count; i++) chain.add(wallet, fields); },
    setCap(wallet, cap) { caps.set(wallet.toLowerCase(), cap); },
    setFunds(wallet, token, balance, allowance = balance) { tokens.set(`${token}:${wallet}`.toLowerCase(), { balance, allowance }); },
    ids: (wallet) => lists.get(wallet.toLowerCase()) || [],
    runner: {
      async call(tx) {
        const to = tx.to.toLowerCase();
        if (to === REGISTRY.toLowerCase()) {
          const f = registryIface.parseTransaction({ data: tx.data });
          count(f.name);
          if (f.name === "getSubscriberSubscriptions") return registryIface.encodeFunctionResult(f.name, [chain.ids(f.args[0])]);
          if (f.name === "getSubscription") {
            const s = subs.get(f.args[0]);
            return registryIface.encodeFunctionResult(f.name, [[s.subscriber, s.merchant, s.tokenAddress, s.amountPerPeriod, s.periodSeconds,
              0, 0, 0, 0, 0, 0, s.cliffTime, s.stopTime, s.active, s.pausedByAI, s.dispute]]);
          }
          if (f.name === "previewOwed") return registryIface.encodeFunctionResult(f.name, [subs.get(f.args[0]).owed]);
          if (f.name === "spendCaps") {
            const c = caps.get(f.args[0].toLowerCase()) || { set: false, maxAmount: 0n, periodSeconds: 0 };
            return registryIface.encodeFunctionResult(f.name, [c.maxAmount, c.periodSeconds, 0, 0, c.set]);
          }
        }
        const f = erc20Iface.parseTransaction({ data: tx.data });
        count(f.name);
        if (f.name === "allowance") assert.equal(f.args[1].toLowerCase(), REGISTRY.toLowerCase(), "allowance is read for the registry");
        const st = tokens.get(`${to}:${f.args[0]}`.toLowerCase()) || { balance: 0n, allowance: 0n };
        return erc20Iface.encodeFunctionResult(f.name, [f.name === "balanceOf" ? st.balance : st.allowance]);
      },
    },
  };
  chain.runner.provider = chain.runner;
  return chain;
}

function checkerFor(chain, clock, extra = {}) {
  const logs = [];
  const checker = createPassChecker({
    merchant: M, getProvider: () => chain.runner, getRegistryAddress: () => REGISTRY, getChainId: () => 1990,
    now: () => clock.t, log: { warn: (m) => logs.push(m) }, ...extra,
  });
  return { checker, logs };
}

/** What the browser decides for `wallet` from the full chain state (Arcade.jsx checkPass over useFluenciV4's active rows). */
function reference(chain, wallet, nowMs) {
  const nowSeconds = Math.floor(nowMs / 1000);
  const rows = chain.ids(wallet).map((id) => ({ id, ...chain.subs.get(id) })).filter((s) => s.active);
  const arcade = fe.pass.arcadeSubscriptions(rows, wallet);
  if (arcade.length === 0) return { valid: false, reason: "no-subscription" };
  // The fake's state read directly, not through call(), so nothing is counted.
  const cap = chain.caps.get(wallet.toLowerCase()) || { set: false, maxAmount: 0n, periodSeconds: 0 };
  const results = arcade.map((s) => {
    const funds = chain.tokens.get(`${s.tokenAddress}:${wallet}`.toLowerCase()) || { balance: 0n, allowance: 0n };
    return fe.pass.evaluatePass(s, funds, { nowSeconds, cap, account: wallet });
  });
  if (results.some((r) => r.valid)) return { valid: true, reason: "ok" };
  return { valid: false, reason: [...results].sort((a, b) => rank(a.reason) - rank(b.reason))[0].reason };
}

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

test("F2: same verdict as the browser's rules over the whole wallet, through state changes and cache expiry", async () => {
  const rand = mulberry(1990);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const nowS = Math.floor(T0 / 1000);
  const randomSub = (overrides = {}) => ({
    merchant: rand() < 0.5 ? M : pick(OTHER),
    tokenAddress: pick([Q, Q, USDT, JUNK]),
    amountPerPeriod: pick([1_000_000n, 1_000_000n, 500_000n, 250_000n, 2_000_000n]),
    periodSeconds: pick([MONTH, MONTH, WEEK, DAY]),
    cliffTime: rand() < 0.1 ? nowS + 999 : 0,
    stopTime: pick([0, 0, 0, nowS - 50, nowS + 60, nowS + MONTH]),
    active: rand() < 0.85,
    pausedByAI: rand() < 0.1,
    dispute: pick([0, 0, 0, 1, 2]),
    owed: pick([0n, 0n, 100_000n, 1_000_000n]),
    ...overrides,
  });
  const randomFunds = () => pick([0n, 33_332n, 33_333n, 1_033_333n, 10_000_000n]);
  const randomCap = () => pick([
    { set: false, maxAmount: 0n, periodSeconds: 0 },
    { set: true, maxAmount: 2_000_000n, periodSeconds: MONTH },
    { set: true, maxAmount: 1_000_000n, periodSeconds: MONTH },
    { set: true, maxAmount: 5_000_000n, periodSeconds: DAY },
    { set: true, maxAmount: 0n, periodSeconds: MONTH },
  ]);

  const chain = fakeChain();
  const clock = { t: T0 };
  const { checker } = checkerFor(chain, clock);
  const wallets = Array.from({ length: 60 }, () => ethers.Wallet.createRandom().address);
  for (const w of wallets) {
    const k = Math.floor(rand() * 8);
    for (let i = 0; i < k; i++) chain.add(w, randomSub({ subscriber: w }));
    chain.setCap(w, randomCap());
    for (const t of [Q, USDT, JUNK]) chain.setFunds(w, t, randomFunds(), randomFunds());
  }

  const seen = new Set();
  let compared = 0;
  for (let round = 0; round < 6; round++) {
    for (const w of wallets) {
      const got = await checker.check(w);
      const want = reference(chain, w, clock.t);
      assert.deepEqual(got, want, `round ${round}, ${w}`);
      seen.add(got.reason);
      compared++;
    }
    // Things that happen on chain between checks - only what the registry allows:
    // new subscriptions, cancellations, deactivation (final), pause, funds and caps.
    for (const w of wallets) {
      const ids = chain.ids(w);
      const r = rand();
      if (r < 0.2) chain.add(w, randomSub({ subscriber: w }));
      else if (r < 0.35 && ids.length) chain.subs.get(pick(ids)).stopTime = Math.floor(clock.t / 1000) - 10;
      else if (r < 0.45 && ids.length) chain.subs.get(pick(ids)).active = false;
      else if (r < 0.55 && ids.length) { const s = chain.subs.get(pick(ids)); if (s.active) s.pausedByAI = !s.pausedByAI; }
      else if (r < 0.7) chain.setFunds(w, pick([Q, USDT]), randomFunds(), randomFunds());
      else if (r < 0.8) chain.setCap(w, randomCap());
      else if (r < 0.9 && ids.length) chain.subs.get(pick(ids)).owed = pick([0n, 1_000_000n, 5_000_000n]);
    }
    clock.t += 61 * 1000; // past both caches
  }
  assert.equal(compared, 360);
  for (const reason of ["ok", "no-subscription", "cancelled", "insufficient-balance", "unsupported-token"]) {
    assert.ok(seen.has(reason), `the random wallets reached "${reason}" (saw ${[...seen].join(", ")})`);
  }
});

test("F2: other merchants' subscriptions are read once, ever; only live Arcade ones are re-read", async () => {
  const chain = fakeChain();
  const clock = { t: T0 };
  const { checker } = checkerFor(chain, clock);
  const w = ethers.Wallet.createRandom().address;
  chain.addMany(w, 30, { subscriber: w, merchant: OTHER[0] });
  chain.add(w, { subscriber: w, merchant: M, active: false });   // an old pass, closed for good
  chain.add(w, { subscriber: w });                               // the live pass
  chain.setFunds(w, Q, 10_000_000n);

  assert.deepEqual(await checker.check(w), { valid: true, reason: "ok" });
  assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1, getSubscription: 32, spendCaps: 1, previewOwed: 1, balanceOf: 1, allowance: 1 });
  assert.equal(checker.knownIds(), 32);

  chain.reset();
  clock.t += 61 * 1000;
  assert.deepEqual(await checker.check(w), { valid: true, reason: "ok" });
  assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1, getSubscription: 1, spendCaps: 1, previewOwed: 1, balanceOf: 1, allowance: 1 },
    "the second check re-reads only the live Arcade subscription");

  // The pass is cancelled and closed: after one more read it is never read again.
  const passId = chain.ids(w).at(-1);
  chain.subs.get(passId).active = false;
  chain.reset();
  clock.t += 61 * 1000;
  assert.deepEqual(await checker.check(w), { valid: false, reason: "no-subscription" });
  assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1, getSubscription: 1 });
  chain.reset();
  clock.t += 16 * 1000;
  assert.deepEqual(await checker.check(w), { valid: false, reason: "no-subscription" });
  assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1 }, "nothing left to re-read");
});

test("F2: rules that don't need them skip previewOwed and the token reads", async () => {
  const chain = fakeChain();
  const clock = { t: T0 };
  const { checker } = checkerFor(chain, clock);
  const w = ethers.Wallet.createRandom().address;
  chain.add(w, { subscriber: w, tokenAddress: JUNK });            // unsupported-token
  chain.add(w, { subscriber: w, stopTime: Math.floor(T0 / 1000) - 10 }); // cancelled
  chain.setFunds(w, Q, 10_000_000n);
  assert.deepEqual(await checker.check(w), { valid: false, reason: "unsupported-token" });
  assert.equal(chain.calls.previewOwed, undefined);
  assert.equal(chain.calls.balanceOf, undefined);
  assert.equal(chain.calls.allowance, undefined);
});

test("F2: at most 50 never-seen ids per check; fails closed (and logs) until the rest are read", async () => {
  const chain = fakeChain();
  const clock = { t: T0 };
  const { checker, logs } = checkerFor(chain, clock);

  // 800 junk subscriptions and no pass: 16 bounded checks, then a real answer.
  const junk = ethers.Wallet.createRandom().address;
  chain.addMany(junk, 800, { subscriber: junk, merchant: OTHER[1], tokenAddress: JUNK, amountPerPeriod: 1n, periodSeconds: DAY });
  for (let i = 0; i < 15; i++) {
    chain.reset();
    assert.deepEqual(await checker.check(junk), { valid: false, reason: "unavailable" }, `check ${i + 1}`);
    assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1, getSubscription: 50 }, `check ${i + 1} reads 51`);
  }
  assert.equal(logs.length, 15);
  assert.match(logs[0], new RegExp(`\\[ARCADE\\] pass check for ${junk}: 750 of 800 subscriptions not read yet`));
  chain.reset();
  assert.deepEqual(await checker.check(junk), { valid: false, reason: "no-subscription" });
  assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1, getSubscription: 50 });
  chain.reset();
  clock.t += 16 * 1000;
  assert.deepEqual(await checker.check(junk), { valid: false, reason: "no-subscription" });
  assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1 }, "from then on, one read per check");

  // A pass among the newest 50 is valid at once, whatever is still unread.
  const holder = ethers.Wallet.createRandom().address;
  chain.addMany(holder, 200, { subscriber: holder, merchant: OTHER[0] });
  chain.add(holder, { subscriber: holder });
  chain.setFunds(holder, Q, 10_000_000n);
  assert.deepEqual(await checker.check(holder), { valid: true, reason: "ok" });

  // A lapsed pass with ids still unread: unavailable, not the lapse reason (an unread one could be valid).
  const lapsed = ethers.Wallet.createRandom().address;
  chain.add(lapsed, { subscriber: lapsed });                      // oldest: the valid one
  chain.addMany(lapsed, 60, { subscriber: lapsed, merchant: OTHER[0] });
  chain.add(lapsed, { subscriber: lapsed, pausedByAI: true });    // newest: paused
  chain.setFunds(lapsed, Q, 10_000_000n);
  assert.deepEqual(await checker.check(lapsed), { valid: false, reason: "unavailable" });
  assert.deepEqual(await checker.check(lapsed), { valid: true, reason: "ok" }, "the second check reaches the older, valid pass");
  assert.deepEqual(await checker.check(lapsed), reference(chain, lapsed, clock.t));
});

test("F2: more than 20 live Arcade subscriptions on one wallet is unavailable, with bounded reads", async () => {
  const chain = fakeChain();
  const clock = { t: T0 };
  const { checker, logs } = checkerFor(chain, clock);
  const w = ethers.Wallet.createRandom().address;
  chain.addMany(w, 25, { subscriber: w, tokenAddress: JUNK });
  assert.deepEqual(await checker.check(w), { valid: false, reason: "unavailable" });
  assert.match(logs[0], /25 live Arcade subscriptions \(limit 20 per check\)/);
  chain.reset();
  assert.deepEqual(await checker.check(w), { valid: false, reason: "unavailable" });
  assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1 }, "known ids aren't re-read past the limit");

  // 20 is fine, and each is one read (they fail before the solvency rule).
  const ok = ethers.Wallet.createRandom().address;
  chain.addMany(ok, 20, { subscriber: ok, tokenAddress: JUNK });
  assert.deepEqual(await checker.check(ok), { valid: false, reason: "unsupported-token" });
});

test("F2: the id cache is a bounded LRU", async () => {
  const chain = fakeChain();
  const clock = { t: T0 };
  const { checker } = checkerFor(chain, clock, { maxKnownIds: 100 });
  const wallets = Array.from({ length: 5 }, () => ethers.Wallet.createRandom().address);
  for (const w of wallets) chain.addMany(w, 40, { subscriber: w, merchant: OTHER[0] });
  for (const w of wallets) assert.deepEqual(await checker.check(w), { valid: false, reason: "no-subscription" });
  assert.equal(checker.knownIds(), 100);
  // The most recent wallet's ids are still known: a re-check reads none of them.
  chain.reset();
  clock.t += 16 * 1000;
  await checker.check(wallets[4]);
  assert.deepEqual(chain.calls, { getSubscriberSubscriptions: 1 });
});
