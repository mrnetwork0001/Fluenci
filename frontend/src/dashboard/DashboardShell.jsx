import React, { useEffect, useState } from "react";
import "./dashboard.css";
import FluenciLogo from "../assets/fluenci-logo.png";
import {
  IconGrid, IconRepeat, IconStore, IconShield, IconPulse, IconSwap,
  IconChevronLeft, IconMenu,
} from "./icons";

export const SUBSCRIBER_NAV = [
  { key: "dashboard", label: "Dashboard", Icon: IconGrid },
  { key: "subscriptions", label: "Subscriptions", Icon: IconRepeat },
  { key: "merchants", label: "Merchants", Icon: IconStore },
  { key: "limits", label: "Spending Limits", Icon: IconShield },
  { key: "protect", label: "Protect", Icon: IconPulse },
  { key: "swap", label: "Swap", Icon: IconSwap },
];

export const MERCHANT_NAV = [
  { key: "dashboard", label: "Dashboard", Icon: IconGrid },
  { key: "subscribers", label: "Subscribers", Icon: IconRepeat },
  { key: "policy", label: "Access Policy", Icon: IconShield },
  { key: "protect", label: "Protect", Icon: IconPulse },
  { key: "swap", label: "Swap", Icon: IconSwap },
];

const shortAddr = (a) => (a ? `${a.slice(0, 6)}••••${a.slice(-4)}` : "-");

/**
 * App shell for the v2 dashboard: role toggle, nav, wallet card.
 * Purely presentational - all state is lifted to the caller.
 */
export default function DashboardShell({
  role = "subscriber",
  onRoleChange,
  active = "dashboard",
  onNavigate,
  collapsed = false,
  onToggleCollapse,
  account,
  qusdcBalance = "0.00",
  networkLabel = "QIE Mainnet",
  networkOk = true,
  domainName,
  onHome,
  onConnect,
  onDisconnect,
  qieName,
  children,
}) {
  const nav = role === "merchant" ? MERCHANT_NAV : SUBSCRIBER_NAV;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Escape closes the drawer, and the page behind it must not scroll while open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const go = (key) => { onNavigate?.(key); setDrawerOpen(false); };

  return (
    <div className={`fl${drawerOpen ? " fl--drawer-open" : ""}`}>
      {/* Mobile only: the rail collapses to a bar with a drawer behind it. */}
      <header className="fl-topbar">
        <button className="fl-home" onClick={onHome} aria-label="Back to the Fluenci home page">
          <img src={FluenciLogo} alt="" className="fl-logo" />
          <span className="fl-wordmark">Fluenci</span>
        </button>
        <button className="fl-burger" onClick={() => setDrawerOpen(true)}
                aria-label="Open menu" aria-expanded={drawerOpen}>
          <IconMenu size={20} />
        </button>
      </header>

      <div className="fl-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <aside className={`fl-sidebar${collapsed ? " fl-sidebar--collapsed" : ""}`}>
        <div className="fl-brand">
          <button className="fl-home" onClick={onHome} title="Back to fluenci.xyz" aria-label="Back to the Fluenci home page">
            <img src={FluenciLogo} alt="" className="fl-logo" />
            {!collapsed && (
              <span className="fl-brand-text">
                <span className="fl-wordmark">Fluenci</span>
                <span className="fl-tagline">Subscriptions for Web3</span>
              </span>
            )}
          </button>
          <button className="fl-link" onClick={onToggleCollapse} aria-label="Collapse sidebar"
                  style={{ display: "flex", padding: 0, color: "var(--fl-fg-3)" }}>
            <IconChevronLeft size={14} />
          </button>
        </div>

        {!collapsed && (
          <div className="fl-roles" role="tablist">
            <button role="tab" aria-selected={role === "subscriber"}
                    className={`fl-role${role === "subscriber" ? " is-on" : ""}`}
                    onClick={() => onRoleChange?.("subscriber")}>Subscriber</button>
            <button role="tab" aria-selected={role === "merchant"}
                    className={`fl-role${role === "merchant" ? " is-on" : ""}`}
                    onClick={() => onRoleChange?.("merchant")}>Merchant</button>
          </div>
        )}

        <nav className="fl-nav">
          {nav.map(({ key, label, Icon }) => (
            <button key={key} title={label}
                    className={`fl-navitem${active === key ? " is-on" : ""}`}
                    onClick={() => go(key)}>
              <Icon />
              {!collapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>

        <div style={{ flexGrow: 1 }} />

        {!collapsed && !account && (
          <div className="fl-inner" style={{ padding: 14 }}>
            <div style={{ color: "var(--fl-fg-3)", fontSize: 11.5, lineHeight: 1.55, marginBottom: 12 }}>
              Connect a wallet to start a subscription or claim what you have earned.
            </div>
            <button className="fl-btn fl-btn--primary fl-btn--block" onClick={onConnect}>Connect wallet</button>
          </div>
        )}

        {!collapsed && account && (
          <div className="fl-inner" style={{ padding: 14 }}>
            <div className="fl-row--between" style={{ marginBottom: 9 }}>
              <div className="fl-row" style={{ gap: 7 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%",
                               background: networkOk ? "var(--fl-accent)" : "var(--fl-warn)" }} />
                <span style={{ color: "var(--fl-fg-2)", fontSize: 11.5, fontWeight: 500 }}>{networkLabel}</span>
              </div>
              <button className="fl-link" style={{ fontSize: 11 }} onClick={onDisconnect}>Disconnect</button>
            </div>
            {qieName || domainName ? (
              <div className="fl-wallet-name" style={{ marginBottom: 4 }} title={account}>
                <span className="fl-wallet-name__qie">{qieName || domainName}</span>
                <span className="fl-pill fl-pill--on" style={{ flexShrink: 0 }}>QIE ID</span>
              </div>
            ) : null}
            <div className="fl-mono" style={{ color: qieName || domainName ? "var(--fl-fg-3)" : "var(--fl-fg)",
                                              fontSize: qieName || domainName ? 10.5 : 12, marginBottom: 12 }}>
              {shortAddr(account)}
            </div>
            <div className="fl-lbl" style={{ marginBottom: 5 }}>Balance</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 19, fontWeight: 600 }}>{qusdcBalance}</span>
              <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 11 }}>qUSDC</span>
            </div>
          </div>
        )}
      </aside>

      <main className="fl-main">{children}</main>
    </div>
  );
}

/** Stat card used across every screen. */
export function StatCard({ label, value, note, tone }) {
  const toneClass = tone === "accent" ? " fl-stat-value--accent" : tone === "warn" ? " fl-stat-value--warn" : "";
  return (
    <div className="fl-card">
      <div className="fl-lbl" style={{ marginBottom: 12 }}>{label}</div>
      <div className={`fl-stat-value${toneClass}`}>{value}</div>
      {note && <div className="fl-stat-note">{note}</div>}
    </div>
  );
}

/** Empty state with a single call to action. */
export function EmptyState({ icon, title, body, actionLabel, onAction }) {
  return (
    <div className="fl-card fl-empty">
      {icon}
      <div className="fl-empty__title">{title}</div>
      <div className="fl-empty__body">{body}</div>
      {actionLabel && <button className="fl-link" onClick={onAction}>{actionLabel} &rarr;</button>}
    </div>
  );
}

/** Used/remaining meter for spending caps. */
export function Meter({ used, total, thin }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const full = pct >= 100;
  return (
    <div className={`fl-meter${thin ? " fl-meter--thin" : ""}`}>
      <div className={`fl-meter__fill${full ? " fl-meter__fill--full" : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
