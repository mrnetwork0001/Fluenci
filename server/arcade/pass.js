// Fluenci Arcade Pass, checked on the server.
//
// The rules are a port of frontend/src/dashboard/arcadePass.js (evaluatePass and
// friends) and must give the same answer for the same subscription; the parity
// test (server/test/passParity.test.mjs) runs one case table through both.
// On top of the rules, createPassChecker reads everything they need from the
// registry for one wallet, the way the Arcade screen does, and fails closed:
// any read error is "not valid" with reason "unavailable".
"use strict";
const { ethers } = require("ethers");

const QIE_MAINNET_CHAIN_ID = 1990;

// Stablecoins a pass may be paid in (QIE mainnet), all 6 decimals. Same list as
// STABLECOINS in frontend/src/dashboard/v4Config.js.
const DEFAULT_STABLECOINS = Object.freeze([
  "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5", // qUSDC
  "0x0e93FAcc0a2cfD418403f3AD3EEfB5C8b2dfAec7", // USDC bridged from Ethereum
  "0xCB7bBC584475dce754a918ccD92FF6E0211f3CEE", // USDT bridged from Ethereum
]);

const PRICE_UNITS = 1_000_000n;   // $1.00 in 6-decimal stablecoin units
const PERIOD_SECONDS = 2592000;   // per 30-day month
const RUNWAY_SECONDS = 86400n;    // a pass must be funded one day beyond what is owed

// A funding problem on a live pass is more urgent than an old cancelled one
// (same order as REASON_ORDER in Arcade.jsx).
const REASON_ORDER = ["insufficient-balance", "insufficient-allowance", "capped-below-price", "paused", "disputed",
  "cliff", "underpriced", "unsupported-token", "bad-period", "cancelled"];
const reasonRank = (r) => { const i = REASON_ORDER.indexOf(r); return i === -1 ? 99 : i; };

const sameAddress = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

/** One day of billing at a monthly rate (base units). */
const runwayUnits = (monthly) => (BigInt(monthly) * RUNWAY_SECONDS) / BigInt(PERIOD_SECONDS);

/** A subscription's rate per 30-day month, or 0 for a nonsense period. */
function monthlyUnits(sub) {
  const period = BigInt(sub?.periodSeconds || 0);
  if (period <= 0n) return 0n;
  return (BigInt(sub.amountPerPeriod || 0) * BigInt(PERIOD_SECONDS)) / period;
}

/** Cancelled: stopTime reached, with the same 2-minute allowance as the browser. */
function hasEnded(sub, nowSeconds = Math.floor(Date.now() / 1000)) {
  const stop = Number(sub?.stopTime || 0);
  return stop !== 0 && stop <= nowSeconds + 120;
}

/**
 * ARCADE_STABLECOINS replaces the allowlist, for local test chains only. It is
 * ignored on QIE mainnet and while the chain is unknown, so a stray value on the
 * production server can never let a self-deployed token unlock a pass.
 */
function resolveStablecoins(envValue, chainId) {
  const override = String(envValue || "").split(",").map((a) => a.trim()).filter(Boolean);
  if (!override.length || chainId === null || chainId === undefined || Number(chainId) === QIE_MAINNET_CHAIN_ID) {
    return DEFAULT_STABLECOINS;
  }
  return override.filter((a) => ethers.isAddress(a)).map((a) => ethers.getAddress(a));
}

