// The server's Arcade Pass rules (server/arcade/pass.js) against the browser's
// (frontend/src/dashboard/arcadePass.js, loaded through Vite so import.meta.env
// works): one case table, the same reason (and `needed`) from both.
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
const server = require("../arcade/pass.js");

const M = "0x1111111111111111111111111111111111111111";
const Q = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const USDT = "0xCB7bBC584475dce754a918ccD92FF6E0211f3CEE";
const A = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const B = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
const now = 1_800_000_000;
const MONTH = 2592000, DAY = 86400, WEEK = 604800;
const base = { merchant: M, subscriber: A, tokenAddress: Q, active: true, pausedByAI: false, dispute: 0, cliffTime: 0, stopTime: 0,
  amountPerPeriod: 1_000_000n, periodSeconds: MONTH, owed: 0n };
const rich = { balance: 10_000_000n, allowance: 10_000_000n };
const funds = (balance, allowance = 10_000_000n) => ({ balance, allowance });
const cap = (maxAmount, periodSeconds) => ({ set: true, maxAmount, periodSeconds });

// The Arcade pass case table (passtest2.mjs): [name, sub, tokenState, cap, account, expected reason]
const cases = [
  ["healthy pass", base, rich, null, A, "ok"],
  ["cap of 0 (free-pass exploit)", base, rich, cap(0n, MONTH), A, "capped-below-price"],
  ["recommended $2 / 30 days", base, rich, cap(2_000_000n, MONTH), A, "ok"],
  ["cap exactly $1 / 30 days", base, rich, cap(1_000_000n, MONTH), A, "ok"],
  ["$0.034/day (adds up to $1.02/month, was valid)", base, rich, cap(34_000n, DAY), A, "capped-below-price"],
  ["$0.234/week (adds up to $1.003/month, was valid)", base, rich, cap(234_000n, WEEK), A, "capped-below-price"],
  ["$5/day (generous, but a daily window)", base, rich, cap(5_000_000n, DAY), A, "capped-below-price"],
  ["24 units / 60s (direct-contract version)", base, rich, cap(24n, 60), A, "capped-below-price"],
  ["$3 / 60 days (longer window, $1.50/month)", base, rich, cap(3_000_000n, 2 * MONTH), A, "ok"],
  ["$1.50 / 60 days ($0.75/month)", base, rich, cap(1_500_000n, 2 * MONTH), A, "capped-below-price"],
  ["cap not set", base, rich, { set: false, maxAmount: 0n, periodSeconds: 0 }, A, "ok"],
  ["cancelled cliff pass", { ...base, cliffTime: now + 999999, stopTime: now - 5 }, rich, null, A, "cancelled"],
  ["cancelled, chain clock 60s ahead", { ...base, stopTime: now + 60 }, rich, null, A, "cancelled"],
  ["scheduled end next month", { ...base, stopTime: now + MONTH }, rich, null, A, "ok"],
  ["paused and cancelled", { ...base, pausedByAI: true, stopTime: now - 1 }, rich, null, A, "cancelled"],
  ["paused", { ...base, pausedByAI: true }, rich, null, A, "paused"],
  ["disputed", { ...base, dispute: 1 }, rich, null, A, "disputed"],
  ["inactive", { ...base, active: false }, rich, null, A, "inactive"],
  ["worthless token", { ...base, tokenAddress: "0x2222222222222222222222222222222222222222" }, rich, null, A, "unsupported-token"],
  ["cancelled worthless token (was unsupported-token)", { ...base, tokenAddress: "0x2222222222222222222222222222222222222222", stopTime: now - 10 }, rich, null, A, "cancelled"],
  ["bridged USDT pass", { ...base, tokenAddress: USDT }, rich, null, A, "ok"],
  ["$0.50/month", { ...base, amountPerPeriod: 500_000n }, rich, null, A, "underpriced"],
  ["$0.25/week ($1.07/month)", { ...base, amountPerPeriod: 250_000n, periodSeconds: WEEK }, funds(35_714n), null, A, "ok"],
  ["zero period", { ...base, periodSeconds: 0 }, rich, null, A, "bad-period"],
  ["someone else's subscription", base, rich, null, B, "wrong-subscriber"],
  ["no account given", base, rich, null, null, "wrong-subscriber"],
  ["account in a different case", base, rich, null, A.toLowerCase(), "ok"],
  ["other merchant", { ...base, merchant: B }, rich, null, A, "wrong-merchant"],
  ["empty wallet", base, funds(0n), null, A, "insufficient-balance"],
  ["revoked approval", base, { balance: 10_000_000n, allowance: 0n }, null, A, "insufficient-allowance"],
  ["$0.10 with nothing owed (1 week needed $0.23; 1 day needs $0.033)", base, funds(100_000n), null, A, "ok"],
  ["exactly one day of runway", base, funds(33_333n), null, A, "ok"],
  ["one unit short of a day", base, funds(33_332n), null, A, "insufficient-balance"],
  ["owed $1, holds $1 + a day", { ...base, owed: 1_000_000n }, funds(1_033_333n), null, A, "ok"],
  ["owed $1, holds one unit less", { ...base, owed: 1_000_000n }, funds(1_033_332n), null, A, "insufficient-balance"],
  ["allowance exactly owed + a day", { ...base, owed: 500_000n }, { balance: 10_000_000n, allowance: 533_333n }, null, A, "ok"],
  ["allowance one unit short", { ...base, owed: 500_000n }, { balance: 10_000_000n, allowance: 533_332n }, null, A, "insufficient-allowance"],
  // Extra rows beyond passtest2: missing data and odd field types.
  ["no subscription", null, rich, null, A, "no-subscription"],
  ["stopTime exactly now + 121s", { ...base, stopTime: now + 121 }, rich, null, A, "ok"],
  ["stringly-typed fields (as read from JSON)", { ...base, amountPerPeriod: "1000000", periodSeconds: String(MONTH), owed: "0" }, rich, null, A, "ok"],
  ["dispute resolved (2) is not open", { ...base, dispute: 2 }, rich, null, A, "ok"],
  ["cap window exactly 30 days, $0.99", base, rich, cap(990_000n, MONTH), A, "capped-below-price"],
  ["no token state at all", base, undefined, null, A, "insufficient-balance"],
];

