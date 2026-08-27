import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { StatCard, EmptyState, Meter } from "./DashboardShell";
import { IconPlus, IconDots, IconCheck, IconPulse, IconShield, IconRepeat } from "./icons";

/* qUSDC is a 6-decimal token. Everything that crosses this component's props is
   raw base units; nothing below the helpers here ever shows a raw unit to the
   consumer. Periods arrive as seconds and leave as "month" / "minute". */
const DECIMALS = 6;
const MONTH_SECONDS = 2592000; // 30 days, the period createSubscription is fed

const COLS = "2.2fr 1.1fr 1.3fr 1fr 0.5fr";
const ACTIVITY_COLS = "2.2fr 1.1fr 1.2fr 1.4fr";

/** Coerce a prop that may be a BigInt, a decimal-free string or a number into BigInt units. */
function toUnits(v) {
  if (v === null || v === undefined || v === "") return 0n;
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    return BigInt(String(v).trim());
  } catch {
    return 0n;
  }
}

function toNumber(units) {
  return Number(ethers.formatUnits(toUnits(units), DECIMALS));
}

/** "$12.00" - used wherever a figure sits next to another figure. */
function money(units) {
  return `$${toNumber(units).toFixed(2)}`;
}

/** "$20", "$7.50", "$0.03" - prices drop whole-dollar cents but never show one decimal. */
function priceAmount(units) {
  const [whole, frac = ""] = ethers.formatUnits(toUnits(units), DECIMALS).split(".");
  const kept = frac.replace(/0+$/, "");
  if (!kept) return `$${whole}`;
  return `$${whole}.${kept.length < 2 ? kept.padEnd(2, "0") : kept}`;
}

const NAMED_PERIODS = new Map([
  [31536000, "year"],
  [2629746, "month"],
  [2592000, "month"],
  [604800, "week"],
  [86400, "day"],
  [3600, "hour"],
  [60, "minute"],
  [1, "second"],
]);

/** periodSeconds as a positive whole number of seconds, or 0 when unusable. */
function periodSecs(v) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** periodSeconds -> the words a subscriber actually uses. */
function periodLabel(periodSeconds) {
  const s = periodSecs(periodSeconds);
  if (!s) return null;
  const named = NAMED_PERIODS.get(s);
  if (named) return { joiner: "/", label: named };
  if (s % 86400 === 0) return { joiner: " every ", label: `${s / 86400} days` };
  if (s % 3600 === 0) return { joiner: " every ", label: `${s / 3600} hours` };
  if (s % 60 === 0) return { joiner: " every ", label: `${s / 60} minutes` };
  return { joiner: " every ", label: `${s} seconds` };
}

/** "$20/month", "$0.03/minute". */
function formatPrice(amountPerPeriod, periodSeconds) {
  const period = periodLabel(periodSeconds);
  if (!period) return "-";
  return `${priceAmount(amountPerPeriod)}${period.joiner}${period.label}`;
}

/** What a subscription costs over a 30-day month, in raw units. */
function monthlyUnits(sub) {
  const period = periodSecs(sub?.periodSeconds);
  if (!period) return 0n;
  return (toUnits(sub?.amountPerPeriod) * BigInt(MONTH_SECONDS)) / BigInt(period);
}

/** Derive the row pill from the onchain flags, unless the caller states one. */
function statusOf(sub) {
  if (sub.status) return sub.status;
  // Cancelled: terminateStream stamped a stopTime in the past, so accrual is
  // frozen. The row can linger as active===true until the merchant claims the
  // final owed amount - label it Cancelled, not Active, so the user sees the
  // cancel took effect.
  const now = Math.floor(Date.now() / 1000);
  if (Number(sub.stopTime || 0) > 0 && Number(sub.stopTime) <= now) return "ended";
  if (Number(sub.dispute || 0) === 1) return "disputed";
  if (sub.pausedByAI || sub.active === false) return "paused";
  const cap = sub.cap;
  if (cap && toUnits(cap.maxAmount) > 0n && capUsed(cap) >= toUnits(cap.maxAmount)) return "capped";
  return "active";
}

/** Spent this window: given directly, or backed out of remainingAllowance(). */
function capUsed(cap) {
  if (!cap) return 0n;
  if (cap.used !== undefined && cap.used !== null) return toUnits(cap.used);
  if (cap.spentInWindow !== undefined && cap.spentInWindow !== null) return toUnits(cap.spentInWindow);
  if (cap.remaining !== undefined && cap.remaining !== null) {
    const max = toUnits(cap.maxAmount);
    const rem = toUnits(cap.remaining);
    return rem >= max ? 0n : max - rem;
  }
  return 0n;
}

