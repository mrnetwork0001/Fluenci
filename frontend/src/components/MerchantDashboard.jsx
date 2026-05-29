import React from "react";
import { Download, AlertTriangle, Play, HelpCircle, ArrowDownRight, Clock } from "lucide-react";

export default function MerchantDashboard({
  account,
  qusdBalance,
  merchantStreams,
  realtimeClaimables,
  loading,
  claimStream
}) {
  // Calculate total incoming rate and total claimable
  const totalRatePerHour = merchantStreams
    .filter(s => s.active && !s.pausedByAI)
    .reduce((acc, s) => acc + (s.ratePerSecond * 3600) / 1e6, 0);

  const totalPendingClaim = merchantStreams
    .filter(s => s.active && !s.pausedByAI)
    .reduce((acc, s) => acc + (realtimeClaimables[s.id] || 0), 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
      
      {/* 1. Merchant Stats Overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "20px" }}>
        
        {/* Merchant Wallet Balance */}
        <div className="glass-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "1.1rem", color: "var(--text-secondary)" }}>
              Wallet Balance
            </h3>
            <span className="status-indicator status-online" />
          </div>
          <div style={{ fontSize: "2.2rem", fontWeight: "bold", fontFamily: "var(--font-title)", marginBottom: "6px" }}>
            {parseFloat(qusdBalance).toFixed(2)} <span style={{ fontSize: "1.2rem", color: "var(--color-cyan)" }}>qUSD</span>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Tokens held in your merchant wallet.
          </p>
        </div>

        {/* Incoming Flow Rate */}
        <div className="glass-card" style={{ borderLeft: "4px solid var(--color-cyan)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "1.1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <ArrowDownRight size={18} color="var(--color-cyan)" />
              Revenue Stream
            </h3>
            <span style={{ fontSize: "0.8rem", color: "var(--color-emerald)", fontWeight: "bold" }}>+Live Flow</span>
          </div>
          <div style={{ fontSize: "2.2rem", fontWeight: "bold", fontFamily: "var(--font-title)", marginBottom: "6px" }}>
            {totalRatePerHour.toFixed(2)} <span style={{ fontSize: "1.2rem", color: "var(--color-cyan)" }}>qUSD/hr</span>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Combined flow from all active, unpaused streams.
          </p>
        </div>

        {/* Accumulated Pending Claims */}
        <div className="glass-card" style={{ borderLeft: "4px solid var(--color-purple)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "1.1rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
              <Clock size={18} color="var(--color-purple)" />
              Pending Settlement
            </h3>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Unclaimed</span>
          </div>
          <div 
            className="streaming-active-glow" 
            style={{ fontSize: "2.2rem", fontWeight: "bold", fontFamily: "var(--font-title)", marginBottom: "6px", color: "var(--color-cyan)" }}
          >
            {totalPendingClaim.toFixed(5)} <span style={{ fontSize: "1.2rem" }}>qUSD</span>
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Accumulated stream funds ready to settle on-chain.
          </p>
        </div>
      </div>

      {/* 2. Inbound Streams Table */}
      <div className="glass-card">
        <h3 style={{ marginBottom: "18px", fontSize: "1.2rem", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "12px" }}>
          Inbound Subscriber Streams
        </h3>

        {merchantStreams.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)" }}>
            No active incoming subscription streams.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  <th style={{ padding: "12px 8px" }}>Stream ID</th>
                  <th style={{ padding: "12px 8px" }}>Subscriber</th>
                  <th style={{ padding: "12px 8px" }}>Pricing Rate</th>
                  <th style={{ padding: "12px 8px" }}>Accumulated Funds</th>
                  <th style={{ padding: "12px 8px" }}>Security Gate</th>
                  <th style={{ padding: "12px 8px", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {merchantStreams.map((stream) => {
                  const claimable = realtimeClaimables[stream.id] || 0;
                  const displayRate = ((stream.ratePerSecond * 3600) / 1000000).toFixed(2);
                  const isPaused = stream.pausedByAI;
                  
                  return (
                    <tr 
                      key={stream.id} 
                      style={{ 
                        borderBottom: "1px solid rgba(255,255,255,0.04)", 
                        fontSize: "0.9rem",
                        background: isPaused ? "rgba(244, 63, 94, 0.01)" : "transparent"
                      }}
                    >
                      <td style={{ padding: "16px 8px", fontFamily: "monospace", color: "var(--text-muted)" }}>
                        {stream.id.substring(0, 8)}...{stream.id.substring(stream.id.length - 8)}
                      </td>
                      <td style={{ padding: "16px 8px", fontFamily: "monospace" }}>
                        {stream.subscriber.substring(0, 6)}...{stream.subscriber.substring(stream.subscriber.length - 4)}
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
                          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Terminated</span>
                        ) : isPaused ? (
                          <span 
                            style={{ 
                              color: "var(--color-rose)", 
                              display: "inline-flex", 
                              alignItems: "center", 
                              gap: "6px", 
                              fontSize: "0.8rem", 
                              fontWeight: "bold",
                              background: "rgba(244, 63, 94, 0.1)",
                              padding: "4px 8px",
                              borderRadius: "4px"
                            }}
                          >
                            <AlertTriangle size={12} className="pulse" />
                            AI Paused Anomalous
                          </span>
                        ) : (
                          <span 
                            style={{ 
                              color: "var(--color-emerald)", 
                              display: "inline-flex", 
                              alignItems: "center", 
                              gap: "6px", 
                              fontSize: "0.8rem",
                              background: "rgba(16, 185, 129, 0.1)",
                              padding: "4px 8px",
                              borderRadius: "4px"
                            }}
                          >
                            Shield Verified
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "16px 8px", textAlign: "right" }}>
                        {stream.active && (
                          <button 
                            className="btn btn-secondary"
                            style={{ 
                              padding: "6px 12px", 
                              fontSize: "0.75rem",
                              borderColor: isPaused ? "rgba(244, 63, 94, 0.2)" : "rgba(0, 242, 254, 0.3)",
                              color: isPaused ? "var(--text-muted)" : "var(--color-cyan)",
                              background: isPaused ? "transparent" : "rgba(0, 242, 254, 0.05)"
                            }}
                            onClick={() => claimStream(stream.id)}
                            disabled={loading || isPaused || claimable <= 0}
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
