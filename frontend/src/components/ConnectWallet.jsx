import React from "react";
import { Wallet, ShieldAlert, CheckCircle } from "lucide-react";

export default function ConnectWallet({ account, chainId, connectWallet, loading }) {
  const getNetworkName = (id) => {
    if (id === 1983) return "QIE Testnet";
    if (id === 31337) return "Localhost (31337)";
    return `Unknown Network (${id})`;
  };

  const isSupportedNetwork = chainId === 1983 || chainId === 31337;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      {account ? (
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Network Indicator */}
          <div 
            className="glass-card" 
            style={{ 
              padding: "8px 16px", 
              borderRadius: "10px", 
              display: "flex", 
              alignItems: "center", 
              gap: "8px",
              background: "rgba(255, 255, 255, 0.02)",
              fontSize: "0.85rem"
            }}
          >
            {isSupportedNetwork ? (
              <CheckCircle size={16} color="var(--color-emerald)" />
            ) : (
              <ShieldAlert size={16} color="var(--color-rose)" />
            )}
            <span style={{ color: isSupportedNetwork ? "var(--text-primary)" : "var(--color-rose)" }}>
              {getNetworkName(chainId)}
            </span>
          </div>

          {/* Account Indicator */}
          <button 
            className="btn btn-secondary" 
            style={{ 
              fontFamily: "monospace", 
              fontSize: "0.85rem",
              background: "rgba(0, 242, 254, 0.05)",
              borderColor: "rgba(0, 242, 254, 0.15)"
            }}
          >
            <Wallet size={16} color="var(--color-cyan)" />
            {account.substring(0, 6)}...{account.substring(account.length - 4)}
          </button>
        </div>
      ) : (
        <button 
          className="btn btn-primary" 
          onClick={connectWallet}
          disabled={loading}
        >
          <Wallet size={16} />
          {loading ? "Connecting..." : "Connect MetaMask"}
        </button>
      )}
    </div>
  );
}
