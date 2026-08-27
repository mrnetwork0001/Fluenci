import React, { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import QieLogo from "../assets/qiewallet.png";
import FluenciLogo from "../assets/fluenci-logo.png";
import { IconCheck, IconChevronLeft, IconChevronDown } from "./icons";

const isQie = (p) =>
  p?.info?.name?.toLowerCase().includes("qie") || p?.info?.rdns?.toLowerCase().includes("qie");

/**
 * Wallet picker for the v2 shell. Same three paths and the same priority order
 * as v1 - QIE Wallet extension first, QIE Mobile over WalletConnect second,
 * any other EIP-6963 wallet third - rebuilt on the dark design system.
 */
export default function ConnectWalletV2({
  isOpen,
  onClose,
  announcedProviders = [],
  connectWallet,
  connectWalletConnect,
  loading = false,
}) {
  const [view, setView] = useState("primary");
  const [wcUri, setWcUri] = useState("");
  const [wcError, setWcError] = useState("");
  const [wcConnecting, setWcConnecting] = useState(false);

  const qieProvider = useMemo(() => announcedProviders.find(isQie), [announcedProviders]);
  const otherProviders = useMemo(() => announcedProviders.filter((p) => !isQie(p)), [announcedProviders]);

  // The extension may be injected without announcing itself over EIP-6963.
  const qieDetected = Boolean(qieProvider) || Boolean(
    typeof window !== "undefined" && window.ethereum && (
      window.ethereum.isQieWallet ||
      window.ethereum.isQIE ||
      (window.ethereum.providers || []).some((p) => p.isQieWallet || p.isQIE)
    )
  );

  if (!isOpen) return null;

  const close = () => { setView("primary"); setWcUri(""); setWcError(""); onClose?.(); };

  const connectExtension = async () => {
    if (qieProvider) { await connectWallet?.(qieProvider); close(); return; }
    if (qieDetected) { await connectWallet?.(null); close(); return; }
    setView("no_extension");
  };

  const startMobile = () => {
    setWcUri(""); setWcError(""); setWcConnecting(true); setView("mobile");
    connectWalletConnect?.((uri) => {
      if (uri) { setWcUri(uri); setWcConnecting(false); setWcError(""); }
      else {
        setWcConnecting(false);
        setWcError("Your network is blocking the WalletConnect relay. Turn on a VPN, or switch Wi-Fi or mobile data, then retry.");
      }
    });
  };

  const Option = ({ logo, title, subtitle, badge, onClick, disabled, primary }) => (
    <button className={`fl-wallet-option${primary ? " fl-wallet-option--primary" : ""}`}
            onClick={onClick} disabled={disabled}>
      {logo}
      <span className="fl-wallet-option__text">
        <span className="fl-wallet-option__title">{title}</span>
        <span className="fl-wallet-option__sub">{subtitle}</span>
      </span>
      {badge}
    </button>
  );

  return (
    <div className="fl-modal-backdrop" onClick={close} role="presentation">
      <div className="fl-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
           aria-label="Connect a wallet">
        <button className="fl-modal__close" onClick={close} aria-label="Close">&times;</button>

        {view === "primary" && (
          <div className="fl-modal__brand">
            <img src={FluenciLogo} alt="" className="fl-modal__mark" />
          </div>
        )}

        {view !== "primary" && (
          <button className="fl-link" onClick={() => setView("primary")}
                  style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 12.5 }}>
            <IconChevronLeft size={13} /> Back
          </button>
        )}

        {view === "primary" && (
          <>
            <h2 className="fl-h fl-modal__title">Connect Wallet</h2>
            <p className="fl-modal__sub">Choose how you would like to connect</p>

            <div className="fl-stack" style={{ gap: 9 }}>
              <Option
                logo={<img src={QieLogo} alt="" className="fl-wallet-logo" />}
                title="QIE Wallet"
                subtitle={qieDetected ? "Browser extension, detected" : "Browser extension, not detected"}
                badge={
                  qieDetected
                    ? <span className="fl-pill fl-pill--on" style={{ flexShrink: 0 }}>Recommended</span>
                    : <span className="fl-pill fl-pill--off" style={{ flexShrink: 0 }}>Install</span>
                }
                onClick={connectExtension}
                disabled={loading}
                primary={qieDetected}
              />

              <Option
                logo={<img src={QieLogo} alt="" className="fl-wallet-logo" />}
                title="QIE Mobile"
                subtitle="Scan a QR code with the mobile app"
                badge={<span className="fl-pill fl-pill--off" style={{ flexShrink: 0 }}>Mobile</span>}
                onClick={startMobile}
                disabled={loading}
              />

              <Option
                logo={<span className="fl-wallet-logo fl-wallet-logo--glyph">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 3.5a1.5 1.5 0 113 0V5h2.5A1.5 1.5 0 0115 6.5V9h1.5a1.5 1.5 0 110 3H15v2.5a1.5 1.5 0 01-1.5 1.5H11v-1.5a1.5 1.5 0 10-3 0V17H5.5A1.5 1.5 0 014 15.5V13h1.5a1.5 1.5 0 100-3H4V6.5A1.5 1.5 0 015.5 5H8V3.5z"/>
                  </svg>
                </span>}
                title="Other Wallets"
                subtitle={otherProviders.length > 0
                  ? otherProviders.slice(0, 3).map((p) => p.info.name).join(", ") + (otherProviders.length > 3 ? " & more" : "")
                  : "MetaMask, Rabby, OKX & more"}
                badge={<span style={{ color: "var(--fl-fg-3)", display: "flex", flexShrink: 0 }}>
                  <IconChevronDown size={14} style={{ transform: "rotate(-90deg)" }} />
                </span>}
                onClick={() => setView("others")}
                disabled={loading}
              />
            </div>
          </>
        )}

        {view === "others" && (
          <>
            <h2 className="fl-h fl-modal__title">Other wallets</h2>
            <p className="fl-modal__sub">Any EVM wallet, connected to QIE Mainnet</p>
            <div className="fl-stack" style={{ gap: 9 }}>
              {otherProviders.length > 0 ? (
                otherProviders.map((p) => (
                  <Option
                    key={p.info.rdns}
                    logo={<img src={p.info.icon} alt="" className="fl-wallet-logo" />}
                    title={p.info.name}
                    subtitle="Detected in this browser"
                    onClick={async () => { await connectWallet?.(p); close(); }}
                    disabled={loading}
                  />
                ))
              ) : (
                <div className="fl-inner" style={{ padding: "13px 16px" }}>
                  <span style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55 }}>
                    No other wallets detected. Install one and it appears here automatically.
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {view === "mobile" && (
          <>
            <h2 className="fl-h" style={{ fontSize: 19, fontWeight: 700, margin: "0 0 5px" }}>Scan with QIE Mobile</h2>
            <p style={{ color: "var(--fl-fg-3)", fontSize: 12.5, margin: "0 0 20px", lineHeight: 1.55 }}>
              Open the QIE Wallet app, choose WalletConnect, and scan this code.
            </p>

            {wcError ? (
              <>
                <div className="fl-inner" style={{ padding: "14px 16px", borderColor: "var(--fl-warn)", marginBottom: 14 }}>
                  <span style={{ color: "var(--fl-warn)", fontSize: 12.5, lineHeight: 1.6 }}>{wcError}</span>
                </div>
                <button className="fl-btn fl-btn--primary fl-btn--block" onClick={startMobile}>Retry</button>
              </>
            ) : wcUri ? (
              <div className="fl-qr">
                <QRCodeSVG value={wcUri} size={208} bgColor="#ffffff" fgColor="#000000" level="M" includeMargin />
              </div>
            ) : (
              <div className="fl-qr fl-qr--pending">
                <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>
                  {wcConnecting ? "Opening relay…" : "Preparing…"}
                </span>
              </div>
            )}
          </>
        )}

        {view === "no_extension" && (
          <>
            <h2 className="fl-h" style={{ fontSize: 19, fontWeight: 700, margin: "0 0 5px" }}>QIE Wallet not found</h2>
            <p style={{ color: "var(--fl-fg-3)", fontSize: 12.5, margin: "0 0 20px", lineHeight: 1.55 }}>
              The browser extension is not installed, or this page loaded before it did. Install it,
              then reload - or scan with QIE Mobile instead.
            </p>
            <a className="fl-btn fl-btn--primary fl-btn--block" href="https://qiewallet.me"
               target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              Get QIE Wallet
            </a>
            <button className="fl-btn fl-btn--ghost fl-btn--block" onClick={startMobile} style={{ marginTop: 9 }}>
              Use QIE Mobile instead
            </button>
          </>
        )}

        <div className="fl-modal__foot">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginBottom: 10 }}>
            <IconCheck size={13} stroke="var(--fl-accent)" />
            <span style={{ color: "var(--fl-fg-3)", fontSize: 11.5 }}>
              Fluenci never takes custody of your tokens.
            </span>
          </div>
          {!qieDetected && (
            <div style={{ textAlign: "center", color: "var(--fl-fg-3)", fontSize: 12 }}>
              Don&rsquo;t have QIE Wallet?{" "}
              <a href="https://qiewallet.me" target="_blank" rel="noopener noreferrer" className="fl-link"
                 style={{ fontSize: 12 }}>Download Extension</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
