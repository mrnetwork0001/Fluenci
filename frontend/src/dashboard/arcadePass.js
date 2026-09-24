import { ARCADE, isStablecoin } from "./v4Config";

/**
 * Recommended spending cap for the Arcade: twice the price per 30 days.
 * A cap exactly at the price can never clear a backlog - the registry keeps a
 * clamped remainder owed but only lets one cap's worth be collected per window,
 * while the next month accrues - so one late claim would leave a debt forever.
 */
export const ARCADE_CAP_UNITS = ARCADE.priceUnits * 2n;

/** How far ahead a pass must be funded: one day of billing beyond what is already owed. */
export const RUNWAY_SECONDS = 86400n;

/** One day of billing at a monthly rate (base units). */
export const runwayUnits = (monthly) => (BigInt(monthly) * RUNWAY_SECONDS) / BigInt(ARCADE.periodSeconds);

/** What a wallet must hold to start a pass: one month plus the runway ($1.03). */
export const ARCADE_START_UNITS = ARCADE.priceUnits + runwayUnits(ARCADE.priceUnits);

/** A subscription's rate per 30-day month, or 0 for a nonsense period. */
export function monthlyUnits(sub) {
  const period = BigInt(sub?.periodSeconds || 0);
  if (period <= 0n) return 0n;
  return (BigInt(sub.amountPerPeriod || 0) * BigInt(ARCADE.periodSeconds)) / period;
}

/**
 * Cancelled: stopTime reached. The 2-minute allowance covers a browser clock
 * running behind the chain, so a pass is never counted live after it ended.
 */
export function hasEnded(sub, nowSeconds = Math.floor(Date.now() / 1000)) {
  const stop = Number(sub?.stopTime || 0);
  return stop !== 0 && stop <= nowSeconds + 120;
}

const sameAddress = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Does a v4 subscription count as a valid Fluenci Arcade Pass for `account`?
 *
 * v4 bills in arrears (createSubscription pulls nothing) and accepts any ERC-20
 * with any cliff, so "an active subscription to the Arcade merchant" is not
 * enough on its own - that would let a worthless token, a 10-year cliff, or an
 * empty wallet unlock paid features. Every rule below closes one of those gaps.
 *
 * `tokenState` is { balance, allowance } for the subscription's token, read live.
 * `cap` is the subscriber's spending cap on the Arcade merchant ({ set, maxAmount,
 * periodSeconds }): a cap below the price means the merchant can never collect
 * it, so the pass would be free.
 * `account` is the connected wallet: a pass only ever counts for its own subscriber.
 * Returns { valid, reason } so the UI can say exactly what is wrong.
 */
