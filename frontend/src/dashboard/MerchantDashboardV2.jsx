import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { StatCard, EmptyState, Meter } from "./DashboardShell";
import { IconCopy, IconCheck, IconStore } from "./icons";

/* qUSDC is a 6-decimal token. Everything on this screen is money, so every raw
   value that arrives from the chain goes through here before it is shown. */
const DECIMALS = 6;

/** Coerce a prop that may be a BigInt, a decimal-free string or a number into BigInt units. */
const toUnits = (v) => {
  if (v === null || v === undefined || v === "") return 0n;
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    return BigInt(String(v).trim());
  } catch {
    return 0n;
  }
};

const toNumber = (raw) => {
  try {
    return parseFloat(ethers.formatUnits(toUnits(raw), DECIMALS));
  } catch {
    return 0;
  }
};

const money = (raw, fractionDigits = 2) =>
  `$${toNumber(raw).toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;

const plain = (raw) =>
  toNumber(raw).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Gate enum on FluenciRegistryV4: 0 OPEN, 1 QIE_ID, 2 QIE_PASS, 3 MIN_REPUTATION. */
const GATES = [
  { value: 0, label: "Open", help: "Anyone with a wallet." },
  { value: 1, label: "QIE ID required", help: "Must hold a registered QIE ID." },
  { value: 2, label: "QIE Pass verified", help: "Identity-verified subscribers only." },
  { value: 3, label: "Minimum reputation", help: "Reputation score at or above" },
];

/* QIE reputation is scored 0-100 (tiers: New 0-29, Active 30-49, Trusted 50-69,
   Strong 70-84, Elite 85-100). The threshold meter uses the same scale. */
const REPUTATION_MAX = 100;
const REPUTATION_DEFAULT = 50; // "Trusted" — a sensible starting gate

/* useFluenci's kycState.status values while a QIE Pass request is in flight. */
const VERIFY_BUSY_LABEL = {
  creating: "Starting QIE Pass…",
  pending_kyc: "Finish KYC in the QIE Pass tab",
  pending_consent: "Approve the request in QIE Wallet",
  claiming: "Recording on-chain…",
  pending_onchain: "Waiting for the on-chain record…",
};

/**
 * Merchant home. Presentational: every chain value and every action arrives as a
 * prop, so the screen renders with no wallet connected.
 */
export default function MerchantDashboardV2({
  loading = false,
  // money values arrive as raw 6-decimal base units (string | bigint | number)
  claimable = "0",
  monthlyRecurring = "0",
  settledAllTime = "0",
  subscriberCount = 0,
  // QIE Reputation is an off-chain HTTP service: display-only, may be absent
  reputationScore = null,
  qiePassVerified = false,
  merchantName = "",
  paymentLinkHost = "fluenci.xyz/pay",
  gate = 0,
  minReputation = REPUTATION_DEFAULT,
  reputationGateAvailable = false,
  idGateAvailable = false,
  claiming = false,
  savingPolicy = false,
  onClaim = () => {},
  onVerify = () => {},
  verifying = false,
  // Optional, from useFluenci.kycState: status, the message for pending/failed
  // requests, and the QIE Pass link in case the popup was blocked.
  verifyStatus = "idle",
  verifyMessage = "",
  verifyUrl = "",
  onCheckVerify = null,
  kycRequired = true,
  onSavePolicy = () => {},
  onCopyPaymentLink = () => {},
  onRegisterName = () => {},
}) {
  const [selectedGate, setSelectedGate] = useState(gate);
  const [threshold, setThreshold] = useState(String(minReputation ?? REPUTATION_DEFAULT));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSelectedGate(gate);
  }, [gate]);

  useEffect(() => {
    setThreshold(String(minReputation ?? REPUTATION_DEFAULT));
  }, [minReputation]);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const claimableAmount = toNumber(claimable);
  const hasActivity =
    claimableAmount > 0 || toNumber(settledAllTime) > 0 || Number(subscriberCount) > 0;
  const paymentLink = merchantName ? `${paymentLinkHost}/${merchantName}` : "";

  // kycState only reaches "verified" after useFluenci read the adapter itself, so
  // it can stand in until the v4 read here catches up.
  const passVerified = qiePassVerified || verifyStatus === "verified";
  const needsKyc = kycRequired && !passVerified;
  const canClaim = !loading && !claiming && claimableAmount > 0 && !needsKyc;
  const verifyBusy = verifying || Boolean(VERIFY_BUSY_LABEL[verifyStatus]);
  const verifyFailed = verifyStatus === "error" || verifyStatus === "expired";
  const claimNote = needsKyc
    ? "Withdrawing requires a verified QIE Pass. Accruals keep running whether or not you claim."
    : claimableAmount <= 0
    ? "Nothing to claim yet. Accruals keep running whether or not you claim."
    : "Accruals keep running whether or not you claim.";

  const copyLink = async () => {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(`https://${paymentLink}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    onCopyPaymentLink?.(`https://${paymentLink}`);
  };

  // Shown both on the claim card and above the empty state: a merchant with no
  // activity yet still has to be able to verify.
  const verifyBlock = (
    <div style={{ marginBottom: 12 }}>
      <button
        className="fl-btn fl-btn--primary fl-btn--block"
        disabled={verifyBusy}
        onClick={() => onVerify?.()}
      >
        {verifyBusy ? VERIFY_BUSY_LABEL[verifyStatus] || "Waiting on QIE Pass…" : "Verify with QIE Pass"}
      </button>
      {verifyStatus === "pending_kyc" && verifyUrl && (
        <a
          className="fl-link"
          href={verifyUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-block", marginTop: 8, fontSize: 12 }}
        >
          Open QIE Pass
        </a>
      )}
      {(verifyFailed || verifyStatus === "pending_onchain") && verifyMessage && (
        <div
          style={{
            color: verifyFailed ? "var(--fl-warn)" : "var(--fl-fg-3)",
            fontSize: 12,
            lineHeight: 1.55,
            marginTop: 8,
          }}
        >
          {verifyMessage}
        </div>
      )}
      {verifyStatus === "pending_onchain" && onCheckVerify && (
        <button className="fl-link" onClick={() => onCheckVerify()} style={{ padding: 0, marginTop: 6, fontSize: 12 }}>
          Check again
        </button>
      )}
    </div>
  );

  const thresholdNumber = Math.max(0, parseInt(threshold, 10) || 0);
  const policyDisabled =
    loading || savingPolicy || (selectedGate === 3 && (!reputationGateAvailable || thresholdNumber <= 0));

  return (
    <>
      <h1 className="fl-title">Merchant</h1>
      <p className="fl-sub">Recurring revenue from subscribers, settling continuously.</p>

      <div className="fl-grid-4" style={{ marginBottom: 34 }}>
        <StatCard
          label="Claimable now"
          tone="accent"
          value={loading ? "-" : money(claimable)}
        />
        <StatCard
          label="Monthly recurring"
          value={loading ? "-" : money(monthlyRecurring)}
          note={
            loading
              ? "Loading"
              : `from ${Number(subscriberCount) || 0} ${
                  Number(subscriberCount) === 1 ? "subscriber" : "subscribers"
                }`
          }
        />
        <StatCard
          label="Settled all time"
          value={loading ? "-" : money(settledAllTime, 0)}
        />
        <StatCard
          label="Your reputation"
          value={
            loading ? (
              "-"
            ) : reputationScore === null || reputationScore === undefined ? (
              <span style={{ fontSize: 19, color: "var(--fl-fg-3)" }}>Unavailable</span>
            ) : (
              String(reputationScore)
            )
          }
          note={
            loading
              ? "Loading"
              : reputationScore === null || reputationScore === undefined
              ? "QIE has not published a score for this address."
              : passVerified
              ? "QIE Pass verified"
              : "QIE Pass not verified"
          }
        />
      </div>

      <div className="fl-split fl-split--merchant">
        {/* ---- left column -------------------------------------------------- */}
        <div>
          <h2 className="fl-h2">Claim earnings</h2>

          {!loading && !hasActivity ? (
            <div style={{ marginBottom: 24 }}>
              {needsKyc && (
                <>
                  {verifyBlock}
                  <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, marginBottom: 14 }}>
                    Withdrawing earnings requires a verified QIE Pass.
                  </div>
                </>
              )}
              <EmptyState
                icon={<IconStore size={26} stroke="var(--fl-fg-3)" />}
                title="Nothing has settled yet"
                body="Earnings appear here the moment a subscriber opens a stream. Share your payment link to get the first one."
                actionLabel={paymentLink ? "Copy payment link" : undefined}
                onAction={copyLink}
              />
            </div>
          ) : (
            <div className="fl-card" style={{ marginBottom: 24 }}>
              <div className="fl-lbl" style={{ marginBottom: 10 }}>
                Available to withdraw
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 18 }}>
                <span className="fl-mono" style={{ fontSize: 35, fontWeight: 600 }}>
                  {loading ? "-" : plain(claimable)}
                </span>
                <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 14 }}>
                  qUSDC
                </span>
              </div>
              {!loading && needsKyc ? (
                verifyBlock
              ) : (
                <button
                  className="fl-btn fl-btn--primary fl-btn--block"
                  disabled={!canClaim}
                  onClick={() => onClaim?.()}
                  style={{ marginBottom: 12 }}
                >
                  {claiming ? "Claiming…" : "Claim to wallet"}
                </button>
              )}
              <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55 }}>
                {loading ? "Reading your balance." : claimNote}
              </div>
            </div>
          )}

          <h2 className="fl-h2">Payment link</h2>
          {loading ? (
            <div className="fl-card">
              <div className="fl-inner" style={{ padding: "13px 16px", marginBottom: 12 }}>
                <span className="fl-mono" style={{ color: "var(--fl-fg-3)", fontSize: 13 }}>
                  {paymentLinkHost}/…
                </span>
              </div>
              <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55 }}>
                Reading your registered name.
              </div>
            </div>
          ) : !paymentLink ? (
            <EmptyState
              icon={<IconStore size={26} stroke="var(--fl-fg-3)" />}
              title="No payment link yet"
              body="Register a QIE name and your link becomes fluenci.xyz/pay/yourname. Until then subscribers need your address."
              actionLabel="Register a QIE name"
              onAction={onRegisterName}
            />
          ) : (
            <div className="fl-card">
              <div
                className="fl-inner fl-row--between"
                style={{ padding: "13px 16px", marginBottom: 12 }}
              >
                <span className="fl-mono" style={{ fontSize: 13 }}>
                  {paymentLink}
                </span>
                <button
                  className="fl-link"
                  onClick={copyLink}
                  aria-label={copied ? "Payment link copied" : "Copy payment link"}
                  style={{ display: "flex", padding: 0 }}
                >
                  {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                </button>
              </div>
              <div style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55 }}>
                {copied
                  ? "Copied to your clipboard."
                  : "Share this and anyone can subscribe at your published price. No integration needed."}
              </div>
            </div>
          )}
        </div>

        {/* ---- right column: access policy ---------------------------------- */}
        <div className="fl-card">
          <div className="fl-lbl" style={{ marginBottom: 7 }}>
            Access policy
          </div>
          <div
            style={{ color: "var(--fl-fg-3)", fontSize: 12, lineHeight: 1.55, marginBottom: 18 }}
          >
            Choose who is allowed to open a subscription to you.
          </div>

          <div className="fl-stack" style={{ gap: 9 }} role="radiogroup" aria-label="Access policy">
            {GATES.map(({ value, label, help }) => {
              const isReputation = value === 3;
              // QIE ID gating is wired on mainnet (QieIdAdapter), so only the
              // reputation gate can still be unavailable (awaiting QIE's signer).
              const unavailable = isReputation && !reputationGateAvailable;
              const disabled = loading || unavailable;
              const on = selectedGate === value;
              return (
                <label
                  key={value}
                  className={`fl-inner${on && !disabled ? " fl-inner--accent" : ""}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "14px 16px",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.55 : 1,
                  }}
                >
                  <input
                    type="radio"
                    name="fl-access-gate"
                    value={value}
                    checked={on}
                    disabled={disabled}
                    onChange={() => setSelectedGate(value)}
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      opacity: 0,
                      pointerEvents: "none",
                    }}
                  />
                  <span
                    aria-hidden="true"
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: "50%",
                      flexShrink: 0,
                      marginTop: 1,
                      border: on
                        ? "4.5px solid var(--fl-accent)"
                        : "1.5px solid var(--fl-border-hi)",
                    }}
                  />
                  <span style={{ flexGrow: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500 }}>
                      {label}
                      {value === gate && (
                        <span className="fl-pill fl-pill--on" style={{ flexShrink: 0 }}>Active</span>
                      )}
                    </span>
                    <span
                      style={{
                        display: "block",
                        color: "var(--fl-fg-3)",
                        fontSize: 11.5,
                        marginTop: 2,
                      }}
                    >
                      {help}
                    </span>

                    {unavailable && (
                      <span
                        style={{
                          display: "block",
                          color: "var(--fl-warn)",
                          fontSize: 11.5,
                          marginTop: 8,
                          lineHeight: 1.5,
                        }}
                      >
                        Not available yet — waiting on QIE to issue its reputation signing key. Selecting this would block every subscriber.
                      </span>
                    )}

                    {isReputation && reputationGateAvailable && on && (
                      <span style={{ display: "block", marginTop: 10 }}>
                        <span className="fl-row" style={{ gap: 11 }}>
                          <span style={{ flexGrow: 1 }}>
                            <Meter used={thresholdNumber} total={REPUTATION_MAX} thin />
                          </span>
                          <input
                            className="fl-input fl-mono"
                            type="number"
                            min="1"
                            step="10"
                            value={threshold}
                            onChange={(e) => setThreshold(e.target.value)}
                            aria-label="Minimum reputation score"
                            style={{ width: 84, padding: "6px 9px", fontSize: 12.5 }}
                          />
                        </span>
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          <button
            className="fl-btn fl-btn--ghost fl-btn--block"
            style={{ marginTop: 18 }}
            disabled={policyDisabled}
            onClick={() => onSavePolicy?.(selectedGate, selectedGate === 3 ? thresholdNumber : 0)}
          >
            {savingPolicy ? "Saving…" : "Save policy"}
          </button>
        </div>
      </div>
    </>
  );
}