const STATUS_PILL = {
  active: { cls: "fl-pill--on", label: "Active" },
  capped: { cls: "fl-pill--warn", label: "Capped" },
  paused: { cls: "fl-pill--off", label: "Paused" },
  disputed: { cls: "fl-pill--warn", label: "Disputed" },
  ended: { cls: "fl-pill--off", label: "Cancelled" },
};

const GATE_QIE_ID = 1;
const GATE_QIE_PASS = 2;
const GATE_MIN_REPUTATION = 3;

/**
 * Merchant verification line. Reputation has no onchain contract - it is
 * passed in from the off-chain service, so when it is missing we say so rather
 * than inventing a score.
 */
function verificationOf(sub) {
  const gate = sub.gate === null || sub.gate === undefined ? null : Number(sub.gate);
  if (gate === GATE_QIE_PASS) return { text: "QIE Pass verified", verified: true };
  if (gate === GATE_QIE_ID) return { text: "QIE ID verified", verified: true };
  if (gate === GATE_MIN_REPUTATION) {
    if (sub.reputation === null || sub.reputation === undefined) {
      return { text: "Reputation unavailable", verified: false };
    }
    return { text: `Reputation ${sub.reputation}`, verified: true };
  }
  return { text: "Unverified merchant", verified: false };
}

function shortHash(h) {
  return h ? `${h.slice(0, 8)}••${h.slice(-6)}` : "-";
}