export function evaluatePass(sub, tokenState, { nowSeconds = Math.floor(Date.now() / 1000), cap = null, account = null } = {}) {
  if (!ARCADE.merchant) return { valid: false, reason: "not-configured" };
  if (!sub) return { valid: false, reason: "no-subscription" };

  if (!sameAddress(sub.merchant, ARCADE.merchant)) return { valid: false, reason: "wrong-merchant" };
  if (!sameAddress(sub.subscriber, account)) return { valid: false, reason: "wrong-subscriber" };
  if (!sub.active) return { valid: false, reason: "inactive" };
  // Cancelled comes before every fixable state, the token check included:
  // terminateStream keeps a record with arrears active, and a cancelled pass
  // must never be offered "cancel" again.
  if (hasEnded(sub, nowSeconds)) return { valid: false, reason: "cancelled" };
  if (!isStablecoin(sub.tokenAddress)) return { valid: false, reason: "unsupported-token" };
  if (sub.pausedByAI) return { valid: false, reason: "paused" };
  if (Number(sub.dispute || 0) === 1) return { valid: false, reason: "disputed" };
  // A cliff blocks every payout until it passes - a pass must be paying now.
  if (Number(sub.cliffTime || 0) !== 0) return { valid: false, reason: "cliff" };

  // Price check on the monthly rate, so a weekly plan at an equivalent price also counts.
  if (BigInt(sub.periodSeconds || 0) <= 0n) return { valid: false, reason: "bad-period" };
  const monthly = monthlyUnits(sub);
  if (monthly < ARCADE.priceUnits) return { valid: false, reason: "underpriced" };

  // A spending cap below the price (including a cap of 0) blocks the merchant
  // from ever collecting, so it would unlock the pass for free. The window must
  // also be at least a month: a claim collects at most one window's cap and
  // unused windows don't carry over, so a $0.034/day cap lets a monthly claim
  // take $0.034 even though it "adds up" to $1/month.
  if (cap?.set) {
    const capPeriod = BigInt(cap.periodSeconds || 0);
    if (capPeriod < BigInt(ARCADE.periodSeconds)) return { valid: false, reason: "capped-below-price" };
    const capMonthly = (BigInt(cap.maxAmount || 0) * BigInt(ARCADE.periodSeconds)) / capPeriod;
    if (capMonthly < ARCADE.priceUnits) return { valid: false, reason: "capped-below-price" };
  }

  // Solvency: the wallet must be able to pay what it already owes plus one more
  // day, and the registry must be allowed to pull it. Checked live every time
  // (never latched), so emptying the wallet after subscribing ends the pass.
  const owed = BigInt(sub.owed ?? 0);
  const needed = owed + runwayUnits(monthly);
  const balance = BigInt(tokenState?.balance ?? 0);
  const allowance = BigInt(tokenState?.allowance ?? 0);
  if (balance < needed) return { valid: false, reason: "insufficient-balance", needed };
  if (allowance < needed) return { valid: false, reason: "insufficient-allowance", needed };

  return { valid: true, reason: "ok" };
}

/** `account`'s Arcade subscriptions (there can be more than one), in any state. */
export function arcadeSubscriptions(subscriptions, account) {
  if (!ARCADE.merchant || !account) return [];
  return (subscriptions || []).filter(
    (s) => sameAddress(s?.merchant, ARCADE.merchant) && sameAddress(s?.subscriber, account)
  );
}

/** Plain-language copy for each failure reason. */
export const PASS_REASON_COPY = {
  "not-configured": "The Arcade is launching soon.",
  "no-subscription": "Get the Arcade Pass to play and chat.",
  "wrong-merchant": "Get the Arcade Pass to play and chat.",
  "wrong-subscriber": "Get the Arcade Pass to play and chat.",
  "unsupported-token": "Your pass must be paid in qUSDC, or USDC/USDT bridged from Ethereum.",
  inactive: "Your pass is no longer active.",
  paused: "Your pass is paused by Fluenci Protect. Check the Protect tab.",
  disputed: "Your pass is under dispute.",
  cliff: "Your pass has a delayed start, so it isn't paying yet. Start a new pass without a delay.",
  cancelled: "You cancelled your pass. Start a new one to keep playing.",
  "bad-period": "This subscription can't be used as a pass.",
  underpriced: "This subscription is below the $1/month pass price.",
  "insufficient-balance": "Your wallet doesn't hold enough to cover your pass. Top up to keep playing.",
  "insufficient-allowance": "Fluenci needs permission to collect your pass payments. Re-approve to keep playing.",
  "capped-below-price": "Your Arcade spending limit is below $1 a month or resets more often than monthly, so the pass can't be fully paid. Set a monthly limit of at least $1, or remove it, on the Spending Limits page.",
};

/**
 * What fixes each failure for a subscription that still exists. Offering
 * "start a new pass" instead would open a second paid subscription while the
 * first keeps billing - so only "cancelled" (or no subscription) leads to "new".
 */
export const PASS_REMEDY = {
  "insufficient-allowance": "reapprove",
  "insufficient-balance": "topup",
  "capped-below-price": "limits",
  paused: "protect",
  disputed: "protect",
  cliff: "cancel",
  underpriced: "cancel",
  "unsupported-token": "cancel",
  "bad-period": "cancel",
};