/** The pass rules for one Arcade merchant and stablecoin allowlist. */
function createPassRules({ merchant = "", stablecoins = DEFAULT_STABLECOINS } = {}) {
  const ARCADE = { merchant: merchant || "", priceUnits: PRICE_UNITS, periodSeconds: PERIOD_SECONDS };
  const allowed = new Set(stablecoins.map((a) => String(a).toLowerCase()));
  const isStablecoin = (addr) => Boolean(addr) && allowed.has(String(addr).toLowerCase());

  /** Same rules, same order and same reasons as evaluatePass in arcadePass.js. */
  function evaluatePass(sub, tokenState, { nowSeconds = Math.floor(Date.now() / 1000), cap = null, account = null } = {}) {
    if (!ARCADE.merchant) return { valid: false, reason: "not-configured" };
    if (!sub) return { valid: false, reason: "no-subscription" };

    if (!sameAddress(sub.merchant, ARCADE.merchant)) return { valid: false, reason: "wrong-merchant" };
    if (!sameAddress(sub.subscriber, account)) return { valid: false, reason: "wrong-subscriber" };
    if (!sub.active) return { valid: false, reason: "inactive" };
    if (hasEnded(sub, nowSeconds)) return { valid: false, reason: "cancelled" };
    if (!isStablecoin(sub.tokenAddress)) return { valid: false, reason: "unsupported-token" };
    if (sub.pausedByAI) return { valid: false, reason: "paused" };
    if (Number(sub.dispute || 0) === 1) return { valid: false, reason: "disputed" };
    if (Number(sub.cliffTime || 0) !== 0) return { valid: false, reason: "cliff" };

    if (BigInt(sub.periodSeconds || 0) <= 0n) return { valid: false, reason: "bad-period" };
    const monthly = monthlyUnits(sub);
    if (monthly < ARCADE.priceUnits) return { valid: false, reason: "underpriced" };

    if (cap?.set) {
      const capPeriod = BigInt(cap.periodSeconds || 0);
      if (capPeriod < BigInt(ARCADE.periodSeconds)) return { valid: false, reason: "capped-below-price" };
      const capMonthly = (BigInt(cap.maxAmount || 0) * BigInt(ARCADE.periodSeconds)) / capPeriod;
      if (capMonthly < ARCADE.priceUnits) return { valid: false, reason: "capped-below-price" };
    }

    const owed = BigInt(sub.owed ?? 0);
    const needed = owed + runwayUnits(monthly);
    const balance = BigInt(tokenState?.balance ?? 0);
    const allowance = BigInt(tokenState?.allowance ?? 0);
    if (balance < needed) return { valid: false, reason: "insufficient-balance", needed };
    if (allowance < needed) return { valid: false, reason: "insufficient-allowance", needed };

    return { valid: true, reason: "ok" };
  }

  /** `account`'s Arcade subscriptions (there can be more than one), in any state. */
  function arcadeSubscriptions(subscriptions, account) {
    if (!ARCADE.merchant || !account) return [];
    return (subscriptions || []).filter(
      (s) => sameAddress(s?.merchant, ARCADE.merchant) && sameAddress(s?.subscriber, account)
    );
  }

  return {
    ARCADE, isStablecoin, evaluatePass, arcadeSubscriptions, hasEnded, monthlyUnits, runwayUnits,
    ARCADE_START_UNITS: PRICE_UNITS + runwayUnits(PRICE_UNITS),
  };
}

// ---- On-chain checker --------------------------------------------------------

const REGISTRY_ABI = [
  "function getSubscriberSubscriptions(address subscriber) view returns (bytes32[])",
  "function getSubscription(bytes32 subId) view returns (tuple(address subscriber,address merchant,address tokenAddress,uint256 amountPerPeriod,uint256 periodSeconds,uint256 billedSeconds,uint256 settledAmount,uint256 settledFees,uint256 feeDust,uint256 lastTickTimestamp,uint256 startTime,uint256 cliffTime,uint256 stopTime,bool active,bool pausedByAI,uint8 dispute))",
  "function previewOwed(bytes32 subId) view returns (uint256)",
  "function spendCaps(address subscriber, address merchant) view returns (uint256 maxAmount, uint256 periodSeconds, uint256 windowStart, uint256 spentInWindow, bool set)",
];
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

// Shaped like toSub in useFluenciV4.js, so the rules see the same fields.
function toSub(id, s, owed) {
  return {
    id,
    merchant: s.merchant,
    subscriber: s.subscriber,
    tokenAddress: s.tokenAddress,
    cliffTime: Number(s.cliffTime),
    amountPerPeriod: s.amountPerPeriod,
    periodSeconds: Number(s.periodSeconds),
    active: s.active,
    pausedByAI: s.pausedByAI,
    dispute: Number(s.dispute),
    stopTime: Number(s.stopTime),
    owed,
  };
}

async function mapInBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/**
 * check(address) -> { valid, reason } for that wallet's Arcade Pass, read live
 * from the registry `getRegistryAddress()` through `getProvider()`. Results are
 * cached per address: a valid pass for `cacheMs`, a missing or lapsed one for
 * `negativeCacheMs` (so a pass bought a moment ago is seen quickly), and a read
 * error not at all. Concurrent checks for one address share a single read.
 */
