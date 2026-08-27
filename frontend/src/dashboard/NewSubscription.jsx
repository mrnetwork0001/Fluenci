import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import "./dashboard.css";
import { EmptyState, Meter } from "./DashboardShell";
import { IconChevronLeft, IconChevronDown, IconCheck, IconStore, IconShield } from "./icons";

/* Billing periods. The consumer only ever sees these labels; periodSeconds is
   internal and goes straight to createSubscription(). One month is 30 days,
   matching the 2_592_000 example in FluenciRegistryV4. */
const PERIODS = [
  { key: "minute", label: "per minute", noun: "minute", seconds: 60 },
  { key: "day", label: "per day", noun: "day", seconds: 86400 },
  { key: "week", label: "per week", noun: "week", seconds: 604800 },
  { key: "month", label: "per month", noun: "month", seconds: 2592000 },
];
const QUICK_PICKS = ["day", "week", "month", "minute"];
const periodOf = (key) => PERIODS.find((p) => p.key === key) || PERIODS[3];

const ZERO = "0x0000000000000000000000000000000000000000";

const shortAddr = (a) => (a ? `${a.slice(0, 6)}••••${a.slice(-4)}` : "-");

/** Keep the amount field to digits, one dot and at most 6 decimals (qUSDC). */
function cleanAmount(raw) {
  const only = String(raw).replace(/[^0-9.]/g, "");
  const [head, ...rest] = only.split(".");
  const body = rest.length ? `${head}.${rest.join("")}` : head;
  const [i, d] = body.split(".");
  return d === undefined ? i : `${i}.${d.slice(0, 6)}`;
}

/** Decimal string -> 6-decimal token units, or null when it is not a usable amount. */
function toUnits(value) {
  const v = cleanAmount(value ?? "");
  if (!v || v === "." || Number(v) <= 0) return null;
  try {
    return ethers.parseUnits(v, 6);
  } catch {
    return null;
  }
}

const feeLabel = (bps) => `${String(Number(bps) / 100).replace(/\.0+$/, "")}% protocol fee`;

/** Accepts "Mar 2026", a Date, or a unix timestamp in seconds or ms. */
function sinceLabel(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && !/^\d+$/.test(value)) return value;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n < 1e12 ? n * 1000 : n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

const ROW = { padding: "13px 16px", background: "var(--fl-card)" };
const ROW_KEY = { color: "var(--fl-fg-2)", fontSize: 12.5 };
const ROW_VAL = { color: "var(--fl-fg)", fontSize: 12.5 };
const UNAVAILABLE = { color: "var(--fl-fg-3)", fontSize: 12.5 };

function IdentityRow({ label, children }) {
  return (
    <div className="fl-row--between" style={ROW}>
      <span style={ROW_KEY}>{label}</span>
      {children}
    </div>
  );
}

/**
 * Create-subscription screen. Presentational: every piece of chain data and
 * every action arrives as a prop, so it renders with no wallet connected.
 *
 * Reputation and wallet flags come from the off-chain QIE Reputation service.
 * There is no contract for them, so when the props are absent the card says so
 * rather than showing a number.
 */
