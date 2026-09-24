import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { DIRECTORY } from "./merchants";
import { MAINNET_RPC, QIE_PASS, QIE_PASS_ABI } from "./v4Config";
import { IconStore } from "./icons";
import { MerchantLogo } from "./merchantLogos";

/**
 * Merchant directory. The "Verified" badge is a live on-chain read of the QIE
 * Pass adapter the registry enforces - never a hardcoded flag - so it can only
 * show for a merchant that has genuinely passed QIE Pass.
 */
export default function Directory({ onOpen = null, onBecomeMerchant = null }) {
  const [verified, setVerified] = useState({});

  useEffect(() => {
    let live = true;
    const addrs = DIRECTORY.map((m) => m.merchant).filter((a) => a && ethers.isAddress(a));
    if (addrs.length === 0) return undefined;
    const pass = new ethers.Contract(QIE_PASS, QIE_PASS_ABI, new ethers.JsonRpcProvider(MAINNET_RPC));
    Promise.all(addrs.map(async (a) => [a.toLowerCase(), await pass.verifyIdentity(a).catch(() => false)]))
      .then((pairs) => { if (live) setVerified(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, []);

  return (
    <>
      <h1 className="fl-title">Merchants</h1>
      <p className="fl-sub">Services you can subscribe to with Fluenci. Priced in plain dollars, and you can cancel anytime.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {DIRECTORY.map((m) => {
          const live = m.status === "live";
          const isVerified = Boolean(m.merchant && verified[m.merchant.toLowerCase()]);
          return (
            <div key={m.id} className="fl-card" style={{ display: "flex", flexDirection: "column", gap: 12, opacity: live ? 1 : 0.72 }}>
              {/* The status pill sits on the category line so the name gets the full width. */}
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <MerchantLogo id={m.logo} size={44} fallback={m.name.charAt(0)} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "var(--fl-fg)", fontSize: 14.5, fontWeight: 600 }}>{m.name}</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
                    <span style={{ color: "var(--fl-fg-3)", fontSize: 11.5 }}>{m.category}</span>
                    <span className={`fl-pill ${live ? "fl-pill--on" : "fl-pill--off"}`}>{live ? "Live" : "Soon"}</span>
                  </div>
                </div>
              </div>

              <div style={{ color: "var(--fl-fg-2)", fontSize: 12.5, lineHeight: 1.6, flexGrow: 1 }}>{m.blurb}</div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {m.builtByFluenci && <span className="fl-pill fl-pill--off">Built by Fluenci</span>}
                {isVerified && <span className="fl-pill fl-pill--on">QIE Pass verified</span>}
              </div>

              <div className="fl-row--between">
                <span className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 14, fontWeight: 600 }}>{m.priceLabel}</span>
                {live ? (
                  <button className="fl-btn fl-btn--primary" style={{ padding: "8px 16px", fontSize: 12.5 }}
                          onClick={() => onOpen?.(m.opens || "subscriptions", m)}>Open</button>
                ) : (
                  <button className="fl-btn fl-btn--ghost" style={{ padding: "8px 16px", fontSize: 12.5 }} disabled>Coming soon</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="fl-inner" style={{ padding: "16px 18px", marginTop: 18, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <IconStore size={20} stroke="var(--fl-fg-3)" />
        <div style={{ flexGrow: 1, minWidth: 220 }}>
          <div style={{ color: "var(--fl-fg)", fontSize: 13, fontWeight: 600 }}>Run a paid community, tool or newsletter?</div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55 }}>
            Bill it on QIE with no integration. Register a .qie name to get a payment link (fluenci.xyz/pay/yourname);
            until then, share your wallet address. To withdraw earnings you'll need a verified QIE Pass.
          </div>
        </div>
        {onBecomeMerchant && (
          <button className="fl-btn fl-btn--ghost" style={{ padding: "8px 14px", fontSize: 12.5 }} onClick={onBecomeMerchant}>
            Accept payments &rarr;
          </button>
        )}
      </div>
    </>
  );
}
