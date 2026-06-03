import React, { useState, useEffect } from "react";
import { Plus, Play, Trash2, AlertTriangle, ShieldAlert, Sparkles, Coins, ArrowRight, ShieldCheck, Scale, RefreshCw, Send } from "lucide-react";

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
  contracts
}) {
  const [merchant, setMerchant] = useState("");
  const [rate, setRate] = useState(""); // rate per hour
  const [tokenSymbol, setTokenSymbol] = useState("qUSDC");
  const [cliffSeconds, setCliffSeconds] = useState("");
  const [stopSeconds, setStopSeconds] = useState("");

  const [swapAmount, setSwapAmount] = useState("1");
  const [swapToken, setSwapToken] = useState("qUSDC");

  // Dispute and Transfer state
  const [transferTarget, setTransferTarget] = useState({});
  const [disputeEvidence, setDisputeEvidence] = useState({});
  const [arbitrationDetails, setArbitrationDetails] = useState({});

  const handleSubmitSubscription = (e) => {
    e.preventDefault();
    if (!merchant || !rate) return;
    
    // Scale rate: rate per hour.
    // ratePerSecond = (rate * 10^decimals) / 3600.
    const rateVal = parseFloat(rate);
    const decimals = tokenSymbol === "qUSDC" ? 6 : 18;
    const ratePerSecond = Math.floor((rateVal * (10 ** decimals)) / 3600);
    
    if (ratePerSecond <= 0) {
      alert("Rate must be greater than zero");
      return;
    }

    createSubscription(
      merchant, 
      tokenSymbol, 
      ratePerSecond.toString(), 
      cliffSeconds ? Number(cliffSeconds) : 0, 
      stopSeconds ? Number(stopSeconds) : 0
    );
    setMerchant("");
    setRate("");
    setCliffSeconds("");
    setStopSeconds("");
  };

  const isAllowanceApproved = (symbol) => {
    return parseFloat(qusdcAllowance) > 0;
  };

  // Request AI arbitration details from off-chain node
  const requestArbitration = async (subId, stream) => {
    try {
      const response = await fetch("http://localhost:5001/arbitrate-dispute", {
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
      alert("Failed to contact AI Arbitrator. Make sure the server is running on port 5001.");
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
    .filter(s => s.active && !s.pausedByAI && s.disputeState === 0 && s.tokenSymbol === "qUSDC")
    .reduce((sum, s) => sum + (s.ratePerSecond * 3600 / 1e6), 0);

  // Formats address or returns domain name if pre-mapped
  const formatAddress = (addr) => {
    if (addr.toLowerCase() === "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".toLowerCase()) return "netflix.qie";
    if (addr.toLowerCase() === "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC".toLowerCase()) return "qiedoodle.qie";
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const isInsufficientQie = !isNaN(parseFloat(swapAmount)) && parseFloat(swapAmount) > parseFloat(qieBalance);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
      
      {/* 1. Subscriber Credentials Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px" }}>
        
        {/* Token balances Card */}
        <div className="glass-card">
          <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px", margin: "0 0 12px 0" }}>
            <Coins size={16} color="var(--color-cyan)" />
            Self-Custody Balances
          </h3>
          <div style={{ display: "grid", gap: "8px" }}>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
              <span>Native QIE:</span>
              <strong style={{ color: "#fff" }}>{parseFloat(qieBalance).toFixed(4)} QIE</strong>
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
              <span>qUSDC stable:</span>
              <strong style={{ color: "var(--color-cyan)" }}>{parseFloat(qusdcBalance).toFixed(2)} qUSDC</strong>
            </div>
          </div>
        </div>

        {/* Option C: Qiedex Swap Card */}
        <div className="glass-card">
          <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px", margin: "0 0 12px 0" }}>
            <Scale size={16} color="var(--color-cyan)" />
            Qiedex Auto-Swap Faucet
          </h3>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 12px 0" }}>
            Instantly swap native QIE to streaming tokens to prevent stream halts.
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
                    color: "#fff", 
                    background: "rgba(0,0,0,0.2)", 
                    border: isInsufficientQie ? "1px solid var(--color-rose)" : "1px solid rgba(255,255,255,0.08)",
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
                  pointerEvents: "none"
                }}>
                  QIE
                </span>
              </div>
              
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>→</span>
              
              <strong style={{ fontSize: "0.85rem", color: "var(--color-cyan)" }}>qUSDC</strong>
            </div>

            <button 
              className="btn btn-primary" 
              onClick={() => swapQieForTokens(swapToken, swapAmount)}
              disabled={loading || isInsufficientQie || parseFloat(swapAmount) <= 0}
              style={{ 
                fontSize: "0.8rem", 
                padding: "8px 16px",
                width: "100%",
                background: isInsufficientQie ? "var(--color-rose)" : undefined,
                borderColor: isInsufficientQie ? "var(--color-rose)" : undefined,
                color: isInsufficientQie ? "#fff" : undefined,
                borderRadius: "6px"
              }}
            >
              {isInsufficientQie ? "Insufficient QIE Balance" : "Swap QIE"}
            </button>
          </div>
        </div>

        {/* QIE Pass KYC Gating */}
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
              <Sparkles size={16} color="var(--color-purple)" />
              QIE Pass Identity
            </h3>
            <span className={`status-indicator ${qiePassVerified ? "status-online" : "status-offline"}`} />
          </div>
          <div style={{ margin: "8px 0" }}>
            <p style={{ color: qiePassVerified ? "var(--color-emerald)" : "var(--color-rose)", fontSize: "0.85rem", margin: 0, fontWeight: "bold" }}>
              {qiePassVerified ? "✓ Verified KYC Linked" : "⚠ Identity Unverified"}
            </p>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "4px", margin: 0 }}>
              Streams require active QIE Pass DIDs to prevent bot exploits.
            </p>
          </div>
          <button 
            className={`btn ${qiePassVerified ? "btn-danger" : "btn-primary"}`}
            style={{ fontSize: "0.75rem", padding: "6px 12px", alignSelf: "flex-start" }}
            onClick={() => toggleQiePassStatus(!qiePassVerified)}
            disabled={loading}
          >
            {qiePassVerified ? "Revoke DID" : "Verify KYC"}
          </button>
        </div>

        {/* Stream Approvals Gating */}
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: "0 0 8px 0" }}>
            Payment Approvals
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
              <span>qUSDC Registry:</span>
              <strong style={{ color: isAllowanceApproved("qUSDC") ? "var(--color-emerald)" : "var(--color-rose)" }}>
                {isAllowanceApproved("qUSDC") ? "Approved" : "None"}
              </strong>
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button 
              className="btn btn-secondary" 
              style={{ fontSize: "0.75rem", padding: "6px 10px", width: "100%" }}
              onClick={() => approveToken("qUSDC")}
              disabled={loading || isAllowanceApproved("qUSDC")}
            >
              Approve qUSDC
            </button>
          </div>
        </div>
      </div>

      {/* 2. Interactive SVG Cash Flow velocity visual */}
      <div className="glass-card" style={{ padding: "16px 20px" }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem", color: "#fff" }}>Real-Time Stream Velocity Matrix</h3>
        <p style={{ margin: "0 0 16px 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>
          Current hourly spend velocity: <strong style={{ color: "var(--color-cyan)" }}>{totalUSDCActiveOutflow.toFixed(2)} qUSDC/hr</strong>
        </p>
        <div style={{ height: "100px", position: "relative", background: "rgba(0,0,0,0.15)", borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.02)" }}>
          <svg viewBox="0 0 400 100" style={{ width: "100%", height: "100px" }} preserveAspectRatio="none">
            <defs>
              <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-cyan)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="var(--color-cyan)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path 
              d={`M 0 90 Q 100 ${totalUSDCActiveOutflow > 0 ? 30 : 90} 200 ${totalUSDCActiveOutflow > 0 ? 10 : 90} T 400 ${totalUSDCActiveOutflow > 0 ? 20 : 90}`} 
              fill="none" 
              stroke="var(--color-cyan)" 
              strokeWidth="3" 
            />
            <path 
              d={`M 0 90 Q 100 ${totalUSDCActiveOutflow > 0 ? 30 : 90} 200 ${totalUSDCActiveOutflow > 0 ? 10 : 90} T 400 ${totalUSDCActiveOutflow > 0 ? 20 : 90} L 400 100 L 0 100 Z`} 
              fill="url(#chartGlow)" 
            />
            <line x1="0" y1="90" x2="400" y2="90" stroke="rgba(255,255,255,0.05)" strokeDasharray="4" />
          </svg>
          {totalUSDCActiveOutflow > 0 && <div className="streaming-active-glow" style={{ position: "absolute", top: "10px", right: "10px", width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-cyan)" }} />}
        </div>
      </div>

      {/* 3. Setup Subscription Stream Form */}
      <div className="glass-card">
        <h3 style={{ marginBottom: "14px", fontSize: "1.1rem", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "8px" }}>
          Initialize Subscription Stream (NFT Gated)
        </h3>
        
        <form onSubmit={handleSubmitSubscription} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Merchant (Address or .qie domain)
            </label>
            <input 
              type="text" 
              placeholder="e.g. netflix.qie or 0x..."
              className="glass-card"
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "0.85rem" }}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Streaming Token
            </label>
            <div style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--color-cyan)", fontSize: "0.85rem", fontWeight: "bold" }}>
              qUSDC (6 Decimals)
            </div>
          </div>
          
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Rate (Tokens per hour)
            </label>
            <input 
              type="number" 
              step="0.0001"
              placeholder="e.g. 5.0"
              className="glass-card"
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "0.85rem" }}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Optional Cliff (Seconds)
            </label>
            <input 
              type="number" 
              placeholder="e.g. 60"
              className="glass-card"
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "0.85rem" }}
              value={cliffSeconds}
              onChange={(e) => setCliffSeconds(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "6px" }}>
              Optional Stop (Seconds)
            </label>
            <input 
              type="number" 
              placeholder="e.g. 3600"
              className="glass-card"
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", fontSize: "0.85rem" }}
              value={stopSeconds}
              onChange={(e) => setStopSeconds(e.target.value)}
            />
          </div>

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
          <p style={{ color: "var(--color-amber)", fontSize: "0.75rem", marginTop: "10px", margin: 0 }}>
            ⚠ You must verify KYC (QIE Pass) and approve the selected token to begin streaming.
          </p>
        )}
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
                  const decimals = stream.tokenSymbol === "qUSDC" ? 6 : 18;
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
                          color: isPaused ? "var(--color-rose)" : "var(--color-cyan)"
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
                          <span style={{ color: "var(--color-amber)", fontSize: "0.75rem", fontWeight: "bold" }}>
                            ⚠️ DISPUTED
                          </span>
                        ) : stream.disputeState === 2 ? (
                          <span style={{ color: "var(--color-emerald)", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", fontWeight: "bold" }}>
                            <ShieldCheck size={12} />
                            Dispute Resolved
                          </span>
                        ) : isPaused ? (
                          <span style={{ color: "var(--color-rose)", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", fontWeight: "bold" }}>
                            <ShieldAlert size={12} className="pulse" />
                            PAUSED BY AI
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-emerald)", display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem" }}>
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
                                style={{ padding: "4px 8px", fontSize: "0.7rem", color: "var(--color-amber)", borderColor: "rgba(245, 158, 11, 0.2)" }}
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
                            <span style={{ fontSize: "0.7rem", color: "var(--color-emerald)", display: "flex", alignItems: "center", gap: "2px", marginTop: "2px" }}>
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
                                style={{ padding: "4px 8px", fontSize: "0.7rem", width: "120px", color: "#fff", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.08)" }}
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
                            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,160,0,0.1)", padding: "8px", borderRadius: "6px", marginTop: "4px", width: "240px", textAlign: "left" }}>
                              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "4px" }}>Dispute Resolution Desk</div>
                              <input 
                                type="text"
                                placeholder="Submit evidence (e.g. Downtime)"
                                className="glass-card"
                                style={{ padding: "4px 6px", fontSize: "0.7rem", width: "100%", color: "#fff", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.08)", marginBottom: "6px" }}
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
                                <div style={{ fontSize: "0.65rem", color: "#00e676", marginTop: "4px", lineHeight: "1.2" }}>
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