export default function NewSubscription({
  loading = false,
  submitting = false,
  error = null,
  merchant = null,
  reputation = null,
  reputationMax = 1000,
  walletFlags = null,
  resolveMerchant = null,
  tokenAddress = ZERO,
  tokenSymbol = "qUSDC",
  protocolFeeBps = 50,
  defaultPeriod = "month",
  onMerchantChange = null,
  onSubmit = null,
  initialMerchant = "",
  onBack = null,
  onBrowseMerchants = null,
}) {
  const [query, setQuery] = useState(initialMerchant || "");
  const [status, setStatus] = useState("idle"); // idle | resolving | resolved | error
  const [address, setAddress] = useState(null);

  const [amount, setAmount] = useState("");
  const [periodKey, setPeriodKey] = useState(defaultPeriod);

  const [capOn, setCapOn] = useState(true);
  const [capAmount, setCapAmount] = useState("");
  const [capEdited, setCapEdited] = useState(false);

  const period = periodOf(periodKey);
  const capValue = capEdited ? capAmount : amount;

  // Resolution is a callback, never a fetch of our own.
  const resolverRef = useRef(resolveMerchant);
  useEffect(() => { resolverRef.current = resolveMerchant; }, [resolveMerchant]);

  const notifyRef = useRef(onMerchantChange);
  useEffect(() => { notifyRef.current = onMerchantChange; }, [onMerchantChange]);

  useEffect(() => {
    const trimmed = query.trim();
    const settle = (next, addr) => {
      setStatus(next);
      setAddress(addr);
      notifyRef.current?.(addr, trimmed);
    };

    if (!trimmed) { settle("idle", null); return undefined; }
    if (ethers.isAddress(trimmed) && trimmed !== ZERO) { settle("resolved", ethers.getAddress(trimmed)); return undefined; }

    if (trimmed.toLowerCase().endsWith(".qie")) {
      const resolver = resolverRef.current;
      if (!resolver) { settle("error", null); return undefined; }
      setStatus("resolving");
      setAddress(null);
      let live = true;
      const t = setTimeout(async () => {
        try {
          const found = await resolver(trimmed);
          if (!live) return;
          if (found && ethers.isAddress(found) && found !== ZERO) settle("resolved", ethers.getAddress(found));
          else settle("error", null);
        } catch {
          if (live) settle("error", null);
        }
      }, 500);
      return () => { live = false; clearTimeout(t); };
    }

    settle(trimmed.length > 4 ? "error" : "idle", null);
    return undefined;
  }, [query]);

  const amountUnits = useMemo(() => toUnits(amount), [amount]);
  const capUnits = useMemo(() => toUnits(capValue), [capValue]);

  const identityReady = status === "resolved" && !loading;
  const capReady = !capOn || capUnits !== null;
  const canConfirm = identityReady && amountUnits !== null && capReady && !submitting;

  const name = merchant?.name || (status === "resolved" && query.trim().toLowerCase().endsWith(".qie") ? query.trim() : null);
  const displayName = name || shortAddr(address);
  const initial = (name || "?").replace(/[^a-zA-Z0-9]/g, "").charAt(0).toUpperCase() || "?";

  const repScore = typeof reputation === "number" ? reputation : reputation?.score;
  const repMax = reputation?.max ?? reputationMax;
  const hasRep = typeof repScore === "number" && Number.isFinite(repScore);
  const hasFlags = Array.isArray(walletFlags);
  const since = sinceLabel(merchant?.streamingSince);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!canConfirm) return;
    onSubmit?.({
      merchant: address,
      tokenAddress,
      amountPerPeriod: amountUnits.toString(),
      periodSeconds: period.seconds,
      cliffTime: 0,
      stopTime: 0,
      spendCap: capOn ? { maxAmount: capUnits.toString(), periodSeconds: period.seconds } : null,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <button type="button" className="fl-link" onClick={onBack}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: 0, marginBottom: 5, color: "var(--fl-fg-3)", fontWeight: 400 }}>
        <IconChevronLeft size={15} stroke="var(--fl-fg-3)" width={1.7} />
        <span style={{ fontSize: 13 }}>Subscriptions</span>
      </button>
      <h1 className="fl-title" style={{ marginBottom: 26 }}>New subscription</h1>

      <div className="fl-split">
        {/* ---- form ---- */}
        <div className="fl-card">
          <div className="fl-lbl" style={{ marginBottom: 9 }}>Pay to</div>
          <div className={`fl-inner${status === "resolved" ? " fl-inner--accent" : ""}`}
               style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px",
                        borderColor: status === "error" ? "var(--fl-warn)" : undefined }}>
            <input
              className="fl-mono"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={loading || submitting}
              placeholder="notion.qie"
              aria-label="Merchant name or wallet address"
              autoComplete="off"
              spellCheck={false}
              style={{ flexGrow: 1, minWidth: 0, background: "none", border: "none", outline: "none",
                       color: "var(--fl-fg)", fontSize: 14, padding: 0 }}
            />
            {status === "resolving" && <span className="fl-pill fl-pill--off">Checking</span>}
            {status === "resolved" && <span className="fl-pill fl-pill--on">Resolved</span>}
            {status === "error" && <span className="fl-pill fl-pill--warn">Not found</span>}
          </div>
          <div style={{ color: status === "error" ? "var(--fl-warn)" : "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, margin: "8px 0 24px 0" }}>
            {status === "error"
              ? "No wallet is registered to that name. Check the spelling, or paste the merchant address."
              : "A .qie name or a wallet address."}
          </div>

          <div className="fl-lbl" style={{ marginBottom: 9 }}>Amount</div>
          <div className="fl-amount-row" style={{ marginBottom: 9 }}>
            <div className="fl-inner fl-amount-field" style={{ display: "flex", alignItems: "center", padding: "13px 16px" }}>
              <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 19, marginRight: 3 }}>$</span>
              <input
                className="fl-mono"
                value={amount}
                onChange={(e) => setAmount(cleanAmount(e.target.value))}
                disabled={loading || submitting}
                placeholder="0.00"
                inputMode="decimal"
                aria-label={`Amount in ${tokenSymbol}`}
                style={{ flexGrow: 1, minWidth: 0, background: "none", border: "none", outline: "none",
                         color: "var(--fl-fg)", fontSize: 19, fontWeight: 600, padding: 0 }}
              />
            </div>
            <div className="fl-inner fl-period-field" style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 16px", position: "relative" }}>
              <select
                value={periodKey}
                onChange={(e) => setPeriodKey(e.target.value)}
                disabled={loading || submitting}
                aria-label="Billing period"
                style={{ appearance: "none", WebkitAppearance: "none", background: "none", border: "none", outline: "none",
                         color: "var(--fl-fg)", fontFamily: "inherit", fontSize: 13.5, padding: 0, paddingRight: 4, cursor: "pointer" }}
              >
                {PERIODS.map((p) => (
                  <option key={p.key} value={p.key} style={{ background: "var(--fl-raised)" }}>{p.label}</option>
                ))}
              </select>
              <IconChevronDown size={13} stroke="var(--fl-fg-3)" width={1.7} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 24 }}>
            {QUICK_PICKS.map((key) => {
              const p = periodOf(key);
              const on = periodKey === key;
              return (
                <button key={key} type="button" onClick={() => setPeriodKey(key)} disabled={loading || submitting}
                        className={`fl-pill ${on ? "fl-pill--on" : "fl-pill--off"}`}
                        aria-pressed={on}
                        style={{ border: "none", cursor: loading || submitting ? "not-allowed" : "pointer" }}>
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="fl-lbl" style={{ marginBottom: 9 }}>Spending limit</div>
          <div className="fl-inner fl-toggle-row" style={{ padding: "13px 16px", marginBottom: 8 }}>
            <div className="fl-toggle-row__main" style={{ opacity: capOn ? 1 : 0.45 }}>
              <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 14 }}>$</span>
              <input
                className="fl-mono"
                value={capValue}
                onChange={(e) => { setCapEdited(true); setCapAmount(cleanAmount(e.target.value)); }}
                disabled={!capOn || loading || submitting}
                placeholder={amount || "0.00"}
                inputMode="decimal"
                aria-label="Spending limit amount"
                style={{ width: `${Math.max(4, String(capValue || "0.00").length + 1)}ch`, background: "none", border: "none",
                         outline: "none", color: "var(--fl-fg)", fontSize: 14, padding: 0 }}
              />
              <span className="fl-toggle-row__unit" style={{ color: "var(--fl-fg-2)", fontSize: 13.5, marginLeft: 5 }}>{period.label}</span>
            </div>
            <button type="button" role="switch" aria-checked={capOn} aria-label="Spending limit"
                    onClick={() => setCapOn((v) => !v)} disabled={loading || submitting}
                    style={{ flexShrink: 0, width: 34, height: 19, borderRadius: 20, padding: "0 2.5px", border: "none",
                             cursor: loading || submitting ? "not-allowed" : "pointer",
                             background: capOn ? "var(--fl-accent)" : "var(--fl-raised)",
                             display: "flex", alignItems: "center", justifyContent: capOn ? "flex-end" : "flex-start" }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: capOn ? "#ffffff" : "var(--fl-fg-3)" }} />
            </button>
          </div>
          <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, marginBottom: 26 }}>
            {capOn
              ? `${name || "This merchant"} can never draw more than this in one ${period.noun}, whatever the subscription says. Only you can raise it.`
              : `Without a limit, ${name || "this merchant"} can draw whatever the subscription rate adds up to. You can set a limit later.`}
          </div>

          {error && (
            <div style={{ color: "var(--fl-warn)", fontSize: 12.5, lineHeight: 1.55, marginBottom: 14 }}>{error}</div>
          )}

          <button type="submit" className="fl-btn fl-btn--primary fl-btn--block" disabled={!canConfirm}
                  style={{ padding: "13px 0", fontSize: 13.5 }}>
            {submitting ? "Confirm in your wallet…" : "Approve and start streaming"}
          </button>
          <div className="fl-row--between" style={{ marginTop: 14 }}>
            <span style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>Settles per second &middot; cancel anytime</span>
            <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>{feeLabel(protocolFeeBps)}</span>
          </div>
        </div>

        {/* ---- merchant identity ---- */}
        {loading ? (
          <div className="fl-card">
            <div className="fl-lbl" style={{ marginBottom: 16 }}>Who you are paying</div>
            <div className="fl-row" style={{ gap: 13, marginBottom: 22 }}>
              <div className="fl-avatar fl-avatar--lg" />
              <div style={{ flexGrow: 1 }}>
                <div style={{ height: 12, width: "45%", borderRadius: 4, background: "var(--fl-raised)", marginBottom: 8 }} />
                <div style={{ height: 9, width: "30%", borderRadius: 4, background: "var(--fl-raised)" }} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "var(--fl-border)", borderRadius: 10, overflow: "hidden" }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="fl-row--between" style={ROW}>
                  <div style={{ height: 9, width: 80, borderRadius: 4, background: "var(--fl-raised)" }} />
                  <div style={{ height: 9, width: 54, borderRadius: 4, background: "var(--fl-raised)" }} />
                </div>
              ))}
            </div>
            <div className="fl-stat-note" style={{ marginTop: 16 }}>Loading merchant details.</div>
          </div>
        ) : !identityReady ? (
          <EmptyState
            icon={<IconStore size={26} stroke="var(--fl-fg-3)" />}
            title={status === "resolving" ? "Checking that name" : "No merchant yet"}
            body={
              status === "resolving"
                ? "Looking up who this name points to. The details appear here before you can approve anything."
                : "Enter a .qie name or a wallet address. You will see who you are paying, and their record, before you approve anything."
            }
            actionLabel={status === "resolving" ? undefined : "Browse merchants"}
            onAction={onBrowseMerchants}
          />
        ) : (
          <div className="fl-card">
            <div className="fl-lbl" style={{ marginBottom: 16 }}>Who you are paying</div>

            <div className="fl-row" style={{ gap: 13, marginBottom: 22 }}>
              <div className="fl-avatar fl-avatar--lg">{initial}</div>
              <div style={{ minWidth: 0 }}>
                <div className="fl-h" style={{ color: "var(--fl-fg)", fontSize: 16, fontWeight: 600 }}>{displayName}</div>
                <div className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 11.5, marginTop: 2 }}>{shortAddr(address)}</div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "var(--fl-border)", borderRadius: 10, overflow: "hidden", marginBottom: 20 }}>
              <IdentityRow label="QIE ID">
                {merchant?.qieId || name
                  ? <span className="fl-mono" style={ROW_VAL}>{merchant?.qieId || name}</span>
                  : <span style={UNAVAILABLE}>Not available</span>}
              </IdentityRow>

              <IdentityRow label="QIE Pass">
                {merchant?.qiePassVerified === true ? (
                  <span className="fl-row" style={{ gap: 6 }}>
                    <IconCheck size={13} stroke="var(--fl-accent)" />
                    <span style={{ color: "var(--fl-accent)", fontSize: 12.5, fontWeight: 500 }}>Verified</span>
                  </span>
                ) : merchant?.qiePassVerified === false ? (
                  <span style={{ color: "var(--fl-fg-2)", fontSize: 12.5 }}>Not verified</span>
                ) : (
                  <span style={UNAVAILABLE}>Not available</span>
                )}
              </IdentityRow>

              <IdentityRow label="Reputation">
                {hasRep ? (
                  <span className="fl-row" style={{ gap: 10 }}>
                    <span style={{ width: 62 }}><Meter used={repScore} total={repMax} thin /></span>
                    <span className="fl-mono" style={ROW_VAL}>{repScore}</span>
                  </span>
                ) : (
                  <span style={UNAVAILABLE}>Not available</span>
                )}
              </IdentityRow>

              <IdentityRow label="Wallet flags">
                {!hasFlags ? (
                  <span style={UNAVAILABLE}>Not available</span>
                ) : walletFlags.length === 0 ? (
                  <span style={{ color: "var(--fl-accent)", fontSize: 12.5, fontWeight: 500 }}>None</span>
                ) : (
                  <span style={{ color: "var(--fl-warn)", fontSize: 12.5, fontWeight: 500 }}>{walletFlags.join(", ")}</span>
                )}
              </IdentityRow>

              <IdentityRow label="Streaming since">
                {since
                  ? <span className="fl-mono" style={ROW_VAL}>{since}</span>
                  : <span style={UNAVAILABLE}>Not available</span>}
              </IdentityRow>
            </div>

            {(!hasRep || !hasFlags) && (
              <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
                Reputation and wallet flags come from QIE Reputation, which has not returned a result for this merchant. Nothing is being scored in their favour.
              </div>
            )}

            <div className="fl-inner" style={{ display: "flex", gap: 11, padding: "14px 16px" }}>
              <span style={{ flexShrink: 0, marginTop: 1, display: "flex" }}>
                <IconShield size={15} stroke="var(--fl-accent)" width={1.6} />
              </span>
              <div style={{ color: "var(--fl-fg-2)", fontSize: 12, lineHeight: 1.6 }}>
                Fluenci Protect watches this stream and pauses it automatically if the billing rate changes unexpectedly.
              </div>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