async function loadFrontend() {
  const { createServer } = await import(pathToFileURL(path.join(FRONTEND, "node_modules/vite/dist/node/index.js")).href);
  // An empty env dir: no .env file can change the frontend's stablecoin list or merchant under test.
  const envDir = fs.mkdtempSync(path.join(os.tmpdir(), "fluenci-noenv-"));
  process.env.VITE_ARCADE_MERCHANT = M;
  delete process.env.VITE_QUSDC_ADDRESS;
  const vite = await createServer({
    root: FRONTEND, envDir, configFile: false, logLevel: "error", appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  const pass = await vite.ssrLoadModule("/src/dashboard/arcadePass.js");
  const config = await vite.ssrLoadModule("/src/dashboard/v4Config.js");
  return { pass, config, close: async () => { await vite.close(); fs.rmSync(envDir, { recursive: true, force: true }); } };
}

const fe = await loadFrontend();
test.after(() => fe.close());
const rules = server.createPassRules({ merchant: M });

test("same stablecoin allowlist, price and period as the frontend", () => {
  assert.deepEqual(
    fe.config.STABLECOINS.map((t) => t.address.toLowerCase()),
    server.DEFAULT_STABLECOINS.map((a) => a.toLowerCase())
  );
  assert.equal(fe.config.ARCADE.merchant, M, "the frontend under test uses the test merchant");
  assert.equal(fe.config.ARCADE.priceUnits, server.PRICE_UNITS);
  assert.equal(fe.config.ARCADE.periodSeconds, server.PERIOD_SECONDS);
});

test("pass case table: the server port gives the frontend's answer for every case", () => {
  for (const [name, sub, tokenState, c, account, want] of cases) {
    const opts = { nowSeconds: now, cap: c, account };
    const a = fe.pass.evaluatePass(sub, tokenState, opts);
    const b = rules.evaluatePass(sub, tokenState, opts);
    assert.deepStrictEqual(b, a, `${name}: server ${JSON.stringify(b, (k, v) => (typeof v === "bigint" ? `${v}n` : v))}`);
    assert.equal(a.reason, want, `${name}: expected ${want}`);
  }
});

test("helpers agree: runway, start threshold, monthly rate, cancellation allowance, Arcade rows", () => {
  assert.equal(server.runwayUnits(1_000_000n), fe.pass.runwayUnits(1_000_000n));
  assert.equal(server.runwayUnits(1_000_000n), 33_333n);
  assert.equal(rules.ARCADE_START_UNITS, fe.pass.ARCADE_START_UNITS);
  for (const sub of [base, { ...base, amountPerPeriod: 250_000n, periodSeconds: WEEK }, { ...base, periodSeconds: 0 }, null]) {
    assert.equal(server.monthlyUnits(sub), fe.pass.monthlyUnits(sub));
  }
  for (const stopTime of [0, now + 119, now + 120, now + 121, now - 1]) {
    assert.equal(server.hasEnded({ stopTime }, now), fe.pass.hasEnded({ stopTime }, now), `stopTime now${stopTime ? `+${stopTime - now}` : " unset"}`);
  }
  const list = [base, { ...base, subscriber: B }, { ...base, merchant: B }, { ...base, stopTime: now - 1 }];
  for (const account of [A, B, A.toLowerCase(), null]) {
    assert.deepStrictEqual(rules.arcadeSubscriptions(list, account), fe.pass.arcadeSubscriptions(list, account));
  }
});

test("no merchant configured: not-configured on both sides", () => {
  const off = server.createPassRules({ merchant: "" });
  assert.deepEqual(off.evaluatePass(base, rich, { nowSeconds: now, account: A }), { valid: false, reason: "not-configured" });
  assert.deepEqual(off.arcadeSubscriptions([base], A), []);
});

test("ARCADE_STABLECOINS only applies off mainnet, on a known chain", () => {
  const junk = "0x2222222222222222222222222222222222222222";
  assert.deepEqual(server.resolveStablecoins(junk, 31337), [junk]);
  assert.deepEqual(server.resolveStablecoins(junk, 1990), server.DEFAULT_STABLECOINS, "ignored on QIE mainnet");
  assert.deepEqual(server.resolveStablecoins(junk, null), server.DEFAULT_STABLECOINS, "ignored while the chain is unknown");
  assert.deepEqual(server.resolveStablecoins("", 31337), server.DEFAULT_STABLECOINS);
  const onLocal = server.createPassRules({ merchant: M, stablecoins: server.resolveStablecoins(junk, 31337) });
  assert.equal(onLocal.evaluatePass({ ...base, tokenAddress: junk }, rich, { nowSeconds: now, account: A }).reason, "ok");
  assert.equal(onLocal.evaluatePass(base, rich, { nowSeconds: now, account: A }).reason, "unsupported-token", "the override replaces the list");
});
