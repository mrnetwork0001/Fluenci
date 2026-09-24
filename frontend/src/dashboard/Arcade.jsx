import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import SnakeGame from "./arcade/SnakeGame";
import ArcadeChat from "./arcade/ArcadeChat";
import FundWallet from "./FundWallet";
import { IconCheck } from "./icons";
import {
  ARCADE, QUSDC_DECIMALS, QIEDEX_ROUTER, QIEDEX_ROUTER_ABI, WQIE, V4_TOKEN,
  LOW_GAS_QIE, GAS_RESERVE_QIE, stablecoinOf,
} from "./v4Config";
import { evaluatePass, arcadeSubscriptions, PASS_REASON_COPY, PASS_REMEDY, ARCADE_CAP_UNITS } from "./arcadePass";

const FREE_ROUND_KEY = "fluenci_arcade_free_round";
const MONTH_OPTIONS = [1, 3, 12];
const money = (units) => `$${Number(ethers.formatUnits(units ?? 0n, QUSDC_DECIMALS)).toFixed(2)}`;
const qie = (wei) => Number(ethers.formatEther(wei ?? 0n)).toFixed(4).replace(/\.?0+$/, "");
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

function readFreeRound() {
  try { return sessionStorage.getItem(FREE_ROUND_KEY) === "1"; } catch { return false; }
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
 *  - never offer "buy" before the user's subscriptions have loaded;
 *  - a pass that exists but has lapsed gets a FIX (re-approve, top up, raise
 *    the limit, cancel) - never a second subscription billing alongside it;
 *  - the recommended cap is 2x the price so a late charge can still clear.
 */
export default function Arcade({
  account = null,
  onConnect = null,
  v4,
  qieBalance = "0",
  onSwapQie = null,        // (qieAmountString) => Promise<boolean>
  apiBase = null,
  onNavigate = null,
  unavailable = false,     // v4 registry not configured in this build
}) {
  const [tab, setTab] = useState("snake");
  const [pass, setPass] = useState({ checked: false, valid: false, reason: "no-subscription", sub: null });
  const [stables, setStables] = useState([]);
  const [payToken, setPayToken] = useState(null);
  const [months, setMonths] = useState(3);
  const [capOn, setCapOn] = useState(true);
  const [quotes, setQuotes] = useState({ status: "idle", byMonths: {} });
  const [flow, setFlow] = useState({ step: "idle", error: "" }); // idle | swap | cap | subscribe | fix | done
  const [freeUsed, setFreeUsed] = useState(readFreeRound);

  const configured = Boolean(ARCADE.merchant) && !unavailable;
  const ready = !account || Boolean(v4?.loaded);
  const arcadeSubs = useMemo(() => arcadeSubscriptions(v4?.subscriptions), [v4?.subscriptions]);
  const readTokenState = v4?.readTokenState;
  const readStablecoinBalances = v4?.readStablecoinBalances;
  const readSubscription = v4?.readSubscription;
  const readSpendCap = v4?.readSpendCap;
  const readProviderFn = v4?.readProvider;

  // --- pass status: fresh subscription state + cap + balances on every check ---
  const checkPass = useCallback(async () => {
    if (!configured) { setPass({ checked: true, valid: false, reason: "not-configured", sub: null }); return; }
    if (!account) { setPass({ checked: true, valid: false, reason: "no-subscription", sub: null }); return; }
    if (!ready) return; // stay "checking" until the first load completes
    if (arcadeSubs.length === 0) { setPass({ checked: true, valid: false, reason: "no-subscription", sub: null }); return; }
    try {
      const cap = await readSpendCap(ARCADE.merchant).catch(() => null);
      const results = await Promise.all(arcadeSubs.map(async (s0) => {
        // Re-read: owed, stopTime, pause and dispute change without a refresh.
        const s = (await readSubscription(s0.id).catch(() => null)) || s0;
        return { ...evaluatePass(s, await readTokenState(s.tokenAddress), { cap }), sub: s };
      }));
      const ok = results.find((r) => r.valid);
      if (ok) { setPass({ checked: true, valid: true, reason: "ok", sub: ok.sub }); return; }
      const worst = [...results].sort((a, b) => rank(a.reason) - rank(b.reason))[0];
      setPass({ checked: true, valid: false, reason: worst.reason, sub: worst.reason === "cancelled" ? null : worst.sub });
    } catch {
      setPass((p) => ({ ...p, checked: true }));
    }
  }, [configured, account, ready, arcadeSubs, readSpendCap, readSubscription, readTokenState]);

  useEffect(() => {
    checkPass();
    const t = setInterval(checkPass, 60000);
    return () => clearInterval(t);
  }, [checkPass]);

  // --- what the wallet can pay with ---
  const loadStables = useCallback(async () => {
    if (!account || !readStablecoinBalances) { setStables([]); return []; }
    try { const rows = await readStablecoinBalances(); setStables(rows); return rows; } catch { return []; }
  }, [account, readStablecoinBalances]);
  useEffect(() => { loadStables(); }, [loadStables]);

  const payable = useMemo(() => stables.filter((t) => t.balance >= ARCADE.priceUnits), [stables]);
  // The user's pick while it can still pay; otherwise the first stablecoin that can.
  const activePayToken = payable.some((p) => p.address === payToken) ? payToken : (payable[0]?.address || null);

  const remedy = !pass.valid && pass.sub ? (PASS_REMEDY[pass.reason] || null) : null;
  const busy = flow.step !== "idle" && flow.step !== "done";

  // --- QIE -> qUSDC quotes for 1 / 3 / 12 months (buying, or topping up a qUSDC pass) ---
  const topUpQusdc = remedy === "topup" && pass.sub?.tokenAddress?.toLowerCase() === V4_TOKEN.toLowerCase();
  const needQuotes = configured && Boolean(account) && ready && (topUpQusdc || (!remedy && !pass.valid && payable.length === 0));
  useEffect(() => {
    if (!needQuotes || !readProviderFn) return undefined;
    let live = true;
    setQuotes((q) => ({ ...q, status: "loading" }));
    (async () => {
      const router = new ethers.Contract(QIEDEX_ROUTER, QIEDEX_ROUTER_ABI, readProviderFn());
      const entries = await Promise.all(MONTH_OPTIONS.map(async (m) => {
        try {
          // 3% headroom so price movement and the swap's slippage floor still leave enough qUSDC.
          const a = await router.getAmountsIn((ARCADE.priceUnits * BigInt(m) * 103n) / 100n, [WQIE, V4_TOKEN]);
          return [m, a[0]];
        } catch { return [m, null]; }
      }));
      if (!live) return;
      const byMonths = Object.fromEntries(entries);
      setQuotes({ status: entries.some(([, v]) => v !== null) ? "ready" : "failed", byMonths });
    })();
    return () => { live = false; };
  }, [needQuotes, readProviderFn]);

  const qieWeiBalance = toWei(qieBalance);
  const reserveWei = ethers.parseEther(String(GAS_RESERVE_QIE));
  const affordable = (m) => {
    const w = quotes.byMonths[m];
    return w !== null && w !== undefined && qieWeiBalance >= w + reserveWei;
  };
  const effectiveMonths = affordable(months) ? months : ([...MONTH_OPTIONS].reverse().find(affordable) ?? months);
  const canSwap = affordable(effectiveMonths);
  const lowGas = Number(qieBalance || 0) < LOW_GAS_QIE;

  // --- actions ---
  const startPass = useCallback(async (token) => {
    setFlow({ step: capOn ? "cap" : "subscribe", error: "" });
    // Cap first, as in the regular subscribe flow: the stream must never exist uncapped.
    if (capOn) {
      const capped = await v4.setSpendCap(ARCADE.merchant, ARCADE_CAP_UNITS, ARCADE.periodSeconds);
      if (!capped) { setFlow({ step: "idle", error: "The spending limit wasn't set, so the pass wasn't started." }); return false; }
      setFlow({ step: "subscribe", error: "" });
    }
    const ok = await v4.createSubscription({
      merchant: ARCADE.merchant,
      amountPerPeriod: ARCADE.priceUnits,
      periodSeconds: ARCADE.periodSeconds,
      token,
    });
    if (!ok) { setFlow({ step: "idle", error: "The pass wasn't started. Check your wallet and try again." }); return false; }
    await loadStables();
    setFlow({ step: "done", error: "" });
    return true;
  }, [capOn, v4, loadStables]);

  /** Swap enough QIE for `m` months of qUSDC. Returns fresh balances, or null on failure. */
  const swapFor = useCallback(async (m) => {
    const wei = quotes.byMonths[m];
    trace("swap clicked", { months: m, qie: wei ? ethers.formatEther(wei) : null });
    if (!onSwapQie || wei === null || wei === undefined) {
      setFlow({ step: "idle", error: "The swap price isn't ready yet. Try again in a moment." });
      return null;
    }
    // Show progress before the first wallet call: a wallet that never answers
    // (locked, or a prompt hidden behind the browser) otherwise looks like a dead button.
    setFlow({ step: "network", error: "" });
    try {
      await withTimeout(v4.ensureWalletChain(), WALLET_TIMEOUT_MS, WALLET_SILENT);
      trace("network ok");
    } catch (e) {
      trace("network check failed", e?.message);
      setFlow({ step: "idle", error: e?.message || "Switch your wallet to QIE Mainnet to continue." });
      return null;
    }
    setFlow({ step: "swap", error: "" });
    trace("sending swap");
    const swapped = await onSwapQie(ethers.formatEther(wei));
    trace("swap returned", swapped);
    const rows = await loadStables();
    if (!swapped) {
      // A slow confirmation also lands here, so don't claim nothing happened.
      setFlow({ step: "idle", error: "The swap didn't confirm. If your wallet shows it went through, your qUSDC will appear shortly - check your balance before trying again." });
      return null;
    }
    return rows;
  }, [quotes.byMonths, onSwapQie, v4, loadStables]);

  const swapAndStart = useCallback(async () => {
    const rows = await swapFor(effectiveMonths);
    if (!rows) return;
    const q = rows.find((r) => r.address.toLowerCase() === V4_TOKEN.toLowerCase());
    if (!q || q.balance < ARCADE.priceUnits) {
      setFlow({ step: "idle", error: "The swap landed but returned less qUSDC than expected. Try starting the pass again." });
      return;
    }
    await startPass(V4_TOKEN);
  }, [swapFor, effectiveMonths, startPass]);

  const topUp = useCallback(async () => {
    const rows = await swapFor(effectiveMonths);
    if (!rows) return;
    await checkPass();
    setFlow({ step: "done", error: "" });
  }, [swapFor, effectiveMonths, checkPass]);

  const reapprove = useCallback(async () => {
    const s = pass.sub;
    if (!s) return;
    setFlow({ step: "fix", error: "" });
    const monthly = (BigInt(s.amountPerPeriod) * BigInt(ARCADE.periodSeconds)) / BigInt(s.periodSeconds || 1);
    // A year of payments plus anything already owed.
    const ok = await v4.reapprove(s.tokenAddress, monthly * 12n + BigInt(s.owed || 0));
    setFlow(ok ? { step: "done", error: "" } : { step: "idle", error: "The approval didn't go through. Try again." });
    if (ok) await checkPass();
  }, [pass.sub, v4, checkPass]);

  const cancelOld = useCallback(async () => {
    if (!pass.sub) return;
    setFlow({ step: "fix", error: "" });
    const ok = await v4.terminateStream(pass.sub.id);
    setFlow(ok ? { step: "done", error: "" } : { step: "idle", error: "The subscription wasn't cancelled. Try again." });
  }, [pass.sub, v4]);

  const markFreeRound = useCallback(() => {
    if (pass.valid || freeUsed) return;
    try { sessionStorage.setItem(FREE_ROUND_KEY, "1"); } catch { /* private mode: the round just isn't remembered */ }
    setFreeUsed(true);
  }, [pass.valid, freeUsed]);

  // --- render helpers ---
  const snakeLocked = !pass.valid && freeUsed;
  const snakeLabel = pass.valid ? "Play" : (!freeUsed ? "Try one free round" : "Get the pass to play");
  const stepLabel = {
    network: "Checking your wallet…", swap: "Confirm the swap in your wallet…", cap: "Setting your spending limit…",
    subscribe: "Starting your pass…", fix: "Waiting for your wallet…",
  }[flow.step];
  const reasonCopy = pass.reason && !["no-subscription", "wrong-merchant", "ok", "not-configured"].includes(pass.reason)
    ? PASS_REASON_COPY[pass.reason] : null;

  const monthPicker = () => (
    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
      {MONTH_OPTIONS.map((m) => (
        <button key={m} disabled={busy || !affordable(m)}
                className={`fl-btn ${effectiveMonths === m ? "fl-btn--primary" : "fl-btn--ghost"}`}
                style={{ padding: "6px 12px", fontSize: 12 }}
                onClick={() => setMonths(m)}>{m} {m === 1 ? "month" : "months"}</button>
      ))}
    </div>
  );

  const swapSummary = (label) => (
    <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, marginBottom: 12 }}>
      {label} about <span className="fl-mono" style={{ color: "var(--fl-fg-2)" }}>{qie(quotes.byMonths[effectiveMonths])} QIE</span> for{" "}
      <span className="fl-mono" style={{ color: "var(--fl-fg-2)" }}>{money(ARCADE.priceUnits * BigInt(effectiveMonths))}</span> of qUSDC,
      kept in your own wallet. Nothing is locked; you're only charged as the pass runs.
    </div>
  );

  const lowGasBlock = lowGas && (
    <>
      <Note tone="warn">You need a little QIE (about {LOW_GAS_QIE}) for network fees before you can continue.</Note>
      <div style={{ marginTop: 10 }}>
        <FundWallet compact account={account} qieBalance={qieBalance} onSwap={() => onNavigate?.("swap")} />
      </div>
    </>
  );

  const PassPanel = () => {
    if (!configured) {
      return (
        <div className="fl-card">
          <div className="fl-lbl" style={{ marginBottom: 10 }}>Arcade Pass</div>
          <div style={{ color: "var(--fl-fg)", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Launching soon</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6 }}>
            The pass isn't open yet. You can still try one free round of Snake.
          </div>
        </div>
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
          {["Unlimited Snake", "AI assistant for QIE and Fluenci", "Cancel anytime; billing stops when you cancel"].map((f) => (
            <div key={f} style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--fl-fg-2)", fontSize: 12.5 }}>
              <IconCheck size={13} stroke="var(--fl-accent)" /> {f}
            </div>
          ))}
        </div>
      </>
    );

    if (!account) {
      return (
        <div className="fl-card">
          {header}
          <button className="fl-btn fl-btn--primary fl-btn--block" onClick={onConnect}>Connect wallet</button>
        </div>
      );
    }

    if (!ready || !pass.checked) {
      return (
        <div className="fl-card">
          <div className="fl-lbl" style={{ marginBottom: 10 }}>Arcade Pass</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5 }}>Checking your pass…</div>
        </div>
      );
    }

    if (pass.valid) {
      const token = stablecoinOf(pass.sub?.tokenAddress);
      return (
        <div className="fl-card">
          <div className="fl-row--between" style={{ marginBottom: 12 }}>
            <div className="fl-lbl">Arcade Pass</div>
            <span className="fl-pill fl-pill--on">Active</span>
          </div>
          <div style={{ color: "var(--fl-fg)", fontSize: 15, fontWeight: 600, marginBottom: 6 }}>You're in. Enjoy the Arcade.</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
            {ARCADE.priceLabel}{token ? `, paid in ${token.symbol}` : ""}. Billed as it runs; cancel anytime from your dashboard.
          </div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.6, marginBottom: 14 }}>
            A weekly leaderboard with prizes is coming next.
          </div>
          <button className="fl-link" style={{ fontSize: 12.5 }} onClick={() => onNavigate?.("dashboard")}>Manage subscription &rarr;</button>
        </div>
      );
    }

    // An existing pass with a fixable problem: fix it, never open a second subscription.
    if (remedy) {
      const token = stablecoinOf(pass.sub?.tokenAddress);
      return (
        <div className="fl-card">
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
            topUpQusdc && quotes.status === "ready" && canSwap ? (
              <>
                {monthPicker()}
                {swapSummary("Swaps")}
                <button className="fl-btn fl-btn--primary fl-btn--block" disabled={busy || !onSwapQie} onClick={topUp}>
                  {busy ? stepLabel : "Swap QIE to top up"}
                </button>
              </>
            ) : (
              <>
                <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
                  Add {token?.symbol || "the stablecoin your pass is paid in"} to your wallet to keep the pass running.
                </div>
                <FundWallet compact account={account} qieBalance={qieBalance} onSwap={() => onNavigate?.("swap")} />
              </>
            )
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
        </div>
      );
    }

    // No live pass (none yet, or only cancelled ones): offer to start one.
    return (
      <div className="fl-card">
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

        {payable.length > 0 ? (
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
        ) : quotes.status === "loading" && !canSwap ? (
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5 }}>Checking the swap price…</div>
        ) : canSwap ? (
          <>
            <div className="fl-lbl" style={{ marginBottom: 8 }}>Pay with QIE</div>
            {monthPicker()}
            {swapSummary("Swaps")}
            <button className="fl-btn fl-btn--primary fl-btn--block" disabled={busy || !onSwapQie || lowGas} onClick={swapAndStart}>
              {busy ? stepLabel : "Swap and start pass"}
            </button>
          </>
        ) : (
          <>
            <div style={{ color: "var(--fl-fg-3)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
              {quotes.status === "failed"
                ? "Couldn't get a swap price right now. You can also start with $1 of qUSDC or bridged USDC/USDT."
                : "You need $1 of qUSDC or bridged USDC/USDT, or a little QIE to swap, to start the pass."}
            </div>
            <FundWallet compact account={account} qieBalance={qieBalance} onSwap={() => onNavigate?.("swap")} />
          </>
        )}

        {lowGasBlock}
        {flow.error && <Note tone="warn">{flow.error}</Note>}
      </div>
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
            <SnakeGame disabled={snakeLocked} startLabel={snakeLabel} onStart={markFreeRound} />
          ) : (
            <ArcadeChat apiBase={apiBase} disabled={!pass.valid} />
          )}
          {!pass.valid && tab === "chat" && (
            <div style={{ color: "var(--fl-fg-3)", fontSize: 12, marginTop: 10 }}>The AI assistant unlocks with the Arcade Pass.</div>
          )}
        </div>
        <div>{PassPanel()}</div>
      </div>
    </>
  );
}
