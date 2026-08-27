import { useState } from "react";
import { ethers } from "ethers";
import { StatCard, EmptyState, Meter } from "./DashboardShell";
import { IconShield, IconPlus } from "./icons";

/* ---------------------------------------------------------------------------
   Spending limits (subscriber).

   Presentational only: every piece of chain data and every write arrives as a
   prop, so the screen renders with no wallet connected. Amounts cross the prop
   boundary in raw 6-decimal qUSDC units (string, number or bigint); nothing in
   here ever shows the consumer a token unit, a rate per second or a period in
   seconds.
--------------------------------------------------------------------------- */

const MONTH = 2592000;

const PERIODS = [
  { seconds: 86400, name: "day" },
  { seconds: 604800, name: "week" },
  { seconds: MONTH, name: "month" },
];

const toUnits = (v) => {
  if (v === null || v === undefined || v === "") return 0n;
  try { return BigInt(v); } catch { return 0n; }
};

const money = (v) => {
  const n = Number(ethers.formatUnits(toUnits(v), 6));
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Raw units -> the string we put in the amount field. */
const toAmountField = (v) => {
  const s = ethers.formatUnits(toUnits(v), 6);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

/* "hour" / "3 hours" - a lone unit reads the way the named periods do
   ("$5.00 / hour"), which is how the copy elsewhere on this screen is worded. */
const plural = (n, unit) => (n === 1 ? unit : `${n} ${unit}s`);

/** Whole seconds, or 0 - the contract's window is a uint256, never fractional. */
const periodOf = (v) => Math.trunc(Number(v)) || 0;

/* Seconds -> the words a subscriber uses. A cap window is only bound by the
   contract's MIN_PERIOD (60s), so a cap set elsewhere can be hourly or per
   minute; rounding those to "1 days" would understate the drain by 1440x. */
const periodName = (seconds) => {
  const s = periodOf(seconds);
  const known = PERIODS.find((p) => p.seconds === s);
  if (known) return known.name;
  if (s >= 86400) return plural(Math.round(s / 86400), "day");
  if (s >= 3600) return plural(Math.round(s / 3600), "hour");
  return plural(Math.max(1, Math.round(s / 60)), "minute");
};

/** A cap is real only when it has a window; clearSpendCap wipes the period. */
const isCapped = (row) => periodOf(row?.periodSeconds) > 0;

/* Both producers of a cap row - useFluenciV4's spendCaps() read and the review
   fixtures - emit `used`, `merchantName` and `windowStart`, while this screen
   was written against `spentInWindow`, `name` and `windowResetsAt`. Read either
   spelling: taking only the second one showed every window as $0.00 drawn, every
   merchant as a bare address, and every reset as the generic "every month". */
const drawnOf = (row) => toUnits(row?.spentInWindow ?? row?.used);

const nameOf = (row) => row?.name || row?.merchantName || null;

const resetsAt = (row) => {
  const explicit = Number(row?.windowResetsAt) || 0;
  if (explicit) return explicit;
  const start = Number(row?.windowStart) || 0;
  const period = periodOf(row?.periodSeconds);
  return start && period ? start + period : 0;
};

const initial = (row) => (nameOf(row) || row?.merchant || "?").replace(/^0x/i, "").charAt(0).toUpperCase();

const label = (row) => nameOf(row) || (row?.merchant ? `${row.merchant.slice(0, 6)}••••${row.merchant.slice(-4)}` : "Unknown merchant");

function resetLine(row, now) {
  const at = resetsAt(row);
  if (!at) return `Window resets every ${periodName(row.periodSeconds)}`;
  const left = at - now;
  if (left <= 0) return "Window resets on the next draw";
  const days = Math.floor(left / 86400);
  if (days >= 1) return `Window resets in ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(left / 3600);
  if (hours >= 1) return `Window resets in ${hours} hour${hours === 1 ? "" : "s"}`;
  const mins = Math.max(1, Math.floor(left / 60));
  return `Window resets in ${mins} minute${mins === 1 ? "" : "s"}`;
}

export default function SpendingLimits({
  loading = false,
  limits = [],
  savingMerchant = null,
  onSetCap = null,
  onClearCap = null,
  onBrowseMerchants = null,
}) {
  // merchant address currently being edited, plus the draft form for it
  const [editing, setEditing] = useState(null);
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(MONTH);
  const [error, setError] = useState("");

  // snapshot once per mount: the reset copy is relative, not a live ticker
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  // the caller may hand us null (no wallet) or a list with holes in it
  const rows = Array.isArray(limits) ? limits.filter(Boolean) : [];
  const capped = rows.filter(isCapped);
  const uncapped = rows.filter((r) => !isCapped(r));

  // every cap restated per month so one number can stand for all of them
  const authorisedPerMonth = capped.reduce(
    (sum, r) => sum + (toUnits(r.maxAmount) * BigInt(MONTH)) / BigInt(periodOf(r.periodSeconds) || MONTH),
    0n
  );
  const cappedTotal = capped.reduce((sum, r) => sum + toUnits(r.maxAmount), 0n);
  const drawn = capped.reduce((sum, r) => sum + drawnOf(r), 0n);
  const drawnPct = cappedTotal > 0n ? Math.round((Number(drawn) / Number(cappedTotal)) * 100) : 0;

  const openEditor = (row) => {
    setEditing(row.merchant);
    setAmount(isCapped(row) ? toAmountField(row.maxAmount) : "");
    setPeriod(isCapped(row) ? periodOf(row.periodSeconds) : MONTH);
    setError("");
  };

  const closeEditor = () => {
    setEditing(null);
    setAmount("");
    setError("");
  };

  const save = (row) => {
    const trimmed = String(amount).trim();
    if (!trimmed) { setError("Enter an amount."); return; }
    let units;
    try { units = ethers.parseUnits(trimmed, 6); } catch { setError("Use a plain amount, like 20 or 12.50."); return; }
    if (units < 0n) { setError("Use a plain amount, like 20 or 12.50."); return; }
    setError("");
    onSetCap?.(row.merchant, units, Number(period));
    closeEditor();
  };

  const renderEditor = (row) => {
    const busy = savingMerchant === row.merchant;
    const zero = String(amount).trim() !== "" && Number(amount) === 0;
    return (
      <form
        className="fl-inner"
        style={{ padding: 16, marginTop: 16 }}
        onSubmit={(e) => { e.preventDefault(); save(row); }}
      >
        <div className="fl-lbl" style={{ marginBottom: 10 }}>
          {isCapped(row) ? "Change limit" : "Set a limit"}
        </div>
        <div className="fl-row" style={{ alignItems: "stretch" }}>
          <div style={{ position: "relative", flexGrow: 1, minWidth: 0 }}>
            <span
              className="fl-mono"
              style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--fl-fg-3)", fontSize: 14 }}
            >
              $
            </span>
            <input
              className="fl-input"
              style={{ paddingLeft: 30 }}
              inputMode="decimal"
              autoFocus
              placeholder="20.00"
              aria-label={`Limit for ${label(row)}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <select
            className="fl-input"
            style={{ width: "auto", flexShrink: 0 }}
            aria-label="Limit window"
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            {/* a window set elsewhere may not be one of the three; show it
                rather than let the control fall blank and misstate the cap */}
            {(PERIODS.some((p) => p.seconds === period)
              ? PERIODS
              : [...PERIODS, { seconds: period, name: periodName(period) }]
            ).map((p) => (
              <option key={p.seconds} value={p.seconds}>per {p.name}</option>
            ))}
          </select>
        </div>

        <div className="fl-row--between" style={{ marginTop: 14, alignItems: "center" }}>
          <span style={{ color: error ? "var(--fl-warn)" : "var(--fl-fg-3)", fontSize: 11.5, lineHeight: 1.5 }}>
            {error
              || (zero
                ? "A limit of $0.00 blocks this merchant from drawing at all."
                : `${label(row)} can never take more than this in one ${periodName(period)}.`)}
          </span>
          <div className="fl-row" style={{ gap: 8, flexShrink: 0 }}>
            <button type="button" className="fl-btn fl-btn--ghost" onClick={closeEditor} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="fl-btn fl-btn--primary" disabled={busy}>
              {busy ? "Saving" : "Save limit"}
            </button>
          </div>
        </div>

        {isCapped(row) && onClearCap && (
          <button
            type="button"
            className="fl-link"
            style={{ marginTop: 12, padding: 0, color: "var(--fl-fg-3)" }}
            disabled={busy}
            onClick={() => { onClearCap(row.merchant); closeEditor(); }}
          >
            Remove the limit
          </button>
        )}
      </form>
    );
  };

  const renderCapped = (row, key) => {
    const max = toUnits(row.maxAmount);
    const spent = drawnOf(row);
    const remaining = max > spent ? max - spent : 0n;
    const blocked = max === 0n;
    const reached = !blocked && remaining === 0n;
    const warn = blocked || reached;
    const isEditing = editing === row.merchant;

    return (
      <div className="fl-card" key={key}>
        <div className="fl-row--between" style={{ marginBottom: isEditing ? 0 : 18, alignItems: "center" }}>
          <div className="fl-row">
            <div className="fl-avatar" style={{ width: 36, height: 36, borderRadius: 9, fontSize: 13 }}>
              {initial(row)}
            </div>
            <div>
              <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 14 }}>{label(row)}</div>
              <div style={{ fontSize: 11.5, marginTop: 2, color: warn ? "var(--fl-warn)" : "var(--fl-fg-3)" }}>
                {blocked
                  ? "Blocked · this merchant cannot draw anything"
                  : reached
                    ? "Limit reached · stream paused until reset"
                    : resetLine(row, now)}
              </div>
            </div>
          </div>

          {!isEditing && (
            <div className="fl-row" style={{ gap: 10, flexShrink: 0 }}>
              <div className="fl-inner" style={{ padding: "8px 14px" }}>
                <span className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 13 }}>
                  {money(max)} / {periodName(row.periodSeconds)}
                </span>
              </div>
              <button
                type="button"
                className="fl-inner"
                style={{ padding: "8px 14px", color: "var(--fl-fg-2)", fontSize: 12.5, fontWeight: 500, fontFamily: "inherit", cursor: "pointer" }}
                onClick={() => openEditor(row)}
              >
                Edit
              </button>
            </div>
          )}
        </div>

        {isEditing ? renderEditor(row) : (
          <>
            <div className="fl-row--between" style={{ alignItems: "baseline", marginBottom: 8 }}>
              <span className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 13 }}>{money(spent)} drawn</span>
              <span className="fl-mono" style={{ fontSize: 12, color: warn ? "var(--fl-warn)" : "var(--fl-fg-3)" }}>
                {money(remaining)} remaining
              </span>
            </div>
            <Meter used={Number(spent)} total={Number(max)} />
          </>
        )}
      </div>
    );
  };

  const renderUncapped = (row, key) => {
    const isEditing = editing === row.merchant;
    return (
      <div className="fl-card fl-card--dashed" key={key}>
        <div className="fl-row--between" style={{ alignItems: "center" }}>
          <div className="fl-row">
            <div className="fl-avatar" style={{ width: 36, height: 36, borderRadius: 9, fontSize: 13, color: "var(--fl-fg-3)" }}>
              {initial(row)}
            </div>
            <div>
              <div className="fl-mono" style={{ color: "var(--fl-fg)", fontSize: 14 }}>{label(row)}</div>
              <div style={{ color: "var(--fl-fg-3)", fontSize: 11.5, marginTop: 2 }}>
                No limit set - draws whatever the subscription accrues
              </div>
            </div>
          </div>
          {!isEditing && (
            <button
              type="button"
              className="fl-btn fl-btn--primary"
              style={{ padding: "9px 16px", fontSize: 12.5, flexShrink: 0 }}
              onClick={() => openEditor(row)}
            >
              <IconPlus size={13} />
              <span>Set a limit</span>
            </button>
          )}
        </div>
        {isEditing && renderEditor(row)}
      </div>
    );
  };

  return (
    <>
      <h1 className="fl-title">Spending limits</h1>
      <p className="fl-sub" style={{ maxWidth: 560 }}>
        A merchant can never take more than the limit you set, whatever their subscription says.
        Raising a limit always needs your approval.
      </p>

      <div className="fl-grid-3" style={{ marginBottom: 34 }}>
        <StatCard
          label="Total authorised"
          value={loading ? "-" : money(authorisedPerMonth)}
          note={
            loading ? "Reading your caps"
              : capped.length === 0 ? "no limits set yet"
                : `per month, across ${capped.length} merchant${capped.length === 1 ? "" : "s"}`
          }
        />
        <StatCard
          label="Drawn this window"
          value={loading ? "-" : money(drawn)}
          tone="accent"
          note={
            loading ? "Reading your caps"
              : cappedTotal > 0n ? `${drawnPct}% of what you allow`
                : "nothing drawn against a limit"
          }
        />
        <StatCard
          label="Uncapped merchants"
          value={loading ? "-" : String(uncapped.length)}
          tone={!loading && uncapped.length > 0 ? "warn" : undefined}
          note={
            loading ? "Reading your caps"
              : uncapped.length > 0 ? "can draw without a ceiling"
                : "every merchant has a ceiling"
          }
        />
      </div>

      <h2 className="fl-h2">Per-merchant limits</h2>

      {loading ? (
        <div className="fl-card" style={{ color: "var(--fl-fg-3)", fontSize: 13 }}>
          Reading your limits from the chain.
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconShield size={26} stroke="var(--fl-fg-3)" />}
          title="No merchants to limit yet"
          body="Limits appear here once you have a subscription. Each one caps what that merchant can draw in a window, whatever their subscription says."
          actionLabel={onBrowseMerchants ? "Browse merchants" : undefined}
          onAction={onBrowseMerchants}
        />
      ) : (
        <div className="fl-stack">
          {rows.map((row, i) => {
            // a row without an address still needs a stable, unique key
            const key = row.merchant || `row-${i}`;
            return isCapped(row) ? renderCapped(row, key) : renderUncapped(row, key);
          })}
        </div>
      )}
    </>
  );
}
