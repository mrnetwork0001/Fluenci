import React, { useEffect, useState, useRef } from "react";
import { CheckCircle, XCircle, Loader, Send, Wallet, Radio, Clock, ExternalLink, X } from "lucide-react";

// Transaction progress steps
const TX_STEPS = [
  { key: "preparing", label: "Preparing Transaction", icon: Clock },
  { key: "awaiting_signature", label: "Awaiting Wallet Signature", icon: Wallet },
  { key: "broadcasting", label: "Broadcasting to Network", icon: Send },
  { key: "confirming", label: "Confirming onchain", icon: Radio },
];

const EXPLORER_URL = "https://mainnet.qie.digital";

function getStepIndex(status) {
  switch (status) {
    case "preparing": return 0;
    case "awaiting_signature": return 1;
    case "broadcasting": return 2;
    case "confirming": return 3;
    case "confirmed": return 4;
    case "error": return -1;
    default: return -1;
  }
}

export default function TransactionModal({ txState, onClose }) {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const status = txState?.status || "idle";
  const action = txState?.action || "";
  const hash = txState?.hash || "";
  const error = txState?.error || "";
  const currentStep = getStepIndex(status);
  const isFinished = status === "confirmed" || status === "error";
  const isVisible = txState && status !== "idle";

  // Elapsed time counter
  useEffect(() => {
    if (status !== "idle" && !isFinished) {
      setElapsed(0);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status, isFinished]);

  // Stop timer when finished
  useEffect(() => {
    if (isFinished && timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isFinished]);

  const formatElapsed = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const truncateHash = (h) => h ? `${h.slice(0, 10)}…${h.slice(-8)}` : "";

  // Don't render if no transaction in progress
  if (!isVisible) return null;

  return (
    <div className="tx-modal-overlay" onClick={onClose}>
      <div className="tx-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Close button (always visible) */}
        <button className="tx-modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        {/* Header */}
        <div className="tx-modal-header">
          <div className="tx-modal-header-icon">
            {status === "confirmed" ? (
              <div className="tx-icon-success">
                <CheckCircle size={32} />
              </div>
            ) : status === "error" ? (
              <div className="tx-icon-error">
                <XCircle size={32} />
              </div>
            ) : (
              <div className="tx-icon-pending">
                <Loader size={32} className="tx-spinner" />
              </div>
            )}
          </div>
          <div className="tx-modal-header-text">
            <h3 className="tx-modal-title">
              {status === "confirmed"
                ? "Transaction Confirmed"
                : status === "error"
                ? "Transaction Failed"
                : action || "Processing Transaction"}
            </h3>
            <p className="tx-modal-subtitle">
              {status === "confirmed"
                ? "Your transaction was successfully confirmed onchain."
                : status === "error"
                ? "Something went wrong during the transaction."
                : "Please wait while your transaction is processed."}
            </p>
          </div>
        </div>

        {/* Progress Steps */}
        <div className="tx-steps-container">
          {TX_STEPS.map((step, idx) => {
            const StepIcon = step.icon;
            let stepStatus = "pending"; // pending, active, completed, error
            if (status === "error" && currentStep === -1 && idx === 0) {
              stepStatus = "error";
            } else if (status === "error" && idx <= Math.max(currentStep, 0)) {
              stepStatus = idx === Math.max(currentStep, 0) ? "error" : "completed";
            } else if (idx < currentStep) {
              stepStatus = "completed";
            } else if (idx === currentStep) {
              stepStatus = "active";
            } else if (status === "confirmed") {
              stepStatus = "completed";
            }

            return (
              <div key={step.key} className={`tx-step tx-step-${stepStatus}`}>
                <div className="tx-step-indicator">
                  <div className={`tx-step-dot tx-dot-${stepStatus}`}>
                    {stepStatus === "completed" ? (
                      <CheckCircle size={16} />
                    ) : stepStatus === "active" ? (
                      <Loader size={16} className="tx-spinner" />
                    ) : stepStatus === "error" ? (
                      <XCircle size={16} />
                    ) : (
                      <div className="tx-step-number">{idx + 1}</div>
                    )}
                  </div>
                  {idx < TX_STEPS.length - 1 && (
                    <div className={`tx-step-line ${stepStatus === "completed" ? "tx-line-completed" : ""}`} />
                  )}
                </div>
                <div className="tx-step-content">
                  <div className="tx-step-label">
                    <StepIcon size={14} style={{ opacity: 0.7 }} />
                    <span>{step.label}</span>
                  </div>
                  {stepStatus === "active" && !isFinished && (
                    <div className="tx-step-detail tx-step-active-pulse">In progress…</div>
                  )}
                  {stepStatus === "completed" && idx === 2 && hash && (
                    <div className="tx-step-detail">Tx sent to QIE Mainnet</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* QIE Testnet Faucet helper callout */}
        {action?.toLowerCase().includes("kyc") && !isFinished && (
          <div style={{
            margin: "16px 0",
            padding: "12px",
            background: "rgba(37, 99, 235, 0.08)",
            border: "1px solid rgba(37, 99, 235, 0.2)",
            borderRadius: "10px",
            fontSize: "0.75rem",
            color: "#cccccc",
            lineHeight: "1.45",
            textAlign: "left"
          }}>
            💡 <strong>No Testnet QIE for gas?</strong> If you need tokens to sign the KYC transaction, you can request free testnet gas from the official <a href="https://faucet.qie.digital" target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "underline", fontWeight: "700" }}>QIE Faucet</a> without closing this window.
          </div>
        )}

        {/* Transaction Hash */}
        {hash && (
          <div className="tx-hash-container">
            <div className="tx-hash-label">Transaction Hash</div>
            <a
              className="tx-hash-value"
              href={`${EXPLORER_URL}/tx/${hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <code>{truncateHash(hash)}</code>
              <ExternalLink size={13} />
            </a>
          </div>
        )}

        {/* Error Message */}
        {status === "error" && error && (
          <div className="tx-error-box">
            <XCircle size={16} />
            <span>{error.length > 200 ? error.slice(0, 200) + "…" : error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="tx-modal-footer">
          {!isFinished && (
            <div className="tx-elapsed">
              <Clock size={13} />
              <span>Elapsed: {formatElapsed(elapsed)}</span>
            </div>
          )}
          {isFinished && (
            <button className={`btn ${status === "confirmed" ? "btn-primary" : "btn-secondary"}`} onClick={onClose}>
              {status === "confirmed" ? "Done" : "Dismiss"}
            </button>
          )}
        </div>

        {/* Animated scan line on the modal during pending */}
        {!isFinished && <div className="tx-modal-scanline" />}
      </div>
    </div>
  );
}
