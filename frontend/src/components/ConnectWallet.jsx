import React from "react";
import { Wallet, ShieldAlert, CheckCircle, RefreshCw } from "lucide-react";

export default function ConnectWallet({ 
  account, 
  chainId, 
  connectWallet, 
  loading,
  switchToQieTestnet,
  switchToQieMainnet
}) {
  const getNetworkName = (id) => {
    if (id === 1983) return "QIE Testnet";
    if (id === 1990) return "QIE Mainnet";
    if (id === 31337) return "Localhost (31337)";
    return `Unknown Network (${id})`;
  };

  const isSupportedNetwork = chainId === 1983 || chainId === 1990 || chainId === 31337;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      {account ? (
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          
          {/* Network Selector / Switch buttons */}
          <div style={{ display: "flex", gap: "6px" }}>
            {chainId !== 1990 && (
              <button 
                className="btn btn-secondary" 
                style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(157, 78, 221, 0.05)", borderColor: "rgba(157, 78, 221, 0.2)", color: "var(--color-purple)" }}
                onClick={switchToQieMainnet}
              >
                QIE Mainnet
              </button>
            )}
            {chainId !== 1983 && (
              <button 
                className="btn btn-secondary" 
                style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(0, 242, 254, 0.05)", borderColor: "rgba(0, 242, 254, 0.2)", color: "var(--color-cyan)" }}
                onClick={switchToQieTestnet}
              >
                QIE Testnet
              </button>
            )}
          </div>

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
              fontSize: "0.85rem",
              borderColor: isSupportedNetwork ? "rgba(16, 185, 129, 0.2)" : "rgba(244, 63, 94, 0.2)"
            }}
          >
            {isSupportedNetwork ? (
              <CheckCircle size={16} color="var(--color-emerald)" />
            ) : (
              <ShieldAlert size={16} color="var(--color-rose)" />
            )}
            <span style={{ color: isSupportedNetwork ? "var(--text-primary)" : "var(--color-rose)", fontWeight: "bold" }}>
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
