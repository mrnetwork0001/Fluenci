import React, { useState, useEffect, useRef } from "react";
import { Plus, Play, Trash2, AlertTriangle, ShieldAlert, Sparkles, Coins, ArrowRight, ShieldCheck, Scale, RefreshCw, Send, ExternalLink, Loader2 } from "lucide-react";
import { ethers } from "ethers";
import { API_BASE_URL } from "../config";

export default function SubscriberPanel({
  account,
  qieBalance,
  qusdcBalance,
  qusdcAllowance,
  qiePassVerified,
  subscriberStreams,
  realtimeClaimables,
  loading,
  approveToken,
  toggleQiePassStatus,
  createSubscription,
  resumeStream,
  terminateStream,
  openDispute,
  resolveDisputeOnChain,
  transferStreamNFT,
  swapQieForTokens,
  contracts,
  kycState,
  checkKycStatus,
  resolveQieDomain
}) {
  const [merchant, setMerchant] = useState("");
  const [resolvingDomain, setResolvingDomain] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState(null);
  const [resolutionError, setResolutionError] = useState(false);

  const [rate, setRate] = useState(""); // rate per hour
  const [tokenSymbol, setTokenSymbol] = useState("QUSDC");
  const [cliffSeconds, setCliffSeconds] = useState("");
  const [stopSeconds, setStopSeconds] = useState("");

  const [inputMode, setInputMode] = useState("rate"); // "rate" | "total"
  const [totalAmount, setTotalAmount] = useState("");
  const [durationValue, setDurationValue] = useState("");
  const [durationUnit, setDurationUnit] = useState("hours"); // "seconds" | "hours" | "days"

  const [swapAmount, setSwapAmount] = useState("1");
  const [swapToken, setSwapToken] = useState("QUSDC");
  const [swapMode, setSwapMode] = useState("QIE_TO_QUSDC"); // QIE_TO_QUSDC | QUSDC_TO_QIE

  // Dispute and Transfer state
  const [transferTarget, setTransferTarget] = useState({});
  const [disputeEvidence, setDisputeEvidence] = useState({});
  const [arbitrationDetails, setArbitrationDetails] = useState({});

  const [expectedOutput, setExpectedOutput] = useState("0");
  const [calculatingSwap, setCalculatingSwap] = useState(false);
  const [qiePrice, setQiePrice] = useState(0.08); // default fallback price of 1 QIE = $0.08

  // Dynamic swap quote calculations using getAmountsOut
  useEffect(() => {
    let active = true;
    const fetchOutput = async () => {
      if (!swapAmount || isNaN(swapAmount) || parseFloat(swapAmount) <= 0 || !contracts.qusdc || (!contracts.fluenciRouter && !contracts.qiedex)) {
        setExpectedOutput("0");
        return;
      }
      setCalculatingSwap(true);
      try {
        // Use QieDex directly for quotes (read-only, no attribution needed)
        const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
        const dexContract = new ethers.Contract(
          contracts.qiedex, 
          ["function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"], 
          provider
        );
        const isReverse = swapMode === "QUSDC_TO_QIE";
        const path = isReverse
          ? [contracts.qusdc, "0x0087904D95BEe9E5F24dc8852804b547981A9139"] // QUSDC → WQIE
          : ["0x0087904D95BEe9E5F24dc8852804b547981A9139", contracts.qusdc]; // WQIE → qUSDC
        
        const decimalsIn = isReverse ? 6 : 18;
        const decimalsOut = isReverse ? 18 : 6;
        
        const amountIn = ethers.parseUnits(swapAmount, decimalsIn);
        const amounts = await dexContract.getAmountsOut(amountIn, path);
        if (active) {
          setExpectedOutput(ethers.formatUnits(amounts[1], decimalsOut));
        }
      } catch (e) {
        console.warn("Failed to fetch expected swap output", e);
        if (active) setExpectedOutput("0");
      } finally {
        if (active) setCalculatingSwap(false);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      fetchOutput();
    }, 500); // 500ms debounce to avoid spamming the RPC

    return () => {
      active = false;
      clearTimeout(delayDebounceFn);
    };
  }, [swapAmount, swapMode, contracts.fluenciRouter, contracts.qiedex, contracts.qusdc]);

  // Fetch dynamic QIE price in USD (QUSDC) using QIEDex getAmountsOut
  useEffect(() => {
    let active = true;
    const fetchQiePrice = async () => {
      try {
        const provider = new ethers.JsonRpcProvider("https://rpc1mainnet.qie.digital");
        const MAINNET_DEX = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
        const MAINNET_QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
        const dexContract = new ethers.Contract(
          MAINNET_DEX, 
          ["function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[])"], 
          provider
        );
        const path = ["0x0087904D95BEe9E5F24dc8852804b547981A9139", MAINNET_QUSDC]; // WQIE → qUSDC
        const amountIn = ethers.parseUnits("1", 18);
        const amounts = await dexContract.getAmountsOut(amountIn, path);
        if (active) {
          const price = parseFloat(ethers.formatUnits(amounts[1], 6));
          if (price > 0) {
            setQiePrice(price);
          }
        }
      } catch (e) {
        console.warn("Failed to fetch dynamic QIE price", e);
      }
    };
    fetchQiePrice();
    // Poll price every 30 seconds
    const interval = setInterval(fetchQiePrice, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Resolve / Validate input address or domain
  const resolveQieDomainRef = useRef(resolveQieDomain);
  useEffect(() => {
    resolveQieDomainRef.current = resolveQieDomain;
  }, [resolveQieDomain]);

  useEffect(() => {
    if (!merchant) {
      setResolvedAddress(null);
      setResolutionError(false);
      setResolvingDomain(false);
      return;
    }

    const trimmed = merchant.trim();

    // Check if it is a valid hex address
    if (ethers.isAddress(trimmed)) {
      setResolvedAddress(trimmed);
      setResolutionError(false);
      setResolvingDomain(false);
      return;
    }

    // Check if it is a QIE domain
    if (trimmed.toLowerCase().endsWith(".qie")) {
      setResolvingDomain(true);
      setResolutionError(false);
      setResolvedAddress(null);

      const delayDebounceFn = setTimeout(async () => {
        try {
          const resolver = resolveQieDomainRef.current;
          if (resolver) {
            const resolved = await resolver(trimmed);
            if (resolved && resolved !== ethers.ZeroAddress && resolved !== "0x0000000000000000000000000000000000000000") {
              setResolvedAddress(resolved);
              setResolutionError(false);
            } else {
              setResolvedAddress(null);
              setResolutionError(true);
            }
          } else {
            setResolutionError(true);
          }
        } catch (err) {
          setResolvedAddress(null);
          setResolutionError(true);
        } finally {
          setResolvingDomain(false);
        }
      }, 600); // 600ms debounce to avoid rapid API calls while typing

      return () => clearTimeout(delayDebounceFn);
    } else {
      setResolvedAddress(null);
      if (trimmed.length > 5) {
        setResolutionError(true);
      } else {
        setResolutionError(false);
      }
      setResolvingDomain(false);
    }
  }, [merchant]);

  const handleSubmitSubscription = (e) => {
    e.preventDefault();
    if (!merchant) return;

    let calculatedRatePerSecond = 0n;
    let finalStopSeconds = 0;
    const decimals = tokenSymbol === "QUSDC" ? 6 : 18;

    if (inputMode === "rate") {
      if (!rate) return;
      const rateVal = parseFloat(rate);
      calculatedRatePerSecond = BigInt(Math.floor((rateVal * (10 ** decimals)) / 3600));
      finalStopSeconds = stopSeconds ? Number(stopSeconds) : 0;
    } else {
      if (!totalAmount || !durationValue) return;
      const totalAmountVal = parseFloat(totalAmount);
      const durVal = parseFloat(durationValue);
      let durInSeconds = 0;
      if (durationUnit === "seconds") durInSeconds = durVal;
      else if (durationUnit === "hours") durInSeconds = durVal * 3600;
      else if (durationUnit === "days") durInSeconds = durVal * 86400;

      if (durInSeconds <= 0) {
        alert("Duration must be greater than zero");
        return;
      }
      calculatedRatePerSecond = BigInt(Math.floor((totalAmountVal * (10 ** decimals)) / durInSeconds));
      finalStopSeconds = Math.floor(durInSeconds);
    }
    
    if (calculatedRatePerSecond <= 0n) {
      alert("Calculated streaming rate is too small. Try a higher total amount or shorter duration.");
      return;
    }

    createSubscription(
      merchant, 
      tokenSymbol, 
      calculatedRatePerSecond.toString(), 
      cliffSeconds ? Number(cliffSeconds) : 0, 
      finalStopSeconds
    );
    setMerchant("");
    setRate("");
    setTotalAmount("");
    setDurationValue("");
    setCliffSeconds("");
    setStopSeconds("");
  };

  const isAllowanceApproved = (symbol) => {
    return parseFloat(qusdcAllowance) > 0;
  };

  // Request AI arbitration details from offchain node
  const requestArbitration = async (subId, stream) => {
    if (!API_BASE_URL) { alert("AI Arbitrator requires the backend server to be running."); return; }
    try {
      const response = await fetch(`${API_BASE_URL}/arbitrate-dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subId,
          evidence: disputeEvidence[subId] || "Services not rendered",
          merchantShare: Math.floor(stream.ratePerSecond * 5), // Mock 5 seconds worth of streams payout
          subscriberRefund: Math.floor(stream.ratePerSecond * 10) // Mock 10 seconds worth of refund
        })
      });
      const data = await response.json();
      if (data.success) {
        setArbitrationDetails(prev => ({
          ...prev,
          [subId]: data
        }));
      } else {
        alert("AI Arbitration failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert(`Failed to contact AI Arbitrator. Make sure the server is running on ${API_BASE_URL}.`);
    }
  };

  const executeArbitration = async (subId) => {
    const details = arbitrationDetails[subId];
    if (!details) return;
    try {
      await resolveDisputeOnChain(
        subId,
        details.subscriberRefund.toString(),
        details.merchantShare.toString(),
        details.signature
      );
      // Clean states
      setArbitrationDetails(prev => {
        const next = { ...prev };
        delete next[subId];
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  };

  // SVG Line Chart coordinates calculations based on active streaming rates
  const totalUSDCActiveOutflow = subscriberStreams
    .filter(s => s.active && !s.pausedByAI && s.disputeState === 0 && s.tokenSymbol === "QUSDC")
    .reduce((sum, s) => sum + (s.ratePerSecond * 3600 / 1e6), 0);

  // Formats address or returns domain name if pre-mapped
  const formatAddress = (addr) => {
    if (addr.toLowerCase() === "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".toLowerCase()) return "netflix.qie";
    if (addr.toLowerCase() === "0xfe5f1d13a31a5b86833adf4486720331d6e4a6bb") return "fluenci.qie";
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const isInsufficientBalance = !isNaN(parseFloat(swapAmount)) && (
    swapMode === "QIE_TO_QUSDC"
      ? parseFloat(swapAmount) > parseFloat(qieBalance)
      : parseFloat(swapAmount) > parseFloat(qusdcBalance)
  );

  const qieValueUsd = parseFloat(qieBalance || 0) * qiePrice;
  const qusdcValueUsd = parseFloat(qusdcBalance || 0);
  const totalPortfolioValue = qieValueUsd + qusdcValueUsd;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
      
      {/* 1. Subscriber Credentials Grid */}
      <div className="subscriber-credentials-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px" }}>
        
        {/* Token balances Card */}
        <div className="glass-card">
          <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: "0 0 16px 0" }}>
            Self-Custody Balances
          </h3>
          <div style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid rgba(0, 0, 0, 0.06)" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
              Total Portfolio Value
            </div>
            <div style={{ fontSize: "1.8rem", fontWeight: "800", color: "#111111", fontFamily: "'Montserrat', sans-serif" }}>
              ${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div style={{ display: "grid", gap: "10px" }}>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Native QIE:</span>
              <div style={{ textAlign: "right" }}>
                <strong style={{ color: "#111111", display: "block" }}>{parseFloat(qieBalance).toFixed(4)} QIE</strong>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  ${qieValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" }}>
              <span>QUSDC stable:</span>
              <div style={{ textAlign: "right" }}>
                <strong style={{ color: "#111111", display: "block" }}>{parseFloat(qusdcBalance).toFixed(4)} QUSDC</strong>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  ${qusdcValueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Option C: Qiedex Swap Card */}
        <div className="glass-card">
          <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: "0 0 12px 0" }}>
            Qiedex Instant Auto-Swap
          </h3>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 12px 0" }}>
            Instantly swap native QIE to streaming tokens or convert earnings back to QIE.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1, minWidth: "50px" }}>
                <input 
                  type="number"
                  placeholder="0.0"
                  className="glass-card"
                  style={{ 
                    padding: "8px 12px", 
                    width: "100%", 
                    borderRadius: "6px", 
                    fontSize: "0.85rem", 
                    color: "#111111", 
                    background: "rgba(0,0,0,0.04)", 
                    border: isInsufficientBalance ? "1px solid #cc0000" : "1px solid #d0d0d0",
                    outline: "none",
                    boxSizing: "border-box"
                  }}
                  value={swapAmount}
                  onChange={(e) => setSwapAmount(e.target.value)}
                />
                <span style={{ 
                  position: "absolute", 
                  right: "10px", 
                  top: "50%", 
                  transform: "translateY(-50%)", 
                  fontSize: "0.75rem", 
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}>
                  <button
                    type="button"
                    onClick={() => setSwapAmount(
                      swapMode === "QIE_TO_QUSDC"
                        ? parseFloat(qieBalance).toString()
                        : parseFloat(qusdcBalance).toString()
                    )}
                    style={{
                      background: "rgba(37, 99, 235, 0.1)",
                      border: "1px solid rgba(37, 99, 235, 0.25)",
                      borderRadius: "4px",
                      color: "#2563eb",
                      fontSize: "0.65rem",
                      fontWeight: "700",
                      padding: "2px 6px",
                      cursor: "pointer",
                      letterSpacing: "0.04em",
                      transition: "all 0.2s"
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = "rgba(37, 99, 235, 0.2)";
                      e.currentTarget.style.borderColor = "#2563eb";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = "rgba(37, 99, 235, 0.1)";
                      e.currentTarget.style.borderColor = "rgba(37, 99, 235, 0.25)";
                    }}
                    title="Use max balance"
                  >
                    MAX
                  </button>
                  <span style={{ pointerEvents: "none" }}>
                    {swapMode === "QIE_TO_QUSDC" ? "QIE" : "QUSDC"}
                  </span>
                </span>
              </div>
              
              <button
                type="button"
                onClick={() => setSwapMode(prev => prev === "QIE_TO_QUSDC" ? "QUSDC_TO_QIE" : "QIE_TO_QUSDC")}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#111111",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "4px",
                  borderRadius: "50%",
                  transition: "background 0.2s"
                }}
                onMouseOver={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
                onMouseOut={(e) => e.currentTarget.style.background = "none"}
                title="Click to switch swap direction"
              >
                <RefreshCw size={14} />
              </button>
              
              <strong style={{ fontSize: "0.85rem", color: "#111111" }}>
                {swapMode === "QIE_TO_QUSDC" ? "QUSDC" : "QIE"}
              </strong>
            </div>

            {parseFloat(swapAmount) > 0 && (
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between", margin: "-2px 0 2px 0", padding: "0 4px" }}>
                <span>Est. Received:</span>
                <strong style={{ color: "#111111" }}>
                  {calculatingSwap ? "Calculating..." : `${parseFloat(expectedOutput).toFixed(4)} ${swapMode === "QIE_TO_QUSDC" ? "QUSDC" : "QIE"}`}
                </strong>
              </div>
            )}

            <button 
              className="btn btn-primary" 
              onClick={() => swapQieForTokens(
                swapMode === "QIE_TO_QUSDC" ? "QIE" : "QUSDC",
                swapMode === "QIE_TO_QUSDC" ? "QUSDC" : "QIE",
                swapAmount
              )}
              disabled={loading || isInsufficientBalance || parseFloat(swapAmount) <= 0}
              style={{ 
                width: "100%",
                justifyContent: "center",
                background: isInsufficientBalance ? "#999999" : undefined,
                borderColor: isInsufficientBalance ? "#999999" : undefined,
                color: isInsufficientBalance ? "#fff" : undefined
              }}
            >
              {isInsufficientBalance 
                ? `Insufficient ${swapMode === "QIE_TO_QUSDC" ? "QIE" : "QUSDC"} Balance` 
                : `Swap ${swapMode === "QIE_TO_QUSDC" ? "QIE ➔ QUSDC" : "QUSDC ➔ QIE"}`}
            </button>
            <div className="upgrade-downtime-warning-box">
              <AlertTriangle size={12} style={{ flexShrink: 0 }} />
              <span>DEX swaps will fail or hang during the QIE network upgrade downtime.</span>
            </div>
          </div>
        </div>

        {/* QIE Pass KYC Gating */}
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: 0 }}>
              QIE Pass Identity
            </h3>
            <span className={`status-indicator ${qiePassVerified ? "status-online" : kycState?.status === "error" ? "status-offline" : kycState?.status !== "idle" ? "status-warning" : "status-offline"}`} />
          </div>
          <div style={{ margin: "8px 0" }}>
            {/* Status text based on KYC state */}
            {qiePassVerified || kycState?.status === "verified" ? (
              <p style={{ color: "#111111", fontSize: "0.85rem", margin: 0, fontWeight: "bold" }}>
                ✓ Verified via QIE Pass
              </p>
            ) : kycState?.status === "creating" ? (
              <p style={{ color: "#777777", fontSize: "0.85rem", margin: 0, fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px" }}>
                <Loader2 size={14} className="tx-spinner" /> Creating verification request…
              </p>
            ) : kycState?.status === "pending_kyc" ? (
              <p style={{ color: "#777777", fontSize: "0.85rem", margin: 0, fontWeight: "bold" }}>
                ⏳ Complete KYC in QIE Wallet
              </p>
            ) : kycState?.status === "pending_consent" ? (
              <p style={{ color: "#777777", fontSize: "0.85rem", margin: 0, fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px" }}>
                <Loader2 size={14} className="tx-spinner" /> Waiting for your consent…
              </p>
            ) : kycState?.status === "claiming" ? (
              <p style={{ color: "#777777", fontSize: "0.85rem", margin: 0, fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px" }}>
                <Loader2 size={14} className="tx-spinner" /> Verifying credentials…
              </p>
            ) : kycState?.status === "error" ? (
              <p style={{ color: "#777777", fontSize: "0.85rem", margin: 0, fontWeight: "bold" }}>
                ✗ {kycState.error || "Verification failed"}
              </p>
            ) : (
              <p style={{ color: "#777777", fontSize: "0.85rem", margin: 0, fontWeight: "bold" }}>
                ⚠ Identity Unverified
              </p>
            )}
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px", margin: 0 }}>
              {kycState?.status === "pending_kyc"
                ? "A KYC tab has opened. Complete verification there, then check status."
                : kycState?.status === "pending_consent"
                ? "Please approve the consent request in your QIE Wallet."
                : "Streams require active QIE Pass DIDs to prevent bot exploits."}
            </p>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {qiePassVerified || kycState?.status === "verified" ? (
              <span style={{ fontSize: "0.75rem", color: "#111111", display: "flex", alignItems: "center", gap: "4px" }}>
                <ShieldCheck size={14} /> KYC Active
              </span>
            ) : kycState?.status === "pending_kyc" ? (
              <>
                <a
                  href={kycState.redirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  style={{ fontSize: "0.75rem", padding: "6px 12px", display: "flex", alignItems: "center", gap: "4px", textDecoration: "none" }}
                >
                  <ExternalLink size={12} /> Open KYC Page
                </a>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: "0.75rem", padding: "6px 12px" }}
                  onClick={checkKycStatus}
                >
                  Check Status
                </button>
              </>
            ) : kycState?.status === "pending_consent" || kycState?.status === "claiming" || kycState?.status === "creating" ? (
              <button
                className="btn btn-secondary"
                style={{ fontSize: "0.75rem", padding: "6px 12px", display: "flex", alignItems: "center", gap: "4px" }}
                disabled
              >
                <Loader2 size={12} className="tx-spinner" /> Processing…
              </button>
            ) : (
              <button 
                className="btn btn-primary"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={toggleQiePassStatus}
                disabled={loading}
              >
                Verify with QIE Pass
              </button>
            )}
          </div>
        </div>

        {/* Stream Approvals Gating */}
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: "0 0 8px 0" }}>
            Payment Approvals
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
              <span>QUSDC Registry:</span>
              <strong style={{ color: isAllowanceApproved("QUSDC") ? "#111111" : "#999999" }}>
                {isAllowanceApproved("QUSDC") ? "Approved" : "None"}
              </strong>
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button 
              className="btn btn-secondary" 
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => approveToken("QUSDC")}
              disabled={loading || isAllowanceApproved("QUSDC")}
            >
              Approve QUSDC
            </button>
          </div>
        </div>
      </div>

      {/* 2. Interactive SVG Cash Flow velocity visual */}
      <div className="glass-card" style={{ padding: "16px 20px" }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem", color: "#111111" }}>Real-Time Stream Velocity Matrix</h3>
        <p style={{ margin: "0 0 16px 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>
          Current hourly spend velocity: <strong style={{ color: "#111111" }}>{totalUSDCActiveOutflow.toFixed(2)} QUSDC/hr</strong>
        </p>
        <div style={{ height: "100px", position: "relative", background: "rgba(0,0,0,0.15)", borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.02)" }}>
          <svg viewBox="0 0 400 100" style={{ width: "100%", height: "100px" }} preserveAspectRatio="none">
            <defs>
              <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#079AB7" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#079AB7" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path 
              d={`M 0 90 Q 100 ${totalUSDCActiveOutflow > 0 ? 30 : 90} 200 ${totalUSDCActiveOutflow > 0 ? 10 : 90} T 400 ${totalUSDCActiveOutflow > 0 ? 20 : 90}`} 
              fill="none" 
              stroke="#079AB7" 
              strokeWidth="3" 
            />
            <path 
              d={`M 0 90 Q 100 ${totalUSDCActiveOutflow > 0 ? 30 : 90} 200 ${totalUSDCActiveOutflow > 0 ? 10 : 90} T 400 ${totalUSDCActiveOutflow > 0 ? 20 : 90} L 400 100 L 0 100 Z`} 
              fill="url(#chartGlow)" 
            />
            <line x1="0" y1="90" x2="400" y2="90" stroke="rgba(255,255,255,0.05)" strokeDasharray="4" />
          </svg>
          {totalUSDCActiveOutflow > 0 && <div className="streaming-active-glow" style={{ position: "absolute", top: "10px", right: "10px", width: "8px", height: "8px", borderRadius: "50%", background: "#079AB7" }} />}
        </div>
      </div>

      {/* 3. Setup Subscription Stream Form */}
      <div className="glass-card">
        <h3 style={{ marginBottom: "14px", fontSize: "1.1rem", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "8px" }}>
          Initialize Subscription Stream (NFT Gated)
        </h3>

        {/* Input Mode Selector */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
          <button 
            type="button"
            className={`btn ${inputMode === "rate" ? "btn-primary" : "btn-secondary"}`}
            style={{ 
              padding: "6px 14px", 
              fontSize: "0.75rem", 
              borderRadius: "8px",
              cursor: "pointer"
            }}
            onClick={() => setInputMode("rate")}
          >
            Define by Flow Rate
          </button>
          <button 
            type="button"
            className={`btn ${inputMode === "total" ? "btn-primary" : "btn-secondary"}`}
            style={{ 
              padding: "6px 14px", 
              fontSize: "0.75rem", 
              borderRadius: "8px",
              cursor: "pointer"
            }}
            onClick={() => setInputMode("total")}
          >
            Define by Total Budget
          </button>
        </div>
        
        <form onSubmit={handleSubmitSubscription} className="subscriber-form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "flex-end" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", margin: 0 }}>
                Merchant (Address or .qie domain)
              </label>
              
              {/* Verification status badge */}
              {merchant && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {resolvingDomain ? (
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                      <Loader2 size={10} className="animate-spin" /> Check...
                    </span>
                  ) : resolvedAddress ? (
                    <span style={{ 
                      fontSize: "0.65rem", 
                      color: "#15803d", 
                      background: "#dcfce7", 
                      padding: "2px 6px", 
                      borderRadius: "12px", 
                      fontWeight: "700", 
                      display: "flex", 
                      alignItems: "center", 
                      gap: "3px" 
                    }}>
                      <ShieldCheck size={10} /> Valid
                    </span>
                  ) : resolutionError ? (
                    <span style={{ 
                      fontSize: "0.65rem", 
                      color: "#b91c1c", 
                      background: "#fee2e2", 
                      padding: "2px 6px", 
                      borderRadius: "12px", 
                      fontWeight: "700", 
                      display: "flex", 
                      alignItems: "center", 
                      gap: "3px" 
                    }}>
                      <AlertTriangle size={10} /> Invalid
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            <input 
              type="text" 
              placeholder="e.g. netflix.qie or 0x..."
              className="glass-card"
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.85rem" }}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              required
            />

            {/* Subtext showing resolution */}
            {merchant && (
              <div style={{ marginTop: "4px", minHeight: "16px" }}>
                {resolvingDomain ? (
                  <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                    Checking registry...
                  </span>
                ) : resolvedAddress ? (
                  <span style={{ fontSize: "0.65rem", color: "#15803d", display: "flex", alignItems: "center", gap: "4px", fontWeight: "500" }}>
                    ✓ Resolves to: <code style={{ background: "rgba(21, 128, 61, 0.08)", padding: "1px 4px", borderRadius: "3px", fontSize: "0.65rem", fontFamily: "monospace" }}>{resolvedAddress.slice(0, 10)}...{resolvedAddress.slice(-8)}</code>
                  </span>
                ) : resolutionError ? (
                  <span style={{ fontSize: "0.65rem", color: "#b91c1c", display: "flex", alignItems: "center", gap: "4px" }}>
                    ✗ Unregistered .qie domain or invalid address
                  </span>
                ) : null}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Streaming Token
            </label>
            <div style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.85rem", fontWeight: "bold" }}>
              QUSDC (6 Decimals)
            </div>
          </div>
          
          {inputMode === "rate" ? (
            <>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Streaming Rate (Tokens/hr)
                </label>
                <input 
                  type="number" 
                  step="0.0001"
                  placeholder="e.g. 5.0"
                  className="glass-card"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.85rem" }}
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  required
                />
                <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Amount of tokens streamed per hour
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Vesting Cliff (Seconds)
                </label>
                <input 
                  type="number" 
                  placeholder="e.g. 60"
                  className="glass-card"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.85rem" }}
                  value={cliffSeconds}
                  onChange={(e) => setCliffSeconds(e.target.value)}
                />
                <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Optional. Delay before claim starts
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Auto-Stop Duration (Seconds)
                </label>
                <input 
                  type="number" 
                  placeholder="e.g. 3600"
                  className="glass-card"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.85rem" }}
                  value={stopSeconds}
                  onChange={(e) => setStopSeconds(e.target.value)}
                />
                <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Optional. Stream lifetime duration
                </span>
              </div>
            </>
          ) : (
            <>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Total Budget (Tokens)
                </label>
                <input 
                  type="number" 
                  step="0.0001"
                  placeholder="e.g. 100.0"
                  className="glass-card"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.85rem" }}
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  required
                />
                <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Total budget to stream
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Vesting Cliff (Seconds)
                </label>
                <input 
                  type="number" 
                  placeholder="e.g. 60"
                  className="glass-card"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.85rem" }}
                  value={cliffSeconds}
                  onChange={(e) => setCliffSeconds(e.target.value)}
                />
                <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Optional. Delay before claim starts
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
                  Stream Duration
                </label>
                <div style={{ display: "flex", gap: "6px", width: "100%" }}>
                  <input 
                    type="number" 
                    placeholder="e.g. 24"
                    className="glass-card"
                    style={{ flex: 1, minWidth: "50px", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.85rem" }}
                    value={durationValue}
                    onChange={(e) => setDurationValue(e.target.value)}
                    required
                  />
                  <select
                    className="glass-card"
                    style={{ width: "90px", padding: "8px", borderRadius: "6px", background: "#f0f0f0", border: "1px solid rgba(255,255,255,0.1)", color: "#111111", fontSize: "0.8rem", outline: "none", cursor: "pointer" }}
                    value={durationUnit}
                    onChange={(e) => setDurationUnit(e.target.value)}
                  >
                    <option value="seconds">Seconds</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
                <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "4px" }}>
                  Stream auto-closes after this time
                </span>
              </div>
            </>
          )}

          <button 
            type="submit" 
            className="btn btn-primary"
            style={{ height: "38px", display: "flex", gap: "4px", justifyContent: "center" }}
            disabled={loading || !qiePassVerified || !isAllowanceApproved(tokenSymbol)}
          >
            <Plus size={14} />
            Stream
          </button>
        </form>
        
        {(!qiePassVerified || !isAllowanceApproved(tokenSymbol)) && (
          <p style={{ color: "#777777", fontSize: "0.75rem", marginTop: "10px", margin: 0 }}>
            ⚠ You must verify KYC (QIE Pass) and approve the selected token to begin streaming.
          </p>
        )}
        <div className="upgrade-downtime-warning-box">
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>
            <strong>QIE Network Upgrade Notice:</strong> Onchain transactions are currently delayed due to the active blockchain infrastructure upgrade. Creating new streams or claiming balances may not execute.
          </span>
        </div>
      </div>

      {/* 4. Subscriber Active Streams Table */}
      <div className="glass-card">
        <h3 style={{ marginBottom: "14px", fontSize: "1.1rem", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "8px" }}>
          Active NFT Subscription Outflows
        </h3>

        {subscriberStreams.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
            No active stream NFTs owned. Initialize your first subscription above.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <th style={{ padding: "10px 6px" }}>Stream NFT ID (TokenId)</th>
                  <th style={{ padding: "10px 6px" }}>Merchant</th>
                  <th style={{ padding: "10px 6px" }}>Rate</th>
                  <th style={{ padding: "10px 6px" }}>Accumulated Outflow</th>
                  <th style={{ padding: "10px 6px" }}>Status</th>
                  <th style={{ padding: "10px 6px", textAlign: "right" }}>Actions / NFT Management</th>
                </tr>
              </thead>
              <tbody>
                {subscriberStreams.map((stream) => {
                  const claimable = realtimeClaimables[stream.id] || 0;
                  const decimals = stream.tokenSymbol === "QUSDC" ? 6 : 18;
                  const displayRate = ((stream.ratePerSecond * 3600) / (10 ** decimals)).toFixed(4);
                  const isPaused = stream.pausedByAI;
                  
                  return (
                    <tr 
                      key={stream.id} 
                      style={{ 
                        borderBottom: "1px solid rgba(255,255,255,0.04)", 
                        fontSize: "0.85rem",
                        background: isPaused ? "rgba(244, 63, 94, 0.02)" : "transparent"
                      }}
                    >
                      <td style={{ padding: "12px 6px", fontFamily: "monospace", color: "var(--text-muted)" }}>
                        {stream.id.substring(0, 8)}...{stream.id.substring(stream.id.length - 8)}
                      </td>
                      <td style={{ padding: "12px 6px", fontFamily: "monospace" }}>
                        {formatAddress(stream.merchant)}
                      </td>
                      <td style={{ padding: "12px 6px" }}>
                        {displayRate} {stream.tokenSymbol}/hr
                      </td>
                      <td 
                        className={stream.active && !isPaused && stream.disputeState === 0 ? "streaming-active-glow" : ""}
                        style={{ 
                          padding: "12px 6px", 
                          fontFamily: "monospace", 
                          fontWeight: "bold",
                          color: isPaused ? "#999999" : "#ffffff"
                        }}
                      >
                        {stream.active ? (
                          <span>{claimable.toFixed(5)} {stream.tokenSymbol}</span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>Terminated</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 6px" }}>
                        {!stream.active ? (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Inactive</span>
                        ) : stream.disputeState === 1 ? (
                          <span style={{ color: "#777777", fontSize: "0.75rem", fontWeight: "bold" }}>
                            ⚠️ DISPUTED
                          </span>
                        ) : stream.disputeState === 2 ? (
                          <span style={{ color: "#111111", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", fontWeight: "bold" }}>
                            <ShieldCheck size={12} />
                            Dispute Resolved
                          </span>
                        ) : isPaused ? (
                          <span style={{ color: "#777777", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", fontWeight: "bold" }}>
                            <ShieldAlert size={12} className="pulse" />
                            PAUSED BY AI
                          </span>
                        ) : (
                          <span style={{ color: "#111111", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem" }}>
                            <ShieldCheck size={12} />
                            Shield Active
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "12px 6px", textAlign: "right" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end" }}>
                          
                          {/* Basic Stream control */}
                          <div style={{ display: "flex", gap: "6px" }}>
                            {stream.active && isPaused && stream.disputeState === 0 && (
                              <button 
                                className="btn btn-primary"
                                style={{ padding: "4px 8px", fontSize: "0.7rem", background: "linear-gradient(135deg, #10b981 0%, #059669 100%)" }}
                                onClick={() => resumeStream(stream.id)}
                                disabled={loading || !qiePassVerified}
                              >
                                <Play size={10} />
                                Resume
                              </button>
                            )}

                            {stream.active && stream.disputeState === 0 && (
                              <button 
                                className="btn btn-secondary"
                                style={{ padding: "4px 8px", fontSize: "0.7rem", color: "#777777", borderColor: "#d0d0d0" }}
                                onClick={() => openDispute(stream.id)}
                                disabled={loading}
                              >
                                <Scale size={10} />
                                Dispute
                              </button>
                            )}
                            
                            {stream.active && (
                              <button 
                                className="btn btn-danger"
                                style={{ padding: "4px 8px", fontSize: "0.7rem" }}
                                onClick={() => terminateStream(stream.id)}
                                disabled={loading}
                              >
                                <Trash2 size={10} />
                                Terminate
                              </button>
                            )}
                          </div>

                          {stream.active && stream.disputeState === 2 && (
                            <span style={{ fontSize: "0.7rem", color: "#111111", display: "flex", alignItems: "center", gap: "2px", marginTop: "2px" }}>
                              <ShieldCheck size={10} /> Arbitrated by AI
                            </span>
                          )}

                          {/* NFT Transfer Sub-section */}
                          {stream.active && (
                            <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                              <input 
                                type="text"
                                placeholder="Recipient address or .qie"
                                className="glass-card"
                                style={{ padding: "4px 8px", fontSize: "0.7rem", width: "120px", maxWidth: "100%", color: "#111111", background: "rgba(0,0,0,0.04)", border: "1px solid #e0e0e0", boxSizing: "border-box" }}
                                value={transferTarget[stream.id] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setTransferTarget(prev => ({ ...prev, [stream.id]: val }));
                                }}
                              />
                              <button 
                                className="btn btn-secondary"
                                style={{ padding: "4px 8px", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: "2px" }}
                                onClick={() => {
                                  transferStreamNFT(stream.id, transferTarget[stream.id]);
                                  setTransferTarget(prev => ({ ...prev, [stream.id]: "" }));
                                }}
                                disabled={loading || !transferTarget[stream.id]}
                              >
                                <Send size={8} /> Transfer NFT
                              </button>
                            </div>
                          )}

                          {/* Option A: Dispute handling interface */}
                          {stream.active && stream.disputeState === 1 && (
                            <div style={{ background: "#f8f8f8", border: "1px solid rgba(255,160,0,0.1)", padding: "8px", borderRadius: "6px", marginTop: "4px", width: "100%", maxWidth: "240px", textAlign: "left", boxSizing: "border-box" }}>
                              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "4px" }}>Dispute Resolution Desk</div>
                              <input 
                                type="text"
                                placeholder="Submit evidence (e.g. Downtime)"
                                className="glass-card"
                                style={{ padding: "4px 6px", fontSize: "0.7rem", width: "100%", color: "#111111", background: "rgba(0,0,0,0.04)", border: "1px solid #e0e0e0", marginBottom: "6px" }}
                                value={disputeEvidence[stream.id] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setDisputeEvidence(prev => ({ ...prev, [stream.id]: val }));
                                }}
                              />
                              <div style={{ display: "flex", gap: "4px" }}>
                                <button 
                                  className="btn btn-secondary" 
                                  style={{ padding: "4px 6px", fontSize: "0.65rem", flex: 1 }}
                                  onClick={() => requestArbitration(stream.id, stream)}
                                >
                                  Get AI Split
                                </button>
                                {arbitrationDetails[stream.id] && (
                                  <button 
                                    className="btn btn-primary" 
                                    style={{ padding: "4px 6px", fontSize: "0.65rem", flex: 1, background: "#ff9100" }}
                                    onClick={() => executeArbitration(stream.id)}
                                  >
                                    Execute Split
                                  </button>
                                )}
                              </div>
                              {arbitrationDetails[stream.id] && (
                                <div style={{ fontSize: "0.65rem", color: "#111111", marginTop: "4px", lineHeight: "1.2" }}>
                                  decision: {arbitrationDetails[stream.id].decision}
                                </div>
                              )}
                            </div>
                          )}

                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
