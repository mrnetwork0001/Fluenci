import React, { useState } from "react";
import { Plus, ToggleLeft, ToggleRight, Play, AlertTriangle, Trash2, ShieldAlert, Sparkles, Coins } from "lucide-react";

export default function SubscriberPanel({
  account,
  qusdBalance,
  qusdAllowance,
  qiePassVerified,
  subscriberStreams,
  realtimeClaimables,
  loading,
  mintMockQUSD,
  approveQUSD,
  toggleQiePassStatus,
  createSubscription,
  resumeStream,
  terminateStream
}) {
  const [merchant, setMerchant] = useState("");
  const [rate, setRate] = useState(""); // in qUSD per hour
  const [mintAmount, setMintAmount] = useState("100");

  const handleSubmitSubscription = (e) => {
    e.preventDefault();
    if (!merchant || !rate) return;
    
    // Scale rate: e.g. user inputs qUSD per hour.
    // 1 hour = 3600 seconds.
    // ratePerSecond = (rate * 1e6) / 3600.
    const rateVal = parseFloat(rate);
    const ratePerSecond = Math.floor((rateVal * 1000000) / 3600);
    
    if (ratePerSecond <= 0) {
      alert("Rate must be greater than zero");
      return;
    }

    createSubscription(merchant, ratePerSecond);
    setMerchant("");
    setRate("");
  };

  const isAllowanceApproved = parseFloat(qusdAllowance) > 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
      
      {/* 1. Subscriber Credentials Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
        
        {/* Wallet & Stablecoin balance */}
        <div className="glass-card" style={{ position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "1.1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Coins size={18} color="var(--color-cyan)" />
              qUSD Balance
            </h3>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Token Settlement</span>
          </div>
          <div style={{ fontSize: "2.2rem", fontWeight: "bold", fontFamily: "var(--font-title)", marginBottom: "16px", color: "#fff" }}>
            {parseFloat(qusdBalance).toFixed(2)} <span style={{ fontSize: "1.2rem", color: "var(--color-cyan)" }}>qUSD</span>
          </div>
          
          <div style={{ display: "flex", gap: "10px" }}>
            <input 
              type="number"
              className="glass-card"
              style={{ 
                padding: "8px 12px", 
                width: "80px", 
                borderRadius: "8px", 
                background: "rgba(255,255,255,0.02)", 
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#fff"
              }}
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
            />
            <button 
              className="btn btn-secondary" 
              onClick={() => mintMockQUSD(mintAmount)}
              disabled={loading}
              style={{ fontSize: "0.85rem", padding: "8px 16px" }}
            >
              Mint test qUSD
            </button>
          </div>
        </div>

        {/* QIE Pass Gating Credentials */}
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "1.1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={18} color="var(--color-purple)" />
              QIE Pass Identity
            </h3>
            <span 
              className={`status-indicator ${qiePassVerified ? "status-online" : "status-offline"}`} 
              style={{ width: "10px", height: "10px" }}
            />
          </div>
          
          <div style={{ marginBottom: "16px" }}>
            {qiePassVerified ? (
              <p style={{ color: "var(--color-emerald)", fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "6px" }}>
                ✓ Verified DID Registry Linked
              </p>
            ) : (
              <p style={{ color: "var(--color-rose)", fontSize: "0.95rem", display: "flex", alignItems: "center", gap: "6px" }}>
                ⚠ Identity Unverified (DID Missing)
              </p>
            )}
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "6px" }}>
              Subscriptions and safety resume triggers require a verified QIE Pass DID.
            </p>
          </div>

          <button 
            className={`btn ${qiePassVerified ? "btn-danger" : "btn-primary"}`}
            style={{ 
              alignSelf: "flex-start", 
              fontSize: "0.85rem", 
              padding: "8px 16px",
              boxShadow: qiePassVerified ? "none" : "var(--shadow-neon)"
            }}
            onClick={() => toggleQiePassStatus(!qiePassVerified)}
            disabled={loading}
          >
            {qiePassVerified ? "Revoke QIE Pass" : "Verify QIE Pass"}
          </button>
        </div>

        {/* Stablecoin Allowance Gating */}
        <div className="glass-card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <h3 style={{ fontSize: "1.1rem", color: "var(--text-secondary)", marginBottom: "12px" }}>
              Payment Authority
            </h3>
            <div style={{ fontSize: "1.1rem", fontWeight: "bold", marginBottom: "6px" }}>
              Status: {isAllowanceApproved ? (
                <span style={{ color: "var(--color-emerald)" }}>Approved</span>
              ) : (
                <span style={{ color: "var(--color-rose)" }}>Required</span>
              )}
            </div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Authorize the QieFlow Registry to stream tokens on your behalf.
            </p>
          </div>

          <button 
            className="btn btn-secondary" 
            style={{ 
              alignSelf: "flex-start", 
              marginTop: "16px",
              borderColor: isAllowanceApproved ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)",
              background: isAllowanceApproved ? "rgba(16, 185, 129, 0.05)" : "rgba(245, 158, 11, 0.05)",
              color: isAllowanceApproved ? "var(--color-emerald)" : "var(--color-amber)",
              fontSize: "0.85rem"
            }}
            onClick={approveQUSD}
            disabled={loading || isAllowanceApproved}
          >
            {isAllowanceApproved ? "Registry Approved" : "Approve Registry"}
          </button>
        </div>
      </div>

      {/* 2. Setup Subscription Stream Form */}
      <div className="glass-card">
        <h3 style={{ marginBottom: "18px", fontSize: "1.2rem", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "12px" }}>
          Initialize Subscription Stream
        </h3>
        
        <form onSubmit={handleSubmitSubscription} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "16px", alignItems: "flex-end" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "8px" }}>
              Merchant Address
            </label>
            <input 
              type="text" 
              placeholder="0xMerchantAddress..."
              className="glass-card"
              style={{ 
                width: "100%", 
                padding: "10px 14px", 
                borderRadius: "8px", 
                background: "rgba(255,255,255,0.02)", 
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#fff",
                fontFamily: "monospace"
              }}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              required
            />
          </div>
          
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "8px" }}>
              Streaming Rate (qUSD per hour)
            </label>
            <input 
              type="number" 
              step="0.01"
              placeholder="e.g. 5.0"
              className="glass-card"
              style={{ 
                width: "100%", 
                padding: "10px 14px", 
                borderRadius: "8px", 
                background: "rgba(255,255,255,0.02)", 
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#fff"
              }}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
            />
          </div>

          <button 
            type="submit" 
            className="btn btn-primary"
            style={{ height: "42px" }}
            disabled={loading || !qiePassVerified || !isAllowanceApproved}
          >
            <Plus size={16} />
            Start Stream
          </button>
        </form>
        
        {(!qiePassVerified || !isAllowanceApproved) && (
          <p style={{ color: "var(--color-amber)", fontSize: "0.8rem", marginTop: "10px" }}>
            ⚠ You must verify your QIE Pass and approve stablecoin allowance to start subscription streams.
          </p>
        )}
      </div>

      {/* 3. Subscriber Active Streams Table */}
      <div className="glass-card">
        <h3 style={{ marginBottom: "18px", fontSize: "1.2rem", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "12px" }}>
          Active Subscription Streams
        </h3>

        {subscriberStreams.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
            No active subscriptions created. Start a stream using the form above.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  <th style={{ padding: "12px 8px" }}>Subscription ID</th>
                  <th style={{ padding: "12px 8px" }}>Merchant</th>
                  <th style={{ padding: "12px 8px" }}>Streaming Rate</th>
                  <th style={{ padding: "12px 8px" }}>Accumulated Flow</th>
                  <th style={{ padding: "12px 8px" }}>Security status</th>
                  <th style={{ padding: "12px 8px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriberStreams.map((stream) => {
                  const claimable = realtimeClaimables[stream.id] || 0;
                  const displayRate = ((stream.ratePerSecond * 3600) / 1000000).toFixed(2);
                  const isPaused = stream.pausedByAI;
                  
                  return (
                    <tr 
                      key={stream.id} 
                      style={{ 
                        borderBottom: "1px solid rgba(255,255,255,0.04)", 
                        fontSize: "0.9rem",
                        background: isPaused ? "rgba(244, 63, 94, 0.02)" : "transparent"
                      }}
                    >
                      <td style={{ padding: "16px 8px", fontFamily: "monospace", color: "var(--text-muted)" }}>
                        {stream.id.substring(0, 8)}...{stream.id.substring(stream.id.length - 8)}
                      </td>
                      <td style={{ padding: "16px 8px", fontFamily: "monospace" }}>
                        {stream.merchant.substring(0, 6)}...{stream.merchant.substring(stream.merchant.length - 4)}
                      </td>
                      <td style={{ padding: "16px 8px" }}>
                        {displayRate} qUSD/hr
                      </td>
                      <td 
                        className={stream.active && !isPaused ? "streaming-active-glow" : ""}
                        style={{ 
                          padding: "16px 8px", 
                          fontFamily: "monospace", 
                          fontWeight: "bold",
                          color: isPaused ? "var(--color-rose)" : "var(--color-cyan)"
                        }}
                      >
                        {stream.active ? (
                          <span>{claimable.toFixed(5)} qUSD</span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>Terminated</span>
                        )}
                      </td>
                      <td style={{ padding: "16px 8px" }}>
                        {!stream.active ? (
                          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Inactive</span>
                        ) : isPaused ? (
                          <span style={{ color: "var(--color-rose)", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", fontWeight: "bold" }}>
                            <ShieldAlert size={14} className="pulse" />
                            PAUSED BY AI
                          </span>
                        ) : (
                          <span style={{ color: "var(--color-emerald)", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem" }}>
                            <span className="status-indicator status-online" />
                            Shield Active
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "16px 8px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                          {stream.active && isPaused && (
                            <button 
                              className="btn btn-primary"
                              style={{ 
                                padding: "6px 12px", 
                                fontSize: "0.75rem", 
                                background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                                boxShadow: "none"
                              }}
                              onClick={() => resumeStream(stream.id)}
                              disabled={loading || !qiePassVerified}
                            >
                              <Play size={12} />
                              Resolve & Resume
                            </button>
                          )}
                          
                          {stream.active && (
                            <button 
                              className="btn btn-danger"
                              style={{ padding: "6px 12px", fontSize: "0.75rem" }}
                              onClick={() => terminateStream(stream.id)}
                              disabled={loading}
                            >
                              <Trash2 size={12} />
                              Cancel
                            </button>
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
