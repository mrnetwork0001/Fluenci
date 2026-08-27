import React, { useMemo, useState } from "react";
import { IconSwap, IconChevronDown } from "./icons";

const PAIR = {
  QIE:   { symbol: "QIE",   decimals: 18, name: "QIE" },
  QUSDC: { symbol: "qUSDC", decimals: 6,  name: "QIE Stable Coin" },
};

const trim = (s, dp) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(dp).replace(/\.?0+$/, "") || "0";
};

/**
 * QIE ⇄ qUSDC through QIEDex. Subscriptions settle in qUSDC, so this exists to
 * get people funded - it is plumbing, not a trading product, and is presented
 * as one quote and one action rather than a DEX console.
 */
export default function Swap({
  loading = false,
  swapping = false,
  error = null,
  qieBalance = "0",
  qusdcBalance = "0",
  quote = null,          // { amountOut, rate, priceImpact } | null
  quoting = false,
  onQuote = null,
  onSwap = null,
  onFund = null,
}) {
  const [reverse, setReverse] = useState(false); // false: QIE -> qUSDC
  const [amount, setAmount] = useState("");

  const from = reverse ? PAIR.QUSDC : PAIR.QIE;
  const to = reverse ? PAIR.QIE : PAIR.QUSDC;
  const fromBalance = reverse ? qusdcBalance : qieBalance;
  const toBalance = reverse ? qieBalance : qusdcBalance;

  const amountNum = Number(amount);
  const overBalance = Number.isFinite(amountNum) && amountNum > Number(fromBalance || 0);
  const canSwap = Number.isFinite(amountNum) && amountNum > 0 && !overBalance && !swapping;

  const flip = () => {
    setReverse((r) => !r);
    setAmount("");
  };

  const setAndQuote = (v) => {
    setAmount(v);
    if (Number(v) > 0) onQuote?.({ from: from.symbol, to: to.symbol, amount: v, reverse: !reverse });
  };

  const received = useMemo(() => {
    if (quoting) return "…";
    if (!quote?.amountOut) return "0";
    return trim(quote.amountOut, to.decimals === 6 ? 2 : 4);
  }, [quote, quoting, to.decimals]);

  return (
    <>
      <h1 className="fl-title">Swap</h1>
      <p className="fl-sub">
        Subscriptions settle in qUSDC. Swap through QIEDex to fund one, or convert back out.
      </p>

      <div style={{ maxWidth: 460 }}>
        <div className="fl-card">
          {/* pay */}
          <div className="fl-row--between" style={{ marginBottom: 9 }}>
            <span className="fl-lbl">You pay</span>
            <button className="fl-link" style={{ fontSize: 11.5 }}
                    onClick={() => setAndQuote(String(fromBalance || 0))}>
              Balance {trim(fromBalance, from.decimals === 6 ? 2 : 4)} - use max
            </button>
          </div>
          <div className="fl-inner" style={{ display: "flex", alignItems: "center", padding: "13px 16px", marginBottom: 10 }}>
            <input
              className="fl-mono"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              disabled={loading || swapping}
              onChange={(e) => setAndQuote(e.target.value.replace(/[^0-9.]/g, ""))}
              style={{ flexGrow: 1, background: "none", border: "none", outline: "none",
                       color: "var(--fl-fg)", fontSize: 19, fontWeight: 600, minWidth: 0 }}
            />
            <span className="fl-pill fl-pill--off" style={{ flexShrink: 0 }}>{from.symbol}</span>
          </div>

          {/* flip */}
          <div style={{ display: "flex", justifyContent: "center", margin: "-2px 0 8px" }}>
            <button className="fl-btn fl-btn--ghost" onClick={flip} disabled={swapping}
                    aria-label="Swap direction"
                    style={{ padding: 9, borderRadius: 9 }}>
              <IconSwap size={15} />
            </button>
          </div>

          {/* receive */}
          <div className="fl-row--between" style={{ marginBottom: 9 }}>
            <span className="fl-lbl">You receive</span>
            <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 11.5 }}>
              Balance {trim(toBalance, to.decimals === 6 ? 2 : 4)}
            </span>
          </div>
          <div className="fl-inner" style={{ display: "flex", alignItems: "center", padding: "13px 16px", marginBottom: 18 }}>
            <span className="fl-mono" style={{ flexGrow: 1, color: quote ? "var(--fl-fg)" : "var(--fl-fg-3)",
                                               fontSize: 19, fontWeight: 600 }}>{received}</span>
            <span className="fl-pill fl-pill--off" style={{ flexShrink: 0 }}>{to.symbol}</span>
          </div>

          {quote?.rate && (
            <div className="fl-row--between" style={{ marginBottom: 18 }}>
              <span style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>Rate</span>
              <span className="fl-mono" style={{ color: "var(--fl-fg-2)", fontSize: 12 }}>
                1 {from.symbol} = {trim(quote.rate, 4)} {to.symbol}
              </span>
            </div>
          )}

          {overBalance && (
            <div style={{ color: "var(--fl-warn)", fontSize: 12, marginBottom: 12 }}>
              That is more {from.symbol} than you hold.
            </div>
          )}
          {error && (
            <div style={{ color: "var(--fl-warn)", fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>{error}</div>
          )}

          <button className="fl-btn fl-btn--primary fl-btn--block" disabled={!canSwap}
                  onClick={() => onSwap?.({ from: from.symbol, to: to.symbol, amount })}>
            {swapping ? "Swapping…" : `Swap ${from.symbol} for ${to.symbol}`}
          </button>

          <div style={{ color: "var(--fl-fg-3)", fontSize: 11.5, lineHeight: 1.55, marginTop: 12 }}>
            Routed through the official QIEDex pool. Approvals are handled for you where the
            token needs one.
          </div>
        </div>

        {Number(qusdcBalance || 0) === 0 && (
          <div className="fl-inner" style={{ padding: "14px 16px", marginTop: 12 }}>
            <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.6 }}>
              You hold no qUSDC yet, so you cannot start a subscription. Swap a little QIE here
              first{onFund ? " - or " : "."}
              {onFund && <button className="fl-link" style={{ fontSize: 12 }} onClick={onFund}>get QIE</button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
