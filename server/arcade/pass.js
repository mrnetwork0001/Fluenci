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

// Enough of both for the rules to run everything before the solvency rule.
const UNLIMITED = { balance: ethers.MaxUint256, allowance: ethers.MaxUint256 };

/**
 * check(address) -> { valid, reason } for that wallet's Arcade Pass, read live
 * from the registry `getRegistryAddress()` through `getProvider()`. Results are
 * cached per address: a valid pass for `cacheMs`, a missing or lapsed one for
 * `negativeCacheMs` (so a pass bought a moment ago is seen quickly), and a read
 * error not at all. Concurrent checks for one address share a single read.
 *
 * The work per check is bounded, whatever the wallet holds:
 *  - A subscription's merchant never changes, so each id's merchant is read
 *    once and remembered (an LRU of `maxKnownIds`). Other merchants'
 *    subscriptions are never read again; neither is an Arcade one that has
 *    gone inactive, which is final in the registry.
 *  - Only live Arcade subscriptions get fresh reads on every check
 *    (getSubscription; previewOwed, balance and allowance only when the
 *    solvency rule is reached, which is the only rule they feed).
 *  - At most `maxNewPerCheck` never-seen ids are read per check, newest first.
 *    If some are left unread and nothing read so far is a valid pass, the
 *    answer is "unavailable" (fail closed, logged, not cached); the next check
 *    carries on from there.
 *  - Live Arcade passes are re-read newest first, at most `maxArcadePerCheck`
 *    per check; the answer is valid if any of them is. Only when none is valid
 *    and some were skipped is it "unavailable". Passes cancelled long ago are
 *    re-read on a separate budget until they close, and never count as live.
 * Whenever the answer isn't "unavailable" it is the one evaluatePass gives
 * over all of the wallet's subscriptions, as arcadePass.js does in the browser.
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
  maxKnownIds = 20000,
  maxNewPerCheck = 50,
  maxArcadePerCheck = 20,
  log = console,
} = {}) {
  const cache = new Map();     // lowercase address -> { result, until }
  const inflight = new Map();  // lowercase address -> Promise
  const known = new Map();     // registry:subId (lowercase) -> { merchant (lowercase), inactive }, least recently used first

  function rules() {
    return createPassRules({ merchant, stablecoins: resolveStablecoins(stablecoinsEnv, getChainId()) });
  }

  function remember(key, entry) {
    known.delete(key);
    known.set(key, entry);
    while (known.size > maxKnownIds) known.delete(known.keys().next().value);
  }
  function recall(key) {
    const entry = known.get(key);
    if (entry) remember(key, entry);
    return entry;
  }

  async function read(address) {
    const r = rules();
    if (!r.ARCADE.merchant) return { valid: false, reason: "not-configured" };
    const provider = getProvider ? getProvider() : null;
    const registryAddress = getRegistryAddress ? getRegistryAddress() : "";
    if (!provider || !registryAddress || !ethers.isAddress(registryAddress)) return { valid: false, reason: "unavailable" };

    const reg = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
    const arcadeMerchant = r.ARCADE.merchant.toLowerCase();
    const keyOf = (id) => `${registryAddress.toLowerCase()}:${String(id).toLowerCase()}`;
    const ids = [...(await reg.getSubscriberSubscriptions(address))];

    // An Arcade pass cancelled well in the past can never be valid again (only
    // terminateStream writes stopTime), but it stays "active" while it owes
    // arrears and closes once they're collected, which changes the browser's
    // answer from "cancelled" to "no-subscription". So ended passes are still
    // re-read (until they close for good), but on their own small budget, and
    // they never count against the live-pass cap.
    const nowSeconds = Math.floor(now() / 1000);
    const endedLongAgo = (s) => Number(s.stopTime || 0) !== 0 && Number(s.stopTime) <= nowSeconds - 120;

    // Split the wallet's ids, newest first: known Arcade ones to re-read (live
    // and ended), and never-seen ones.
    const liveIds = [];
    const endedIds = [];
    const unseen = [];
    for (let i = ids.length - 1; i >= 0; i--) {
      const entry = recall(keyOf(ids[i]));
      if (!entry) unseen.push(ids[i]);
      else if (entry.merchant === arcadeMerchant && !entry.inactive) (entry.ended ? endedIds : liveIds).push(ids[i]);
    }
    const batch = unseen.slice(0, maxNewPerCheck);
    const unread = unseen.length - batch.length;

    // Never-seen ids: this one read tells their merchant for good, and is fresh
    // enough to evaluate an Arcade subscription with right away.
    const fresh = await mapInBatches(batch, 25, async (id) => toSub(id, await reg.getSubscription(id), null));
    const live = [];
    const ended = [];
    for (const s of fresh) {
      const isArcade = String(s.merchant).toLowerCase() === arcadeMerchant;
      const isEnded = isArcade && s.active && endedLongAgo(s);
      remember(keyOf(s.id), { merchant: String(s.merchant).toLowerCase(), inactive: !s.active, ended: isEnded });
      if (!s.active || !isArcade) continue;
      (isEnded ? ended : live).push(s);
    }

    // Re-read known Arcade subscriptions, newest first, within the per-check
    // budgets. A skipped live one only matters when nothing read is valid.
    const liveRoom = Math.max(0, maxArcadePerCheck - live.length);
    const liveReread = liveIds.slice(0, liveRoom);
    const endedReread = endedIds.slice(0, maxArcadePerCheck);
    const skippedLive = liveIds.length - liveReread.length + Math.max(0, live.length - maxArcadePerCheck);
    const skippedEnded = endedIds.length - endedReread.length;
    if (live.length > maxArcadePerCheck) live.length = maxArcadePerCheck;
    const reread = await mapInBatches([...liveReread, ...endedReread], 25, async (id) => toSub(id, await reg.getSubscription(id), null));
    for (const s of reread) {
      if (!s.active) { remember(keyOf(s.id), { merchant: arcadeMerchant, inactive: true }); continue; }
      if (endedLongAgo(s)) { remember(keyOf(s.id), { merchant: arcadeMerchant, inactive: false, ended: true }); ended.push(s); continue; }
      live.push(s);
    }

    const incomplete = (why) => {
      log.warn?.(`[ARCADE] pass check for ${address}: ${why}; answering unavailable`);
      return { valid: false, reason: "unavailable" };
    };
    const unreadNote = () => `${unread} of ${ids.length} subscriptions not read yet (${maxNewPerCheck} new ones per check)`;
    const skippedNote = () => `${skippedLive} live Arcade subscriptions over the per-check limit of ${maxArcadePerCheck}`;
    const arcade = r.arcadeSubscriptions([...live, ...ended], address);
    if (arcade.length === 0) {
      if (unread > 0) return incomplete(unreadNote());
      if (skippedLive > 0) return incomplete(skippedNote());
      return skippedEnded > 0 ? { valid: false, reason: "cancelled" } : { valid: false, reason: "no-subscription" };
    }

    // No fallbacks: a failed read must never be evaluated as "no cap" or "nothing owed".
    const c = await reg.spendCaps(address, r.ARCADE.merchant);
    const cap = { set: c.set, maxAmount: c.maxAmount, periodSeconds: Number(c.periodSeconds) };
    const opts = { nowSeconds, cap, account: address };
    const results = await Promise.all(arcade.map(async (s0) => {
      // Every rule before the solvency one ignores what is owed and the token
      // state; if one of them fails, that is the answer and nothing else is read.
      const early = r.evaluatePass({ ...s0, owed: 0n }, UNLIMITED, opts);
      if (!early.valid) return early;
      const sub = { ...s0, owed: await reg.previewOwed(s0.id) };
      const erc20 = new ethers.Contract(sub.tokenAddress, ERC20_ABI, provider);
      const [balance, allowance] = await Promise.all([erc20.balanceOf(address), erc20.allowance(address, registryAddress)]);
      return r.evaluatePass(sub, { balance, allowance }, opts);
    }));
    if (results.some((x) => x.valid)) return { valid: true, reason: "ok" };
    if (unread > 0) return incomplete(unreadNote());
    if (skippedLive > 0) return incomplete(skippedNote());
    // Ended passes past the re-read budget were still ended when last read.
    if (skippedEnded > 0) results.push({ valid: false, reason: "cancelled" });
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

  return { check, rules, cacheSize: () => cache.size, knownIds: () => known.size };
}

module.exports = {
  DEFAULT_STABLECOINS, PRICE_UNITS, PERIOD_SECONDS, RUNWAY_SECONDS, REASON_ORDER, QIE_MAINNET_CHAIN_ID,
  runwayUnits, monthlyUnits, hasEnded, resolveStablecoins, createPassRules, createPassChecker,
};
