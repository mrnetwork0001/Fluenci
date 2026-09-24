import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import SnakeGame from "./arcade/SnakeGame";
import ArcadeChat from "./arcade/ArcadeChat";
import Leaderboard from "./arcade/Leaderboard";
import { useArcadeSession } from "./arcade/useArcadeSession";
import { useLeaderboard } from "./arcade/useLeaderboard";
import { startSnakeRound, finishSnakeRound } from "./arcade/arcadeApi";
import FundWallet from "./FundWallet";
import { IconCheck } from "./icons";
import {
  ARCADE, QIEDEX_ROUTER, QIEDEX_ROUTER_ABI, WQIE, V4_TOKEN,
  LOW_GAS_QIE, GAS_RESERVE_QIE, stablecoinOf, isStablecoin,
} from "./v4Config";
import {
  evaluatePass, arcadeSubscriptions, hasEnded, monthlyUnits, runwayUnits,
  PASS_REASON_COPY, PASS_REMEDY, ARCADE_CAP_UNITS, ARCADE_START_UNITS,
} from "./arcadePass";

const FREE_ROUND_KEY = "fluenci_arcade_free_round";
const MONTH_OPTIONS = [1, 3, 12];
const QUOTE_REFRESH_MS = 60000;
// After a pass is created, re-read subscriptions until it shows up (RPC nodes lag).
const NEW_PASS_POLLS = 6;
const NEW_PASS_POLL_MS = 4000;
const NO_ROWS = [];
const IDLE_FLOW = { step: "idle", error: "" };
const INITIAL_PASS = { account: null, checked: false, valid: false, reason: "no-subscription", sub: null };

// 6-decimal units per cent. Holdings round down and requirements round up, so
// the page never says someone has enough when they don't.
const CENT = 10_000n;
const cents = (units, up) => {
  const u = BigInt(units ?? 0n);
  const c = up ? (u + CENT - 1n) / CENT : u / CENT;
  return `$${(Number(c) / 100).toFixed(2)}`;
};
const money = (units) => cents(units, false);
const moneyUp = (units) => cents(units, true);
const qie = (wei) => Number(ethers.formatEther(wei ?? 0n)).toFixed(4).replace(/\.?0+$/, "");
const monthsLabel = (m) => `${m} ${m === 1 ? "month" : "months"}`;
const sameAddress = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
const isQusdc = (addr) => sameAddress(addr, V4_TOKEN);

// A funding problem on a live pass is more urgent than an old cancelled one.
const REASON_ORDER = ["insufficient-balance", "insufficient-allowance", "capped-below-price", "paused", "disputed",
  "cliff", "underpriced", "unsupported-token", "bad-period", "cancelled"];
const rank = (r) => { const i = REASON_ORDER.indexOf(r); return i === -1 ? 99 : i; };

// A wallet request that never settles (locked wallet, prompt behind the window).
const WALLET_TIMEOUT_MS = 60000;
const WALLET_SILENT = "Your wallet didn't respond. Open it, approve or reject any pending request, then try again.";
function withTimeout(promise, ms, message) {
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(t));
}

// Dev-only breadcrumbs (console.warn is what the Vite dev server echoes to its terminal).
const trace = (...args) => { if (import.meta.env.DEV) console.warn("[arcade]", ...args); };

function toWei(qieAmount) {
  try { return ethers.parseEther(String(qieAmount || "0")); } catch { return 0n; }
}

// Kept in localStorage so a new tab doesn't hand out another round; sessionStorage
// is the fallback where localStorage is blocked. Client-side, so only a soft gate.
function readFreeRound() {
  try { if (localStorage.getItem(FREE_ROUND_KEY) === "1") return true; } catch { /* storage blocked */ }
  try { return sessionStorage.getItem(FREE_ROUND_KEY) === "1"; } catch { return false; }
}
function writeFreeRound() {
  try { localStorage.setItem(FREE_ROUND_KEY, "1"); return; } catch { /* fall back */ }
  try { sessionStorage.setItem(FREE_ROUND_KEY, "1"); } catch { /* private mode: the round just isn't remembered */ }
}

/** QIE to swap for at least `units` of qUSDC: quoted for 106%, so the swap's 5% slippage floor still delivers `units`. */
async function qieNeededFor(router, units) {
  if (units <= 0n) return 0n;
  const a = await router.getAmountsIn((units * 106n) / 100n, [WQIE, V4_TOKEN]);
  return a[0];
}

/** qUSDC missing for `m` months of a pass at `monthly`, on top of `owed`, from a balance of `balance`. */
function shortfallFor(m, monthly, owed, balance) {
  const target = owed + monthly * BigInt(m) + runwayUnits(monthly);
  return target > balance ? target - balance : 0n;
}

function TabButton({ active, label, onSelect }) {
  return (
    <button className={`fl-btn ${active ? "fl-btn--primary" : "fl-btn--ghost"}`}
            onClick={onSelect} style={{ padding: "8px 16px", fontSize: 13 }}>{label}</button>
  );
}

