import { ARCADE, isStablecoin } from "./v4Config";

/**
 * Recommended spending cap for the Arcade: twice the price per 30 days.
 * A cap exactly at the price can never clear a backlog - the registry keeps a
 * clamped remainder owed but only lets one cap's worth be collected per window,
 * while the next month accrues - so one late claim would leave a debt forever.
 */
export const ARCADE_CAP_UNITS = ARCADE.priceUnits * 2n;

/**
 * Does a v4 subscription count as a valid Fluenci Arcade Pass?
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
 * Returns { valid, reason } so the UI can say exactly what is wrong.
 */
export function evaluatePass(sub, tokenState, { nowSeconds = Math.floor(Date.now() / 1000), cap = null } = {}) {
  if (!ARCADE.merchant) return { valid: false, reason: "not-configured" };
  if (!sub) return { valid: false, reason: "no-subscription" };

  if (String(sub.merchant).toLowerCase() !== ARCADE.merchant.toLowerCase()) return { valid: false, reason: "wrong-merchant" };
  if (!isStablecoin(sub.tokenAddress)) return { valid: false, reason: "unsupported-token" };
  if (!sub.active) return { valid: false, reason: "inactive" };
  // Cancelled (stopTime reached) means access ends with the billing. Checked
  // before every fixable state: terminateStream keeps a record with arrears
  // active, and a cancelled pass must never be offered "cancel" again. The
  // 2-minute allowance covers a browser clock running behind the chain.
  const stop = Number(sub.stopTime || 0);
  if (stop !== 0 && stop <= nowSeconds + 120) return { valid: false, reason: "cancelled" };
  if (sub.pausedByAI) return { valid: false, reason: "paused" };
  if (Number(sub.dispute || 0) === 1) return { valid: false, reason: "disputed" };
  // A cliff blocks every payout until it passes - a pass must be paying now.
  if (Number(sub.cliffTime || 0) !== 0) return { valid: false, reason: "cliff" };

  // Price check on the monthly rate, so a weekly plan at an equivalent price also counts.
  const period = BigInt(sub.periodSeconds || 0);
  if (period <= 0n) return { valid: false, reason: "bad-period" };
  const monthly = (BigInt(sub.amountPerPeriod || 0) * BigInt(ARCADE.periodSeconds)) / period;
  if (monthly < ARCADE.priceUnits) return { valid: false, reason: "underpriced" };

  // A spending cap below the price (including a cap of 0) blocks the merchant
  // from ever collecting, so it would unlock the pass for free.
  if (cap?.set) {
    const capPeriod = BigInt(cap.periodSeconds || 0);
    const capMonthly = capPeriod > 0n ? (BigInt(cap.maxAmount || 0) * BigInt(ARCADE.periodSeconds)) / capPeriod : 0n;
    if (capMonthly < ARCADE.priceUnits) return { valid: false, reason: "capped-below-price" };
  }

  // Solvency: the wallet must be able to pay what it already owes plus one more
  // week, and the registry must be allowed to pull it. Checked live every time
  // (never latched), so emptying the wallet after subscribing ends the pass.
  const owed = BigInt(sub.owed || 0);
  const week = (monthly * 604800n) / BigInt(ARCADE.periodSeconds);
  const needed = owed + week;
  const balance = BigInt(tokenState?.balance ?? 0);
  const allowance = BigInt(tokenState?.allowance ?? 0);
  if (balance < needed) return { valid: false, reason: "insufficient-balance", needed };
  if (allowance < needed) return { valid: false, reason: "insufficient-allowance", needed };

  return { valid: true, reason: "ok" };
}

/** The user's Arcade subscriptions (there can be more than one), newest-stopTime-agnostic. */
export function arcadeSubscriptions(subscriptions) {
  if (!ARCADE.merchant) return [];
  return (subscriptions || []).filter(
    (s) => String(s?.merchant || "").toLowerCase() === ARCADE.merchant.toLowerCase()
  );
}

/** Plain-language copy for each failure reason. */
export const PASS_REASON_COPY = {
  "not-configured": "The Arcade is launching soon.",
  "no-subscription": "Get the Arcade Pass to play and chat.",
  "wrong-merchant": "Get the Arcade Pass to play and chat.",
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
  "capped-below-price": "Your spending limit for the Arcade is below the $1/month price, so the pass can't be paid. Raise or remove it on the Spending Limits page.",
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