function whenLabel(ts) {
  if (!ts) return "-";
  const ms = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Dim bar standing in for a value that has not loaded yet. */
function Skeleton({ w = "100%", h = 12 }) {
  return <div style={{ width: w, height: h, borderRadius: 4, background: "var(--fl-raised)" }} />;
}

function RowMenu({ sub, open, onToggle, onSetLimit, onClearLimit, onCancel }) {
  const hasCap = Boolean(sub.cap && toUnits(sub.cap.maxAmount) > 0n);
  const cancelled = Number(sub.stopTime || 0) > 0 && Number(sub.stopTime) <= Math.floor(Date.now() / 1000);
  const items = [
    { key: "limit", label: hasCap ? "Change spending limit" : "Set spending limit", run: () => onSetLimit?.(sub) },
    hasCap ? { key: "clear", label: "Remove spending limit", run: () => onClearLimit?.(sub) } : null,
    cancelled ? null : { key: "cancel", label: "Cancel subscription", run: () => onCancel?.(sub) },
  ].filter(Boolean);

  return (
    <div style={{ position: "relative", display: "flex", justifyContent: "flex-end" }}>
      <button
        className="fl-link"
        aria-label={`Actions for ${sub.merchantName || "this subscription"}`}
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggle(!open); }}
        style={{ display: "flex", padding: 0, color: "var(--fl-fg-3)" }}
      >
        <IconDots size={16} />
      </button>

      {open && (
        <div
          className="fl-inner"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", top: 24, right: 0, zIndex: 20, minWidth: 208,
            padding: 6, background: "var(--fl-raised)", borderColor: "var(--fl-border-hi)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              className="fl-navitem"
              onClick={() => { onToggle(false); item.run(); }}
              style={{ fontSize: 12.5, padding: "8px 10px" }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Subscriber home. Presentational: every figure and every action arrives as a
 * prop, so it renders with no wallet connected.
 */
export default function SubscriberDashboard({
  loading = false,
  qusdcBalance = 0n,            // raw qUSDC base units (6dp)
  subscriptions = [],           // see the shape documented in the summary
  activity = [],
  explorerUrl = "https://mainnet.qiblockchain.online",
  onNewSubscription,
  onSetLimit,
  onClearLimit,
  onCancel,
  onViewExplorer,
}) {
  const [openMenu, setOpenMenu] = useState(null);

  useEffect(() => {
    if (!openMenu) return undefined;
    const close = () => setOpenMenu(null);
    const onKey = (e) => { if (e.key === "Escape") setOpenMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  // Callers may pass null (a query that has not resolved) or a sparse array;
  // both are treated as "nothing to show" rather than crashing the screen.
  const rows = useMemo(
    () => (Array.isArray(subscriptions) ? subscriptions.filter((s) => s && typeof s === "object") : []),
    [subscriptions]
  );
  const events = useMemo(
    () => (Array.isArray(activity) ? activity.filter((e) => e && typeof e === "object") : []),
    [activity]
  );

  const stats = useMemo(() => {
    const live = rows.filter((s) => {
      const st = statusOf(s);
      return st === "active" || st === "capped";
    });
    const merchants = new Set(live.map((s) => (s.merchant || s.merchantName || s.id || "").toString().toLowerCase()));
    const outflow = live.reduce((sum, s) => sum + monthlyUnits(s), 0n);
    const capped = new Set(
      rows.filter((s) => s.cap && toUnits(s.cap.maxAmount) > 0n)
        .map((s) => (s.merchant || s.merchantName || s.id || "").toString().toLowerCase())
    );
    const allMerchants = new Set(rows.map((s) => (s.merchant || s.merchantName || s.id || "").toString().toLowerCase()));
    return {
      activeCount: live.length,
      merchantCount: merchants.size,
      outflow,
      cappedCount: capped.size,
      merchantTotal: allMerchants.size,
    };
  }, [rows]);

  const dash = "-";

  return (
    <div>
      <h1 className="fl-title">Dashboard</h1>
      <p className="fl-sub">Recurring payments you fund, settled by the second on QIE.</p>

      <div className="fl-grid-4" style={{ marginBottom: 34 }}>
        <StatCard
          label="Wallet qUSDC"
          value={loading ? dash : toNumber(qusdcBalance).toFixed(2)}
        />
        <StatCard
          label="Active subscriptions"
          value={loading ? dash : String(stats.activeCount)}
          note={loading ? null : `across ${stats.merchantCount} ${stats.merchantCount === 1 ? "merchant" : "merchants"}`}
        />
        <StatCard
          label="Monthly outflow"
          tone="accent"
          value={loading ? dash : money(stats.outflow)}
          note={loading ? null : "committed per month"}
        />
        <StatCard
          label="Spending limits"
          value={
            loading ? dash : (
              <>
                {stats.cappedCount}
                <span style={{ color: "var(--fl-fg-3)", fontSize: 17 }}> / {stats.merchantTotal}</span>
              </>
            )
          }
          note={loading ? null : "merchants capped"}
        />
      </div>

      <div className="fl-row--between" style={{ marginBottom: 14 }}>
        <h2 className="fl-h2" style={{ margin: 0 }}>Your subscriptions</h2>
        <button
          className="fl-btn fl-btn--primary"
          onClick={onNewSubscription}
          style={{ padding: "8px 14px", fontSize: 12.5, gap: 7 }}
        >
          <IconPlus size={14} />
          <span>New subscription</span>
        </button>
      </div>

      {loading ? (
        <div className="fl-card fl-card--flush" style={{ marginBottom: 34 }}>
          <div className="fl-thead" style={{ gridTemplateColumns: COLS }}>
            <div className="fl-lbl">Merchant</div>
            <div className="fl-lbl">Price</div>
            <div className="fl-lbl">Spending limit</div>
            <div className="fl-lbl">Status</div>
            <div />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="fl-trow" style={{ gridTemplateColumns: COLS }}>
              <div className="fl-row">
                <div className="fl-avatar" />
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexGrow: 1 }}>
                  <Skeleton w="60%" h={11} />
                  <Skeleton w="42%" h={9} />
                </div>
              </div>
              <Skeleton w="64%" h={11} />
              <Skeleton w="80%" h={11} />
              <Skeleton w="52%" h={11} />
              <div />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ marginBottom: 34 }}>
          <EmptyState
            icon={<IconRepeat size={26} stroke="#333333" width={1.4} />}
            title="No subscriptions yet"
            body="Start one and Fluenci streams the payment to the merchant by the second. You can cap or cancel it at any time."
            actionLabel="New subscription"
            onAction={onNewSubscription}
          />
        </div>
      ) : (
        <div className="fl-card fl-card--flush" style={{ marginBottom: 34 }}>
          <div className="fl-thead" style={{ gridTemplateColumns: COLS }}>
            <div className="fl-lbl">Merchant</div>
            <div className="fl-lbl">Price</div>
            <div className="fl-lbl">Spending limit</div>
            <div className="fl-lbl">Status</div>
            <div />
          </div>

          {rows.map((sub, i) => {
            // subId is the identity when present; two streams to the same
            // merchant are legal, so the index is what keeps the fallback unique.
            const rowKey = sub.id ? String(sub.id) : `row-${i}`;
            const status = statusOf(sub);
            const pill = STATUS_PILL[status] || STATUS_PILL.active;
            const verification = verificationOf(sub);
            const name = sub.merchantName || sub.merchant || "Unknown merchant";
            const initial = (sub.merchantName || sub.merchant || "?").replace(/^0x/i, "").charAt(0).toUpperCase();
            const cap = sub.cap && toUnits(sub.cap.maxAmount) > 0n ? sub.cap : null;
            const used = cap ? capUsed(cap) : 0n;

            return (
              <div key={rowKey} className="fl-trow" style={{ gridTemplateColumns: COLS }}>
                <div className="fl-row">
                  <div className="fl-avatar">{initial}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {name}
                    </div>
                    <div className="fl-row" style={{ gap: 5, marginTop: 3 }}>
                      <IconCheck size={11} stroke={verification.verified ? "var(--fl-accent)" : "var(--fl-fg-3)"} />
                      <span style={{ color: "var(--fl-fg-3)", fontSize: 11 }}>{verification.text}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 13.5 }}>
                    {formatPrice(sub.amountPerPeriod, sub.periodSeconds)}
                  </div>
                  {toUnits(sub.owed) > 0n && (
                    <div className="fl-mono fl-stat-value--accent" style={{ fontSize: 11, marginTop: 3 }}
                         title={status === "ended"
                           ? "Final charge for the time already streamed, claimable by the merchant. It stopped growing when you cancelled."
                           : "Accrued and claimable by the merchant, not yet withdrawn from your wallet"}>
                      {money(sub.owed)} {status === "ended" ? "final charge" : "accruing"}
                    </div>
                  )}
                </div>

                <div>
                  {cap ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <div className="fl-mono" style={{ color: "var(--fl-fg-2)", fontSize: 12 }}>
                        {money(used)} of {money(cap.maxAmount)}
                      </div>
                      <Meter thin used={toNumber(used)} total={toNumber(cap.maxAmount)} />
                    </div>
                  ) : (
                    <span style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>No limit set</span>
                  )}
                </div>

                <div>
                  <span className={`fl-pill ${pill.cls}`}>{pill.label}</span>
                </div>

                <RowMenu
                  sub={sub}
                  open={openMenu === rowKey}
                  onToggle={(next) => setOpenMenu(next ? rowKey : null)}
                  onSetLimit={onSetLimit}
                  onClearLimit={onClearLimit}
                  onCancel={onCancel}
                />
              </div>
            );
          })}
        </div>
      )}

      <h2 className="fl-h2">Protocol activity</h2>

      {loading ? (
        <div className="fl-card fl-card--flush">
          <div className="fl-thead" style={{ gridTemplateColumns: ACTIVITY_COLS }}>
            <div className="fl-lbl">Merchant</div>
            <div className="fl-lbl">Amount</div>
            <div className="fl-lbl">When</div>
            <div className="fl-lbl">Transaction</div>
          </div>
          {[0, 1].map((i) => (
            <div key={i} className="fl-trow" style={{ gridTemplateColumns: ACTIVITY_COLS }}>
              <Skeleton w="58%" h={11} />
              <Skeleton w="40%" h={11} />
              <Skeleton w="46%" h={11} />
              <Skeleton w="66%" h={11} />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<IconPulse size={26} stroke="#333333" width={1.4} />}
          title="No settlements yet"
          body="Every payment your subscriptions settle onchain will appear here, with the merchant, amount and transaction."
          actionLabel="View on QIE Explorer"
          onAction={() => (onViewExplorer ? onViewExplorer() : window.open(explorerUrl, "_blank", "noopener"))}
        />
      ) : (
        <div className="fl-card fl-card--flush">
          <div className="fl-thead" style={{ gridTemplateColumns: ACTIVITY_COLS }}>
            <div className="fl-lbl">Merchant</div>
            <div className="fl-lbl">Amount</div>
            <div className="fl-lbl">When</div>
            <div className="fl-lbl">Transaction</div>
          </div>
          {events.map((event, i) => (
            <div key={`ev-${i}-${event.id || event.txHash || ""}`} className="fl-trow" style={{ gridTemplateColumns: ACTIVITY_COLS }}>
              <div className="fl-row">
                <IconShield size={14} stroke="var(--fl-fg-3)" />
                <span className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 13 }}>
                  {event.merchantName || event.merchant || "-"}
                </span>
              </div>
              <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 13 }}>{money(event.amount)}</div>
              <div style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>{whenLabel(event.timestamp)}</div>
              <div>
                {event.txHash ? (
                  <a
                    className="fl-link fl-mono"
                    href={`${explorerUrl}/tx/${event.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 12, fontWeight: 400 }}
                  >
                    {shortHash(event.txHash)}
                  </a>
                ) : (
                  <span style={{ color: "var(--fl-fg-3)", fontSize: 12 }}>-</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