const Note = ({ tone = "muted", children }) => (
  <div style={{ color: tone === "warn" ? "var(--fl-warn)" : "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, marginTop: 12 }}>{children}</div>
);

/**
 * Fluenci Arcade: Snake + an AI assistant behind a $1/month Arcade Pass.
 *
 * The pass is an ordinary Fluenci subscription to the Arcade merchant, checked
 * live with evaluatePass. Rules that matter for money:
 *  - never offer "buy" before the user's subscriptions have loaded, or when a
 *    load or check failed - show a retry instead;
 *  - a pass that exists but has lapsed gets a FIX (re-approve, top up, raise
 *    the limit, cancel) - never a second subscription billing alongside it;
 *  - right before creating, re-read the wallet's subscriptions from the chain;
 *  - the recommended cap is 2x the price so a late charge can still clear.
 *
 * `flow` lives in the parent so a purchase still in flight survives leaving
 * and re-opening the Arcade; it is tagged with the account that started it.
 *
 * The server checks the pass too. A pass holder signs in once (one wallet
 * signature, from a click) to use the AI assistant and to put Snake rounds on
 * the weekly board; everyone else - and a pass holder who never signs in - can
 * still play Snake, those rounds just never reach the server.
 */
export default function Arcade({
  account = null,
  onConnect = null,
  v4,
  qieBalance = "0",
  onSwapQie = null,        // (qieAmountString, { minOut }) => Promise<boolean>
  apiBase = null,
  onNavigate = null,
  unavailable = false,     // v4 registry not configured in this build
  flow: flowProp = null,
  setFlow: setFlowProp = null,
}) {
  const [tab, setTab] = useState("snake");
  const [passState, setPass] = useState(INITIAL_PASS);
  const [stablesState, setStables] = useState({ account: null, status: "idle", rows: NO_ROWS });
  const [payToken, setPayToken] = useState(null);
  const [months, setMonths] = useState(3);
  const [capOn, setCapOn] = useState(true);
  const [quotesState, setQuotes] = useState({ account: null, status: "idle", byMonths: {}, qieValue: null });
  const [localFlow, setLocalFlow] = useState(null);
  const [freeUsed, setFreeUsed] = useState(readFreeRound);
  const [rechecking, setRechecking] = useState(false);
  const [newPassPolls, setNewPassPolls] = useState(0);
  const checkSeq = useRef(0);
  const stablesSeq = useRef(0);

  // Everything below is scoped to the connected account: state left over from
  // another wallet reads as "not checked yet", never as that wallet's pass.
  const storeFlow = setFlowProp || setLocalFlow;
  const flowState = setFlowProp ? flowProp : localFlow;
  const flow = flowState && flowState.account === account ? flowState : IDLE_FLOW;
  const setFlow = useCallback((step, error = "", extra = {}) => storeFlow({ step, error, account, ...extra }),
    [storeFlow, account]);
  const pass = passState.account === account ? passState : INITIAL_PASS;
  const stables = stablesState.account === account ? stablesState : { status: "loading", rows: NO_ROWS };
  const quotes = quotesState.account === account ? quotesState : { status: "idle", byMonths: {}, qieValue: null };

  const configured = Boolean(ARCADE.merchant) && !unavailable;
  const isMerchantWallet = sameAddress(account, ARCADE.merchant);
  const loadFailed = Boolean(account) && Boolean(v4?.loadFailed);
  // Rows for another wallet mean the list is stale: treat it as not loaded.
  const staleSubs = Boolean(account) && (v4?.subscriptions || []).some((s) => !sameAddress(s?.subscriber, account));
  const ready = !account || (Boolean(v4?.loaded) && !staleSubs);
  const arcadeSubs = useMemo(() => arcadeSubscriptions(v4?.subscriptions, account), [v4?.subscriptions, account]);
  // Which subscriptions a verdict was computed from: when a new one appears, the
  // old "no pass" verdict must not show a buy button while the check reruns.
  const subsKey = arcadeSubs.map((s) => s.id).join(",");
  const readTokenState = v4?.readTokenState;
  const readStablecoinBalances = v4?.readStablecoinBalances;
  const readSubscription = v4?.readSubscription;
  const readSubscriberSubscriptions = v4?.readSubscriberSubscriptions;
  const readSpendCap = v4?.readSpendCap;
  const readProviderFn = v4?.readProvider;
  const refreshV4 = v4?.refresh;
  const v4Loading = Boolean(v4?.loading);
  const passValid = ready && pass.valid;

  // --- Arcade sign-in: the server-side pass, the Snake board, the AI assistant ---
  const session = useArcadeSession({ apiBase, account, signMessage: v4?.signMessage });
  // Read at the moment a round starts or ends, not when the callbacks were made.
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; });
  // Only a pass holder is ever asked to sign in.
  const canSignIn = configured && passValid && session.available;
  const scored = canSignIn && session.signedIn;
  const board = useLeaderboard({ apiBase, token: session.token, enabled: configured && tab === "snake" });
  const refreshBoard = board.refresh;

  const startRound = useCallback(async () => {
    const s = sessionRef.current;
    if (!s.signedIn) return { ok: false, message: "Sign in to the Arcade to play a scored round." };
    const r = await startSnakeRound({ apiBase, token: s.token });
    if (r.unauthorized) s.expire(s.token);
    return r.ok ? { ...r, owner: s.address } : r;
  }, [apiBase]);

  const finishRound = useCallback(async ({ ticket, owner, inputs, score, durationMs }) => {
    const s = sessionRef.current;
    if (!s.signedIn || !sameAddress(s.address, owner)) {
      return { ok: false, message: "You signed out or switched wallets during this round, so the score wasn't sent." };
    }
    const r = await finishSnakeRound({ apiBase, token: s.token, ticket, inputs, score, durationMs });
    if (r.unauthorized) s.expire(s.token);
    refreshBoard();
    return r;
  }, [apiBase, refreshBoard]);

  const scoring = useMemo(() => (scored && apiBase ? { start: startRound, finish: finishRound } : null),
    [scored, apiBase, startRound, finishRound]);
  const weekBest = scored ? (board.you ? board.you.best : (board.youKnown ? 0 : null)) : null;

  // --- pass status: fresh subscription state + cap + balances on every check ---
  const checkPass = useCallback(async () => {
    const seq = ++checkSeq.current;
    const commit = (next) => { if (seq === checkSeq.current) setPass({ ...next, account, subsKey }); };
    if (!configured) { commit({ checked: true, valid: false, reason: "not-configured", sub: null }); return; }
    if (!account) { commit({ checked: true, valid: false, reason: "no-subscription", sub: null }); return; }
    if (!ready) return; // stay "checking" until the first load completes
    if (arcadeSubs.length === 0) { commit({ checked: true, valid: false, reason: "no-subscription", sub: null }); return; }
    try {
      // No fallbacks: a failed read must never be evaluated as "no cap" or "nothing owed".
      const cap = await readSpendCap(ARCADE.merchant, account);
      const results = await Promise.all(arcadeSubs.map(async (s0) => {
        // Re-read: owed, stopTime, pause and dispute change without a refresh.
        const s = await readSubscription(s0.id);
        if (!s) throw new Error("Subscription unreadable");
        // Token state only matters when the solvency rule can be reached; reading
        // it for a record in a non-token address would throw and hide every pass.
        const needsTokenState = s.active && !hasEnded(s) && isStablecoin(s.tokenAddress);
        const tokenState = needsTokenState ? await readTokenState(s.tokenAddress, account) : { balance: 0n, allowance: 0n };
        return { ...evaluatePass(s, tokenState, { cap, account }), sub: s };
      }));
      const ok = results.find((r) => r.valid);
      if (ok) { commit({ checked: true, valid: true, reason: "ok", sub: ok.sub }); return; }
      const worst = [...results].sort((a, b) => rank(a.reason) - rank(b.reason))[0];
      // Only a fixable pass keeps its subscription; anything else leads to "start a new one".
      commit({ checked: true, valid: false, reason: worst.reason, needed: worst.needed ?? null,
               sub: PASS_REMEDY[worst.reason] ? worst.sub : null });
    } catch {
      if (seq !== checkSeq.current) return;
      // Fail closed: keep a known verdict on the same subscriptions (active, or a
      // fix to offer), but never fall back to one that offers buying.
      setPass((p) => (p.account === account && p.checked && p.subsKey === subsKey && (p.valid || PASS_REMEDY[p.reason])
        ? p
        : { account, subsKey, checked: true, valid: false, reason: "check-failed", sub: null }));
    }
  }, [configured, account, ready, arcadeSubs, subsKey, readSpendCap, readSubscription, readTokenState]);

  useEffect(() => {
    checkPass();
    const t = setInterval(checkPass, 60000);
    return () => clearInterval(t);
  }, [checkPass]);

  const recheck = useCallback(async () => {
    setRechecking(true);
    try { await checkPass(); } finally { setRechecking(false); }
  }, [checkPass]);

  // --- what the wallet can pay with ---
  /** Fresh stablecoin balances; null when they couldn't be read. */
  const loadStables = useCallback(async () => {
    if (!account || !readStablecoinBalances) return null;
    const seq = ++stablesSeq.current;
    try {
      const rows = await readStablecoinBalances(account);
      if (seq === stablesSeq.current) setStables({ account, status: "ready", rows });
      return rows;
    } catch {
      if (seq === stablesSeq.current) {
        setStables((s) => (s.account === account && s.status === "ready" ? s : { account, status: "failed", rows: NO_ROWS }));
      }
      return null;
    }
  }, [account, readStablecoinBalances]);
  useEffect(() => { loadStables(); }, [loadStables]);

  const stableRows = stables.rows;
  const payable = useMemo(() => stableRows.filter((t) => t.balance >= ARCADE_START_UNITS), [stableRows]);
  // The user's pick while it can still pay; otherwise the first stablecoin that can.
  const activePayToken = payable.some((p) => p.address === payToken) ? payToken : (payable[0]?.address || null);
  const qusdcBalance = stables.status === "ready" ? (stableRows.find((t) => isQusdc(t.address))?.balance ?? 0n) : null;

  const remedy = !pass.valid && pass.sub ? (PASS_REMEDY[pass.reason] || null) : null;
  const busy = !["idle", "done", "started"].includes(flow.step) || Boolean(v4?.busy);

  // --- a pass that was just created: hide every buy control until it shows up ---
  const awaitingNewPass = flow.step === "started";
  const knownIds = flow.knownIds;
  const newPassSeen = awaitingNewPass && arcadeSubs.some((s) => !(knownIds || []).includes(s.id));
  useEffect(() => {
    if (!awaitingNewPass) return undefined;
    if (newPassSeen) { setFlow("done"); return undefined; }
    if (v4Loading || newPassPolls >= NEW_PASS_POLLS) return undefined;
    const t = setTimeout(() => { setNewPassPolls((n) => n + 1); refreshV4?.(); }, NEW_PASS_POLL_MS);
    return () => clearTimeout(t);
  }, [awaitingNewPass, newPassSeen, v4Loading, newPassPolls, refreshV4, setFlow]);

  // --- QIE -> qUSDC quotes for 1 / 3 / 12 months (buying, or topping up a qUSDC pass) ---
  const topUpQusdc = remedy === "topup" && isQusdc(pass.sub?.tokenAddress);
  const needQuotes = configured && Boolean(account) && ready && !loadFailed && !isMerchantWallet && pass.checked &&
    pass.reason !== "check-failed" && !awaitingNewPass && qusdcBalance !== null &&
    (topUpQusdc || (!remedy && !pass.valid && payable.length === 0));
  // What the swap has to cover: a new pass, or m more months of the existing one.
  const basisMonthly = topUpQusdc ? monthlyUnits(pass.sub) : ARCADE.priceUnits;
  const basisOwed = topUpQusdc ? BigInt(pass.sub?.owed ?? 0) : 0n;
  const qieWeiBalance = toWei(qieBalance);
  const reserveWei = ethers.parseEther(String(GAS_RESERVE_QIE));

  useEffect(() => {
    if (!needQuotes || !readProviderFn) return undefined;
    let live = true;
    const load = async () => {
      const router = new ethers.Contract(QIEDEX_ROUTER, QIEDEX_ROUTER_ABI, readProviderFn());
      const entries = await Promise.all(MONTH_OPTIONS.map(async (m) => {
        try {
          return [m, await qieNeededFor(router, shortfallFor(m, basisMonthly, basisOwed, qusdcBalance))];
        } catch { return [m, null]; }
      }));
      let qieValue = null;
      if (qieWeiBalance > 0n) {
        try { qieValue = (await router.getAmountsOut(qieWeiBalance, [WQIE, V4_TOKEN]))[1]; } catch { /* shown without a dollar value */ }
      }
      if (!live) return;
      setQuotes({ account, status: entries.some(([, v]) => v !== null) ? "ready" : "failed",
                  byMonths: Object.fromEntries(entries), qieValue });
    };
    // Keep showing the last quote while a newer one loads.
    setQuotes((q) => (q.account === account && q.status === "ready" ? q : { account, status: "loading", byMonths: {}, qieValue: null }));
    load();
    // Prices move; a quote on screen is never more than a minute old.
    const t = setInterval(load, QUOTE_REFRESH_MS);
    return () => { live = false; clearInterval(t); };
  }, [needQuotes, readProviderFn, account, basisMonthly, basisOwed, qusdcBalance, qieWeiBalance]);

  const affordable = (m) => {
    const w = quotes.byMonths[m];
    return w !== null && w !== undefined && qieWeiBalance >= w + reserveWei;
  };
  const effectiveMonths = affordable(months) ? months : ([...MONTH_OPTIONS].reverse().find(affordable) ?? months);
  const canSwap = affordable(effectiveMonths);
  const lowGas = Number(qieBalance || 0) < LOW_GAS_QIE;

  // --- actions ---
  /** The wallet's Arcade subscriptions straight from the chain: their ids, and whether one is still live. */
  const arcadeOnChain = useCallback(async () => {
    const subs = arcadeSubscriptions(await readSubscriberSubscriptions(account), account);
    return { ids: subs.map((s) => s.id), live: subs.some((s) => s.active && !hasEnded(s)) };
  }, [readSubscriberSubscriptions, account]);

  const startPass = useCallback(async (token) => {
    if (!token) return false;
    const noPassCheck = "Couldn't confirm whether this wallet already has a pass, so nothing was started. Try again.";
    const alreadyHasPass = "This wallet already has an Arcade Pass, so a second one wasn't started. Reloading your pass…";
    // Never a second pass: the last refresh can be stale, so ask the chain.
    setFlow("verify");
    try {
      if ((await arcadeOnChain()).live) { setFlow("idle", alreadyHasPass); refreshV4?.(); return false; }
    } catch { setFlow("idle", noPassCheck); return false; }
    // Cap first, as in the regular subscribe flow: the stream must never exist uncapped.
    if (capOn) {
      setFlow("cap");
      const capped = await v4.setSpendCap(ARCADE.merchant, ARCADE_CAP_UNITS, ARCADE.periodSeconds);
      if (!capped) { setFlow("idle", "The spending limit wasn't set, so the pass wasn't started."); return false; }
    }
    // And once more right before creating: another tab may have started one meanwhile.
    setFlow("verify");
    let known;
    try { known = await arcadeOnChain(); } catch { setFlow("idle", noPassCheck); return false; }
    if (known.live) { setFlow("idle", alreadyHasPass); refreshV4?.(); return false; }
    setFlow("subscribe");
    const ok = await v4.createSubscription({
      merchant: ARCADE.merchant,
      amountPerPeriod: ARCADE.priceUnits,
      periodSeconds: ARCADE.periodSeconds,
      token,
    });
    if (!ok) { setFlow("idle", "The pass wasn't started. Check your wallet and try again."); return false; }
    setNewPassPolls(0);
    setFlow("started", "", { knownIds: known.ids });
    loadStables();
    return true;
  }, [capOn, v4, arcadeOnChain, refreshV4, loadStables, setFlow]);

  /**
   * Swap enough QIE for `m` months at `monthly` (plus `owed`). Re-reads the
   * balance and the price right before sending, and asks the swap for at least
   * the missing amount so it reverts rather than under-delivers. Returns fresh
   * balances, or null on failure.
   */
  const swapFor = useCallback(async (m, monthly, owed) => {
    trace("swap clicked", { months: m });
    if (!onSwapQie || !readProviderFn) {
      setFlow("idle", "The swap isn't available right now. Try again in a moment.");
      return null;
    }
    // Show progress before the first wallet call: a wallet that never answers
    // (locked, or a prompt hidden behind the browser) otherwise looks like a dead button.
    setFlow("network");
    try {
      await withTimeout(v4.ensureWalletChain(), WALLET_TIMEOUT_MS, WALLET_SILENT);
      trace("network ok");
    } catch (e) {
      trace("network check failed", e?.message);
      setFlow("idle", e?.message || "Switch your wallet to QIE Mainnet to continue.");
      return null;
    }
    setFlow("quote");
    let shortfall;
    let wei;
    try {
      const { balance } = await readTokenState(V4_TOKEN, account);
      shortfall = shortfallFor(m, monthly, owed, balance);
      const router = new ethers.Contract(QIEDEX_ROUTER, QIEDEX_ROUTER_ABI, readProviderFn());
      wei = await qieNeededFor(router, shortfall);
    } catch {
      setFlow("idle", "Couldn't get a fresh swap price. Try again in a moment.");
      return null;
    }
    if (shortfall === 0n) {
      // Already holds enough. A null here must still release the flow.
      const rows = await loadStables();
      if (!rows) setFlow("idle", "You already hold enough qUSDC, but your balances couldn't be read just now. Try again in a moment.");
      return rows;
    }
    if (qieWeiBalance < wei + reserveWei) {
      setFlow("idle", `The price moved: ${monthsLabel(m)} now needs about ${qie(wei)} QIE plus ${GAS_RESERVE_QIE} QIE for fees, and you have ${qie(qieWeiBalance)} QIE.`);
      return null;
    }
    setFlow("swap");
    trace("sending swap", { qie: ethers.formatEther(wei), minOut: shortfall.toString() });
    let swapped = false;
    let swapError = "";
    try {
      swapped = await onSwapQie(ethers.formatEther(wei), { minOut: shortfall });
    } catch (e) {
      swapError = e?.message || "";
    }
    trace("swap returned", swapped);
    const rows = await loadStables();
    if (!swapped) {
      // A slow confirmation also lands here, so don't claim nothing happened.
      setFlow("idle", swapError || "The swap didn't complete. If your wallet shows it went through, your qUSDC will appear shortly - check your balance before trying again.");
      return null;
    }
    if (!rows) {
      setFlow("idle", "The swap went through, but your balance couldn't be read yet. Check again in a moment before swapping more.");
      return null;
    }
    return rows;
  }, [onSwapQie, readProviderFn, v4, readTokenState, account, qieWeiBalance, reserveWei, loadStables, setFlow]);

  const swapAndStart = useCallback(async () => {
    const rows = await swapFor(effectiveMonths, ARCADE.priceUnits, 0n);
    if (!rows) return;
    const q = rows.find((r) => isQusdc(r.address));
    if (!q || q.balance < ARCADE_START_UNITS) {
      setFlow("idle", `Your qUSDC balance shows ${money(q?.balance)} and the pass needs ${moneyUp(ARCADE_START_UNITS)}. It can take a moment to update - check again before swapping more.`);
      return;
    }
    await startPass(V4_TOKEN);
  }, [swapFor, effectiveMonths, startPass, setFlow]);

  const topUp = useCallback(async () => {
    const s = pass.sub;
    if (!s) return;
    const rows = await swapFor(effectiveMonths, monthlyUnits(s), BigInt(s.owed ?? 0));
    if (!rows) return;
    await checkPass();
    setFlow("done");
  }, [pass.sub, swapFor, effectiveMonths, checkPass, setFlow]);

  const reapprove = useCallback(async () => {
    const s = pass.sub;
    if (!s) return;
    setFlow("fix");
    // A year of payments plus anything already owed.
    const ok = await v4.reapprove(s.tokenAddress, monthlyUnits(s) * 12n + BigInt(s.owed ?? 0));
    if (ok) { setFlow("done"); await checkPass(); } else { setFlow("idle", "The approval didn't go through. Try again."); }
  }, [pass.sub, v4, checkPass, setFlow]);

  const cancelOld = useCallback(async () => {
    if (!pass.sub) return;
    setFlow("fix");
    const ok = await v4.terminateStream(pass.sub.id);
    if (ok) setFlow("done"); else setFlow("idle", "The subscription wasn't cancelled. Try again.");
  }, [pass.sub, v4, setFlow]);

  const markFreeRound = useCallback(() => {
    if (passValid || freeUsed) return;
    writeFreeRound();
    setFreeUsed(true);
  }, [passValid, freeUsed]);

  // --- render helpers ---
  const snakeLocked = !passValid && freeUsed;
  const snakeLabel = passValid ? "Play" : (!freeUsed ? "Try one free round" : "Get the pass to play");
  const stepLabel = {
    network: "Checking your wallet…", quote: "Getting a fresh price…", swap: "Confirm the swap in your wallet…",
    verify: "Checking for an existing pass…", cap: "Setting your spending limit…",
    subscribe: "Starting your pass…", fix: "Waiting for your wallet…",
  }[flow.step] || "Waiting for your wallet…";
  const reasonCopy = pass.reason && !["no-subscription", "wrong-merchant", "wrong-subscriber", "ok", "not-configured", "check-failed"].includes(pass.reason)
    ? PASS_REASON_COPY[pass.reason] : null;

  const monthPicker = () => (
    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
      {MONTH_OPTIONS.map((m) => (
        <button key={m} disabled={busy || !affordable(m)}
                className={`fl-btn ${effectiveMonths === m ? "fl-btn--primary" : "fl-btn--ghost"}`}
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setMonths(m)}>{monthsLabel(m)}</button>
      ))}
    </div>
  );

  const mono = (text) => <span className="fl-mono" style={{ color: "var(--fl-fg-2)" }}>{text}</span>;
  const swapSummary = (forTopUp) => {
    const m = effectiveMonths;
    const short = shortfallFor(m, basisMonthly, basisOwed, qusdcBalance ?? 0n);
    return (
      <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, marginBottom: 12 }}>
        Swaps about {mono(`${qie(quotes.byMonths[m])} QIE`)} for at least {mono(money(short))} of qUSDC
        {forTopUp
          ? <>, enough to keep your pass running for {monthsLabel(m)} more.</>
          : <>{qusdcBalance > 0n ? <>, which with the {money(qusdcBalance)} you already hold</> : ", which"} covers {monthsLabel(m)} of the pass.</>}
        {" "}It stays in your own wallet - nothing is locked, and you're only charged as the pass runs.
      </div>
    );
  };

  // "You have $0.32 of qUSDC and 2.51 QIE (about $0.44). The pass needs $1.04 of qUSDC..."
  const shortfallCopy = () => {
    const held = stableRows.filter((t) => t.balance > 0n).map((t) => `${money(t.balance)} of ${t.symbol}`);
    const qiePart = qieWeiBalance > 0n
      ? `${qie(qieWeiBalance)} QIE${quotes.qieValue != null ? ` (about ${money(quotes.qieValue)})` : ""}`
      : "no QIE";
    const have = `You have ${held.length ? held.join(", ") : "no qUSDC"} and ${qiePart}.`;
    const need = `The pass needs ${moneyUp(ARCADE_START_UNITS)} of qUSDC (bridged USDC or USDT works too).`;
    const w1 = quotes.byMonths[1];
    if (quotes.status === "loading") return `${have} ${need}`;
    if (w1 === null || w1 === undefined) return `${have} ${need} Couldn't get a swap price for QIE right now.`;
    const short1 = shortfallFor(1, ARCADE.priceUnits, 0n, qusdcBalance ?? 0n);
    const swapPart = qusdcBalance > 0n
      ? `You're ${moneyUp(short1)} short in qUSDC - about ${qie(w1)} QIE to swap`
      : `In QIE that's about ${qie(w1)} QIE to swap`;
    return `${have} ${need} ${swapPart}, plus ${GAS_RESERVE_QIE} QIE kept back for fees.`;
  };

  const lowGasBlock = lowGas && (
    <>
      <Note tone="warn">You need a little QIE (about {LOW_GAS_QIE}) for network fees before you can continue.</Note>
      <div style={{ marginTop: 10 }}>
        {/* No swap route here: a swap needs QIE for fees too. */}
        <FundWallet compact account={account} qieBalance={qieBalance} />
      </div>
    </>
  );

  const signInLabel = session.signing ? "Check your wallet…" : "Sign in to the Arcade";
  // Shown inside the active-pass card only.
  const signInBlock = canSignIn && (
    <div style={{ borderTop: "1px solid var(--fl-border)", marginTop: 16, paddingTop: 14 }}>
      {session.signedIn ? (
        <>
          <div className="fl-row--between" style={{ marginBottom: 4 }}>
            <span style={{ color: "var(--fl-fg)", fontSize: 13, fontWeight: 600 }}>Signed in to the Arcade</span>
            <button className="fl-link" style={{ fontSize: 12 }} onClick={session.signOut}>Sign out</button>
          </div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55 }}>
            Your Snake scores now count for the weekly board, and you can use the AI assistant.
            The sign-in lasts up to 12 hours in this tab.
          </div>
        </>
      ) : (
        <>
          <div style={{ color: "var(--fl-fg-2)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
            Sign in to put your Snake scores on the weekly board and use the AI assistant.
            It's one signature in your wallet - no transaction and no gas.
          </div>
          <button className="fl-btn fl-btn--primary fl-btn--block" disabled={session.signing} onClick={session.signIn}>
            {signInLabel}
          </button>
          {session.error && <Note tone="warn">{session.error}</Note>}
        </>
      )}
    </div>
  );

  // Under the board for a pass holder who hasn't signed in.
  const snakeNote = canSignIn && !session.signedIn && (session.signing
    ? "Check your wallet to finish signing in."
    : (
      <>
        <button className="fl-link" style={{ fontSize: 12, padding: 0 }} onClick={session.signIn}>{signInLabel}</button>
        {" "}to put your scores on the weekly board.
      </>
    ));

  const card = (children) => <div className="fl-card">{children}</div>;
  const retryPanel = (body, onRetry, retrying) => card(
    <>
      <div className="fl-lbl" style={{ marginBottom: 10 }}>Arcade Pass</div>
      <div style={{ color: "var(--fl-fg)", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Couldn't check your pass</div>
      <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>{body}</div>
      <button className="fl-btn fl-btn--ghost fl-btn--block" disabled={retrying} onClick={onRetry}>
        {retrying ? "Checking…" : "Retry"}
      </button>
    </>
  );

  const PassPanel = () => {
    if (!configured) {
      return card(
        <>
          <div className="fl-lbl" style={{ marginBottom: 10 }}>Arcade Pass</div>
          <div style={{ color: "var(--fl-fg)", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Launching soon</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6 }}>
            The pass isn't open yet. You can still try one free round of Snake.
          </div>
        </>
      );
    }

    const header = (
      <>
        <div className="fl-lbl" style={{ marginBottom: 12 }}>Arcade Pass</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 12 }}>
          <span className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 30, fontWeight: 700 }}>$1</span>
          <span style={{ color: "var(--fl-fg-3)", fontSize: 13 }}>/ month</span>
        </div>
        <div style={{ display: "grid", gap: 7, marginBottom: 16 }}>
          {["Unlimited Snake", "AI assistant for QIE and Fluenci", "Cancel anytime - nothing new builds up after you cancel"].map((f) => (
            <div key={f} style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--fl-fg-2)", fontSize: 12.5 }}>
              <IconCheck size={13} stroke="var(--fl-accent)" /> {f}
            </div>
          ))}
        </div>
      </>
    );

    if (!account) {
      return card(
        <>
          {header}
          <button className="fl-btn fl-btn--primary fl-btn--block" onClick={onConnect}>Connect wallet</button>
        </>
      );
    }

    if (isMerchantWallet) {
      return card(
        <>
          {header}
          <div style={{ color: "var(--fl-fg-2)", fontSize: 12.5, lineHeight: 1.6 }}>
            This is the Arcade's merchant wallet. Switch to a different wallet to buy a pass.
          </div>
        </>
      );
    }

    if (loadFailed) {
      return retryPanel("Your subscriptions couldn't be loaded from the QIE network, so nothing can be bought or changed here until they are.",
        () => refreshV4?.(), v4Loading);
    }

    if (!ready || !pass.checked || pass.subsKey !== subsKey) {
      return card(
        <>
          <div className="fl-lbl" style={{ marginBottom: 10 }}>Arcade Pass</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5 }}>Checking your pass…</div>
        </>
      );
    }

    if (pass.reason === "check-failed") {
      return retryPanel("The QIE network didn't answer while checking your pass. Buying is paused until the check goes through.",
        recheck, rechecking);
    }

    if (awaitingNewPass && !newPassSeen) {
      const gaveUp = newPassPolls >= NEW_PASS_POLLS && !v4Loading;
      return card(
        <>
          <div className="fl-lbl" style={{ marginBottom: 10 }}>Arcade Pass</div>
          <div style={{ color: "var(--fl-fg)", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Your pass was started</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: gaveUp ? 14 : 0 }}>
            {gaveUp
              ? "It hasn't shown up here yet - the network can lag. Check again in a moment; don't start another one."
              : "Waiting for it to show up here…"}
          </div>
          {gaveUp && (
            <button className="fl-btn fl-btn--ghost fl-btn--block" onClick={() => refreshV4?.()}>Check again</button>
          )}
        </>
      );
    }

    if (pass.valid) {
      const token = stablecoinOf(pass.sub?.tokenAddress);
      return card(
        <>
          <div className="fl-row--between" style={{ marginBottom: 12 }}>
            <div className="fl-lbl">Arcade Pass</div>
            <span className="fl-pill fl-pill--on">Active</span>
          </div>
          <div style={{ color: "var(--fl-fg)", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>You're in. Enjoy the Arcade.</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
            {ARCADE.priceLabel}{token ? `, paid in ${token.symbol}` : ""}. Billed as it runs; cancel anytime from your dashboard.
          </div>
          <button className="fl-link" style={{ fontSize: 12.5 }} onClick={() => onNavigate?.("dashboard")}>Manage subscription &rarr;</button>
          {signInBlock}
        </>
      );
    }

    // An existing pass with a fixable problem: fix it, never open a second subscription.
    if (remedy) {
      const token = stablecoinOf(pass.sub?.tokenAddress);
      const tokenLabel = token?.symbol || "the stablecoin your pass is paid in";
      const heldOfPassToken = stableRows.find((t) => sameAddress(t.address, pass.sub?.tokenAddress))?.balance;
      // A stablecoin the wallet holds that could pay a fresh pass instead.
      const otherPayable = payable.filter((t) => !sameAddress(t.address, pass.sub?.tokenAddress));
      const w1 = quotes.byMonths[1];
      return card(
        <>
          <div className="fl-row--between" style={{ marginBottom: 12 }}>
            <div className="fl-lbl">Arcade Pass</div>
            <span className="fl-pill fl-pill--warn">Needs attention</span>
          </div>
          {reasonCopy && <div style={{ color: "var(--fl-fg-2)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>{reasonCopy}</div>}

          {remedy === "reapprove" && (
            <button className="fl-btn fl-btn--primary fl-btn--block" disabled={busy || lowGas} onClick={reapprove}>
              {busy ? stepLabel : "Re-approve payments"}
            </button>
          )}

          {remedy === "topup" && (
            <>
              {pass.needed != null && heldOfPassToken !== undefined && stables.status === "ready" && (
                <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
                  Right now it needs at least {moneyUp(pass.needed)} of {tokenLabel} in your wallet, and you have {money(heldOfPassToken)}.
                </div>
              )}
              {topUpQusdc && quotes.status === "ready" && canSwap ? (
                <>
                  {monthPicker()}
                  {swapSummary(true)}
                  <button className="fl-btn fl-btn--primary fl-btn--block" disabled={busy || !onSwapQie || lowGas} onClick={topUp}>
                    {busy ? stepLabel : "Swap QIE to top up"}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
                    Add {tokenLabel} to your wallet to keep the pass running.
                  </div>
                  <FundWallet compact account={account} qieBalance={qieBalance}
                              payToken={pass.sub?.tokenAddress}
                              qieNeeded={topUpQusdc && w1 != null ? ethers.formatEther(w1 + reserveWei) : null}
                              onSwap={topUpQusdc ? () => onNavigate?.("swap") : null} />
                </>
              )}
              {otherPayable.length > 0 && (
                <>
                  <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, margin: "14px 0 10px" }}>
                    Or cancel this pass, then start a new one with the {otherPayable[0].symbol} you hold.
                    You'll still owe what this pass has already accrued.
                  </div>
                  <button className="fl-btn fl-btn--ghost fl-btn--block" disabled={busy || lowGas} onClick={cancelOld}>
                    {busy ? stepLabel : "Cancel this pass"}
                  </button>
                </>
              )}
            </>
          )}

          {remedy === "limits" && (
            <button className="fl-btn fl-btn--primary fl-btn--block" onClick={() => onNavigate?.("limits")}>Open Spending Limits</button>
          )}

          {remedy === "protect" && (
            <button className="fl-btn fl-btn--primary fl-btn--block" onClick={() => onNavigate?.("protect")}>Open Protect</button>
          )}

          {remedy === "cancel" && (
            <>
              <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, marginBottom: 12 }}>
                Cancel this subscription first, then start a new pass. You'll only owe what it has already accrued.
              </div>
              <button className="fl-btn fl-btn--ghost fl-btn--block" disabled={busy || lowGas} onClick={cancelOld}>
                {busy ? stepLabel : "Cancel this subscription"}
              </button>
            </>
          )}

          {lowGasBlock}
          {flow.error && <Note tone="warn">{flow.error}</Note>}
        </>
      );
    }

    // No live pass (none yet, or only cancelled ones): offer to start one.
    let buy;
    if (stables.status === "failed") {
      buy = (
        <>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
            Couldn't read your wallet balances from the QIE network.
          </div>
          <button className="fl-btn fl-btn--ghost fl-btn--block" onClick={() => loadStables()}>Retry</button>
        </>
      );
    } else if (stables.status !== "ready") {
      buy = <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5 }}>Checking your balances…</div>;
    } else if (payable.length > 0) {
      buy = (
        <>
          {payable.length > 1 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
              {payable.map((t) => (
                <button key={t.address} disabled={busy}
                        className={`fl-pill ${activePayToken === t.address ? "fl-pill--on" : "fl-pill--off"}`}
                        style={{ cursor: "pointer", border: "none" }}
                        onClick={() => setPayToken(t.address)}>
                  Pay with {t.symbol} · {money(t.balance)}
                </button>
              ))}
            </div>
          )}
          <button className="fl-btn fl-btn--primary fl-btn--block" disabled={busy || !activePayToken || lowGas}
                  onClick={() => startPass(activePayToken)}>
            {busy ? stepLabel : `Start Arcade Pass${payable.length === 1 ? ` with ${payable[0].symbol}` : ""}`}
          </button>
        </>
      );
    } else if (quotes.status === "loading" && !canSwap) {
      buy = <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5 }}>Checking the swap price…</div>;
    } else if (canSwap) {
      buy = (
        <>
          <div className="fl-lbl" style={{ marginBottom: 8 }}>Pay with QIE</div>
          {monthPicker()}
          {swapSummary(false)}
          <button className="fl-btn fl-btn--primary fl-btn--block" disabled={busy || !onSwapQie || lowGas} onClick={swapAndStart}>
            {busy ? stepLabel : "Swap and start pass"}
          </button>
        </>
      );
    } else {
      const w1 = quotes.byMonths[1];
      buy = (
        <>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>{shortfallCopy()}</div>
          <FundWallet compact account={account} qieBalance={qieBalance} onSwap={() => onNavigate?.("swap")}
                      qieNeeded={w1 != null ? ethers.formatEther(w1 + reserveWei) : null} />
        </>
      );
    }

    return card(
      <>
        {header}
        {reasonCopy && (
          <div className="fl-inner" style={{ padding: "10px 12px", marginBottom: 12, borderColor: "var(--fl-warn)" }}>
            <span style={{ color: "var(--fl-warn)", fontSize: 12, lineHeight: 1.5 }}>{reasonCopy}</span>
          </div>
        )}

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "var(--fl-fg-2)", fontSize: 12, marginBottom: 14, cursor: "pointer", lineHeight: 1.5 }}>
          <input type="checkbox" checked={capOn} disabled={busy} onChange={(e) => setCapOn(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            Limit what the Arcade can ever take to {money(ARCADE_CAP_UNITS)}/month (recommended).
            <span style={{ color: "var(--fl-fg-3)" }}> You're charged $1/month; the headroom only lets a late charge catch up.</span>
          </span>
        </label>

        {buy}

        {lowGasBlock}
        {flow.error && <Note tone="warn">{flow.error}</Note>}
      </>
    );
  };

  return (
    <>
      <h1 className="fl-title">Arcade</h1>
      <p className="fl-sub">
        Snake and an AI assistant, unlocked with a {ARCADE.priceLabel} Arcade Pass. Paid with Fluenci, cancel anytime.
      </p>

      <div className="fl-split">
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <TabButton active={tab === "snake"} label="Snake" onSelect={() => setTab("snake")} />
            <TabButton active={tab === "chat"} label="AI Assistant" onSelect={() => setTab("chat")} />
          </div>
          {tab === "snake" ? (
            <SnakeGame disabled={snakeLocked} startLabel={snakeLabel} onStart={markFreeRound}
                       scoring={scoring} weekBest={weekBest} note={snakeNote || null} />
          ) : (
            <ArcadeChat apiBase={apiBase} disabled={!passValid}
                        token={session.token}
                        onSignIn={canSignIn ? session.signIn : null}
                        signingIn={session.signing}
                        signInError={session.error}
                        onUnauthorized={session.expire} />
          )}
          {!passValid && tab === "chat" && (
            <div style={{ color: "var(--fl-fg-3)", fontSize: 12, marginTop: 10 }}>The AI assistant unlocks with the Arcade Pass.</div>
          )}
        </div>
        <div>
          {PassPanel()}
          {configured && apiBase && tab === "snake" && (
            <Leaderboard status={board.status} week={board.week} entries={board.entries} you={board.you}
                         youKnown={board.youKnown} names={board.names} account={account}
                         signedIn={session.signedIn} passValid={passValid} onRetry={refreshBoard} />
          )}
        </div>
      </div>
    </>
  );
}
