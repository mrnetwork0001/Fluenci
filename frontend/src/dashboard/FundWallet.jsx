import { useState } from "react";
import { IconCopy, IconCheck } from "./icons";

function Route({ title, body, action }) {
  return (
    <div className="fl-inner" style={{ padding: "12px 14px" }}>
      <div style={{ color: "var(--fl-fg)", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55 }}>{body}</div>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

/**
 * "Fund your wallet" guide for people arriving with nothing on QIE.
 * Lists only routes that were verified to work: the ETH/BNB native bridge is
 * deliberately absent - it delivers WETH/WBNB, which have no liquidity on
 * QIEDex, so a user following it would be stranded.
 */
export default function FundWallet({ account = null, qieBalance = "0", onSwap = null, compact = false }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!account) return;
    try {
      navigator.clipboard?.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; the address is still shown */ }
  };

  const hasQie = Number(qieBalance || 0) > 0;

  return (
    <div className={compact ? "" : "fl-card"}>
      {!compact && <div className="fl-lbl" style={{ marginBottom: 10 }}>Fund your wallet</div>}
      <div style={{ display: "grid", gap: 8 }}>
        {hasQie && onSwap && (
          <Route
            title="You already hold QIE"
            body="Swap a little QIE for qUSDC and you're ready to subscribe."
            action={<button className="fl-link" style={{ fontSize: 12 }} onClick={onSwap}>Open Swap &rarr;</button>}
          />
        )}
        <Route
          title="Bring USDC or USDT from Ethereum"
          body="Use QIE's official stable bridge. Funds arrive in about a minute as bridged USDC/USDT, which the Arcade Pass accepts directly; other subscriptions settle in qUSDC. The bridge doesn't give you QIE, so also get a little QIE from an exchange for network fees."
          action={
            <a className="fl-link" style={{ fontSize: 12 }} href="https://www.bridge.qie.digital/stable-bridge"
               target="_blank" rel="noopener noreferrer">Open the QIE Stable Bridge &rarr;</a>
          }
        />
        <Route
          title="Buy QIE on an exchange"
          body="QIE trades on XT.com and MEXC. Withdraw to your wallet on the QIE Mainnet network. XT's minimum withdrawal is about 55 QIE."
        />
        {account && (
          <div className="fl-inner" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <span className="fl-lbl" style={{ flexShrink: 0 }}>Your address</span>
            <span className="fl-mono" style={{ color: "var(--fl-fg-2)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexGrow: 1 }}>
              {account}
            </span>
            <button className="fl-link" onClick={copy} aria-label="Copy address" style={{ display: "flex", padding: 0 }}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
