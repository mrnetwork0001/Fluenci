import React from "react";
import { Download, AlertTriangle, Play, HelpCircle, ArrowDownRight, Clock, Coins, ShieldCheck } from "lucide-react";

export default function MerchantDashboard({
  account,
  qieBalance,
  qusdcBalance,
  merchantStreams,
  realtimeClaimables,
  loading,
  claimStream
}) {
  // Calculate total active incoming rate for USDC
  const totalUSDCIncoming = merchantStreams
    .filter(s => s.active && !s.pausedByAI && s.disputeState === 0 && s.tokenSymbol === "qUSDC")
    .reduce((sum, s) => sum + (s.ratePerSecond * 3600 / 1e6), 0);

  const totalUSDCPending = merchantStreams
    .filter(s => s.active && s.tokenSymbol === "qUSDC")
    .reduce((sum, s) => sum + (realtimeClaimables[s.id] || 0), 0);

  // Formats addresses to domain name overrides if matched
  const formatAddress = (addr) => {
    if (addr.toLowerCase() === "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".toLowerCase()) return "bob.qie";
    if (addr.toLowerCase() === "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".toLowerCase()) return "netflix.qie";
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
      
      {/* 1. Merchant Stats Overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "20px" }}>
        
        {/* Wallet Balances */}
        <div className="glass-card">
          <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: "8px" }}>
            <Coins size={16} color="#ffffff" />
            Merchant Balances
          </h3>
          <div style={{ display: "grid", gap: "6px" }}>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
              <span>QIE:</span>
              <strong style={{ color: "#fff" }}>{parseFloat(qieBalance).toFixed(4)} QIE</strong>
            </div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
              <span>qUSDC:</span>
              <strong style={{ color: "#ffffff" }}>{parseFloat(qusdcBalance).toFixed(2)} qUSDC</strong>
            </div>
          </div>
        </div>

        {/* Incoming flow rates */}
        <div className="glass-card" style={{ borderLeft: "4px solid #ffffff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
              <ArrowDownRight size={16} color="#ffffff" />
              Revenue Outflow
            </h3>
            <span style={{ fontSize: "0.75rem", color: "#ffffff", fontWeight: "bold" }}>+Live Outflows</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#ffffff" }}>
              {totalUSDCIncoming.toFixed(2)} <span style={{ fontSize: "0.85rem" }}>qUSDC/hr</span>
            </div>
          </div>
        </div>

        {/* Accumulated Pending Claims */}
        <div className="glass-card" style={{ borderLeft: "4px solid #888888" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h3 style={{ fontSize: "1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "6px", margin: 0 }}>
              <Clock size={16} color="#888888" />
              Pending Settlement
            </h3>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Claimable</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "1.2rem", fontWeight: "bold", color: "#ffffff" }} className="streaming-active-glow">
              {totalUSDCPending.toFixed(4)} <span style={{ fontSize: "0.85rem" }}>qUSDC</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. SVG Revenue Analytics Chart */}
      <div className="glass-card" style={{ padding: "16px 20px" }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "1rem", color: "#fff" }}>Projected Revenue Velocity Estimate</h3>
        <div style={{ height: "100px", position: "relative", background: "rgba(0,0,0,0.15)", borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.02)" }}>
          <svg viewBox="0 0 400 100" style={{ width: "100%", height: "100px" }} preserveAspectRatio="none">
            <defs>
              <linearGradient id="merchantGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.3" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path 
              d={`M 0 90 Q 100 ${totalUSDCIncoming > 0 ? 40 : 90} 200 ${totalUSDCIncoming > 0 ? 20 : 90} T 400 ${totalUSDCIncoming > 0 ? 10 : 90}`} 
              fill="none" 
              stroke="#ffffff" 
              strokeWidth="3" 
            />
            <path 
              d={`M 0 90 Q 100 ${totalUSDCIncoming > 0 ? 40 : 90} 200 ${totalUSDCIncoming > 0 ? 20 : 90} T 400 ${totalUSDCIncoming > 0 ? 10 : 90} L 400 100 L 0 100 Z`} 
              fill="url(#merchantGlow)" 
            />
            <line x1="0" y1="90" x2="400" y2="90" stroke="rgba(255,255,255,0.05)" strokeDasharray="4" />
          </svg>
        </div>
      </div>

      {/* 3. Inbound Streams Table */}
      <div className="glass-card">
        <h3 style={{ marginBottom: "14px", fontSize: "1.1rem", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "8px" }}>
          Inbound Subscriber Stream NFTs
        </h3>

        {merchantStreams.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
            No incoming subscriber stream NFTs mapped to this address.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <th style={{ padding: "10px 6px" }}>Stream NFT ID</th>
                  <th style={{ padding: "10px 6px" }}>Subscriber</th>
                  <th style={{ padding: "10px 6px" }}>Pricing Rate</th>
                  <th style={{ padding: "10px 6px" }}>Accumulated Claim</th>
                  <th style={{ padding: "10px 6px" }}>Security State</th>
                  <th style={{ padding: "10px 6px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {merchantStreams.map((stream) => {
                  const claimable = realtimeClaimables[stream.id] || 0;
                  const decimals = stream.tokenSymbol === "qUSDC" ? 6 : 18;
                  const displayRate = ((stream.ratePerSecond * 3600) / (10 ** decimals)).toFixed(4);
                  const isPaused = stream.pausedByAI;
                  const isDisputed = stream.disputeState === 1;
                  
                  return (
                    <tr 
                      key={stream.id} 
                      style={{ 
                        borderBottom: "1px solid rgba(255,255,255,0.04)", 
                        fontSize: "0.85rem",
                        background: isDisputed ? "rgba(245, 158, 11, 0.02)" : isPaused ? "rgba(244, 63, 94, 0.01)" : "transparent"
                      }}
                    >
                      <td style={{ padding: "12px 6px", fontFamily: "monospace", color: "var(--text-muted)" }}>
                        {stream.id.substring(0, 8)}...{stream.id.substring(stream.id.length - 8)}
                      </td>
                      <td style={{ padding: "12px 6px", fontFamily: "monospace" }}>
                        {formatAddress(stream.subscriber)}
                      </td>
                      <td style={{ padding: "12px 6px" }}>
                        {displayRate} {stream.tokenSymbol}/hr
                      </td>
                      <td 
                        className={stream.active && !isPaused && !isDisputed ? "streaming-active-glow" : ""}
                        style={{ 
                          padding: "12px 6px", 
                          fontFamily: "monospace", 
                          fontWeight: "bold",
                          color: isDisputed ? "#999999" : isPaused ? "#999999" : "#ffffff"
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
                          <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>Terminated</span>
                        ) : isDisputed ? (
                          <span style={{ color: "#999999", background: "rgba(245, 158, 11, 0.1)", padding: "4px 8px", borderRadius: "4px", fontSize: "0.75rem", fontWeight: "bold" }}>
                            ⚠️ DISPUTED
                          </span>
                        ) : stream.disputeState === 2 ? (
                          <span style={{ color: "#ffffff", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", background: "rgba(16, 185, 129, 0.15)", padding: "4px 8px", borderRadius: "4px", fontWeight: "bold" }}>
                            <ShieldCheck size={12} />
                            Dispute Resolved
                          </span>
                        ) : isPaused ? (
                          <span style={{ color: "#999999", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", fontWeight: "bold", background: "rgba(244, 63, 94, 0.1)", padding: "4px 8px", borderRadius: "4px" }}>
                            <AlertTriangle size={12} className="pulse" />
                            AI Paused
                          </span>
                        ) : (
                          <span style={{ color: "#ffffff", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", background: "rgba(16, 185, 129, 0.1)", padding: "4px 8px", borderRadius: "4px" }}>
                            <ShieldCheck size={12} />
                            Active
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "12px 6px", textAlign: "right" }}>
                        {stream.active && (
                          <button 
                            className="btn btn-secondary"
                            style={{ 
                              padding: "6px 12px", 
                              fontSize: "0.75rem",
                              borderColor: (isPaused || isDisputed) ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.08)",
                              color: (isPaused || isDisputed) ? "var(--text-muted)" : "#ffffff",
                              background: (isPaused || isDisputed) ? "transparent" : "rgba(255,255,255,0.08)"
                            }}
                            onClick={() => claimStream(stream.id)}
                            disabled={loading || isPaused || isDisputed || claimable <= 0}
                          >
                            <Download size={12} />
                            Claim Funds
                          </button>
                        )}
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