function createPassChecker({
  merchant = "",
  stablecoinsEnv = "",
  getProvider,
  getRegistryAddress,
  getChainId = () => null,
  now = Date.now,
  cacheMs = 60 * 1000,
  negativeCacheMs = 15 * 1000,
  maxEntries = 20000,
  maxSubscriptions = 500,
} = {}) {
  const cache = new Map();     // lowercase address -> { result, until }
  const inflight = new Map();  // lowercase address -> Promise

  function rules() {
    return createPassRules({ merchant, stablecoins: resolveStablecoins(stablecoinsEnv, getChainId()) });
  }

  async function read(address) {
    const r = rules();
    if (!r.ARCADE.merchant) return { valid: false, reason: "not-configured" };
    const provider = getProvider ? getProvider() : null;
    const registryAddress = getRegistryAddress ? getRegistryAddress() : "";
    if (!provider || !registryAddress || !ethers.isAddress(registryAddress)) return { valid: false, reason: "unavailable" };

    const reg = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
    const ids = await reg.getSubscriberSubscriptions(address);
    // Only the newest `maxSubscriptions` are read; that only matters for a
    // wallet with hundreds of subscriptions.
    const recent = [...ids].slice(-maxSubscriptions);
    const subs = await mapInBatches(recent, 25, async (id) => toSub(id, await reg.getSubscription(id), null));
    const arcade = r.arcadeSubscriptions(subs.filter((s) => s.active), address);
    if (arcade.length === 0) return { valid: false, reason: "no-subscription" };

    // No fallbacks: a failed read must never be evaluated as "no cap" or "nothing owed".
    const c = await reg.spendCaps(address, r.ARCADE.merchant);
    const cap = { set: c.set, maxAmount: c.maxAmount, periodSeconds: Number(c.periodSeconds) };
    const nowSeconds = Math.floor(now() / 1000);
    const results = await Promise.all(arcade.map(async (s0) => {
      const sub = { ...s0, owed: await reg.previewOwed(s0.id) };
      // Token state only matters when the solvency rule can be reached.
      const needsTokenState = sub.active && !hasEnded(sub, nowSeconds) && r.isStablecoin(sub.tokenAddress);
      let tokenState = { balance: 0n, allowance: 0n };
      if (needsTokenState) {
        const erc20 = new ethers.Contract(sub.tokenAddress, ERC20_ABI, provider);
        const [balance, allowance] = await Promise.all([erc20.balanceOf(address), erc20.allowance(address, registryAddress)]);
        tokenState = { balance, allowance };
      }
      return r.evaluatePass(sub, tokenState, { nowSeconds, cap, account: address });
    }));
    if (results.some((x) => x.valid)) return { valid: true, reason: "ok" };
    const worst = [...results].sort((a, b) => reasonRank(a.reason) - reasonRank(b.reason))[0];
    return { valid: false, reason: worst.reason };
  }

  async function check(address) {
    if (!ethers.isAddress(address)) return { valid: false, reason: "no-subscription" };
    const wallet = ethers.getAddress(address);
    const key = wallet.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.result;
    if (inflight.has(key)) return inflight.get(key);

    const run = (async () => {
      let result;
      try {
        result = await read(wallet);
      } catch {
        result = { valid: false, reason: "unavailable" };
      }
      const ttl = result.reason === "unavailable" ? 0 : result.valid ? cacheMs : negativeCacheMs;
      if (ttl > 0) {
        cache.delete(key);
        cache.set(key, { result, until: now() + ttl });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      }
      return result;
    })();
    inflight.set(key, run);
    try {
      return await run;
    } finally {
      inflight.delete(key);
    }
  }

  // Drop expired entries so the cache only holds recent wallets.
  const timer = setInterval(() => {
    const t = now();
    for (const [key, entry] of cache) if (entry.until <= t) cache.delete(key);
  }, 60 * 1000);
  timer.unref?.();

  return { check, rules, cacheSize: () => cache.size };
}

module.exports = {
  DEFAULT_STABLECOINS, PRICE_UNITS, PERIOD_SECONDS, RUNWAY_SECONDS, REASON_ORDER, QIE_MAINNET_CHAIN_ID,
  runwayUnits, monthlyUnits, hasEnded, resolveStablecoins, createPassRules, createPassChecker,
};
