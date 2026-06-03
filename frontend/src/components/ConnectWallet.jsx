import React, { useState } from "react";
import { Wallet, ShieldAlert, CheckCircle, X, ArrowLeft } from "lucide-react";

export default function ConnectWallet({ 
  account, 
  accountDomain,
  chainId, 
  connectWallet, 
  loading,
  switchToQieMainnet,
  showDashboard,
  onLaunchApp,
  announcedProviders = []
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [modalView, setModalView] = useState("primary"); // primary | other_evm

  const getNetworkName = (id) => {
    if (id === 1990) return "QIE Mainnet";
    return `Wrong Network (${id})`;
  };

  const isSupportedNetwork = chainId === 1990;

  // Find QIE Wallet provider in EIP-6963 announcements
  const qieProvider = announcedProviders.find(
    (p) => p.info.name.toLowerCase().includes("qie") || p.info.rdns.toLowerCase().includes("qie")
  );

  // Filter other EVM wallets
  const otherProviders = announcedProviders.filter(
    (p) => !p.info.name.toLowerCase().includes("qie") && !p.info.rdns.toLowerCase().includes("qie")
  );

  const handleConnectQie = async () => {
    if (qieProvider) {
      await connectWallet(qieProvider);
      setIsOpen(false);
    } else {
      // Fallback: if Qie Wallet is default injected window.ethereum but not announced, or if we want to try standard injection
      if (window.ethereum && (window.ethereum.isQieWallet || window.ethereum.isQIE)) {
        await connectWallet(null);
        setIsOpen(false);
      } else {
        alert("QIE Wallet extension not detected! Please download the extension from the link at the bottom of the modal.");
      }
    }
  };

  const handleConnectProvider = async (providerDetail) => {
    await connectWallet(providerDetail);
    setIsOpen(false);
  };

  const handleOpenConnect = () => {
    setModalView("primary");
    setIsOpen(true);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      {account ? (
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          
          <div style={{ display: "flex", gap: "6px" }}>
            {chainId !== 1990 && (
              <button 
                className="btn btn-secondary" 
                style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(157, 78, 221, 0.05)", borderColor: "rgba(157, 78, 221, 0.2)", color: "var(--color-purple)" }}
                onClick={switchToQieMainnet}
              >
                Switch to QIE Mainnet
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
            {accountDomain && accountDomain !== "" ? accountDomain : `${account.substring(0, 6)}...${account.substring(account.length - 4)}`}
          </button>
        </div>
      ) : (
        <button 
          className="btn btn-primary" 
          onClick={showDashboard ? handleOpenConnect : onLaunchApp}
          disabled={loading}
        >
          <Wallet size={16} />
          {loading ? "Connecting..." : (showDashboard ? "Connect Wallet" : "Launch App")}
        </button>
      )}

      {/* Glassmorphic Wallet Selector Modal */}
      {isOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          background: "rgba(3, 5, 12, 0.8)",
          backdropFilter: "blur(12px)",
          zIndex: 10000,
          display: "flex",
          justifyContent: "center",
          alignItems: "center"
        }}>
          <div style={{
            background: "rgba(10, 16, 32, 0.95)",
            border: "1px solid rgba(0, 242, 254, 0.15)",
            borderRadius: "24px",
            width: "400px",
            padding: "28px",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            boxShadow: "0 0 50px rgba(0, 242, 254, 0.15)"
          }}>
            {/* Close Button */}
            <button 
              onClick={() => setIsOpen(false)}
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: "50%",
                padding: "6px",
                cursor: "pointer",
                display: "flex",
                color: "#fff"
              }}
            >
              <X size={16} />
            </button>

            {modalView === "primary" ? (
              <>
                {/* Header */}
                <div style={{ textAlign: "center", marginTop: "10px" }}>
                  <h3 style={{ margin: 0, fontSize: "1.3rem", fontWeight: "800", color: "#fff" }}>
                    Select Wallet
                  </h3>
                  <p style={{ margin: "6px 0 0 0", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    Choose your connection method
                  </p>
                </div>

                {/* Primary Options */}
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "10px" }}>
                  {/* QIE Wallet (Recommended) */}
                  <button 
                    onClick={handleConnectQie}
                    style={{
                      background: "linear-gradient(135deg, rgba(0, 242, 254, 0.08) 0%, rgba(157, 78, 221, 0.08) 100%)",
                      border: "1px solid rgba(0, 242, 254, 0.4)",
                      borderRadius: "16px",
                      padding: "16px 20px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "#fff",
                      transition: "all 0.2s"
                    }}
                    className="wallet-option-btn-qie"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "1.8rem" }}>💎</span>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: "bold", fontSize: "0.95rem" }}>QIE Wallet</div>
                        <div style={{ fontSize: "0.75rem", color: "#8a9fc4" }}>Native Ecosystem Extension</div>
                      </div>
                    </div>
                    <span style={{
                      fontSize: "0.65rem",
                      background: "rgba(0, 242, 254, 0.15)",
                      color: "var(--color-cyan)",
                      padding: "3px 8px",
                      borderRadius: "8px",
                      fontWeight: "bold",
                      border: "1px solid rgba(0, 242, 254, 0.3)",
                      letterSpacing: "0.05em"
                    }}>RECOMMENDED</span>
                  </button>

                  {/* Other EVM Wallets */}
                  <button 
                    onClick={() => setModalView("other_evm")}
                    style={{
                      background: "rgba(255, 255, 255, 0.02)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "16px",
                      padding: "16px 20px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "#fff",
                      transition: "all 0.2s"
                    }}
                    className="wallet-option-btn"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "1.8rem" }}>🔌</span>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: "bold", fontSize: "0.95rem" }}>Other EVM Wallets</div>
                        <div style={{ fontSize: "0.75rem", color: "#8a9fc4" }}>MetaMask, Rabby, OKX, etc.</div>
                      </div>
                    </div>
                    <span style={{ fontSize: "1rem", color: "rgba(255,255,255,0.3)" }}>→</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Header with Back button */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "10px" }}>
                  <button 
                    onClick={() => setModalView("primary")}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.05)",
                      borderRadius: "8px",
                      padding: "6px",
                      cursor: "pointer",
                      display: "flex",
                      color: "#fff"
                    }}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: "800", color: "#fff" }}>
                    Other EVM Wallets
                  </h3>
                </div>

                {/* Submenu Listing */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "250px", overflowY: "auto", paddingRight: "4px" }}>
                  {otherProviders.length > 0 ? (
                    otherProviders.map((prov) => (
                      <button 
                        key={prov.info.uuid}
                        onClick={() => handleConnectProvider(prov)}
                        style={{
                          background: "rgba(255, 255, 255, 0.02)",
                          border: "1px solid rgba(255, 255, 255, 0.05)",
                          borderRadius: "12px",
                          padding: "12px 16px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          color: "#fff",
                          transition: "all 0.2s"
                        }}
                        className="wallet-sub-btn"
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {prov.info.icon ? (
                            <img src={prov.info.icon} alt={prov.info.name} style={{ width: "24px", height: "24px", borderRadius: "6px" }} />
                          ) : (
                            <span style={{ fontSize: "1.2rem" }}>🦊</span>
                          )}
                          <span style={{ fontWeight: "600", fontSize: "0.9rem" }}>{prov.info.name}</span>
                        </div>
                        <span style={{ fontSize: "0.8rem", color: "var(--color-cyan)", fontWeight: "bold" }}>Connect</span>
                      </button>
                    ))
                  ) : (
                    /* Fallback standard window.ethereum button */
                    <button 
                      onClick={() => handleConnectProvider(null)}
                      style={{
                        background: "rgba(255, 255, 255, 0.02)",
                        border: "1px solid rgba(255, 255, 255, 0.05)",
                        borderRadius: "12px",
                        padding: "12px 16px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: "#fff",
                        transition: "all 0.2s"
                      }}
                      className="wallet-sub-btn"
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ fontSize: "1.5rem" }}>🦊</span>
                        <span style={{ fontWeight: "600", fontSize: "0.9rem" }}>Standard MetaMask / Injected</span>
                      </div>
                      <span style={{ fontSize: "0.8rem", color: "var(--color-cyan)", fontWeight: "bold" }}>Connect</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Install Footer */}
            <div style={{
              textAlign: "center",
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              paddingTop: "16px",
              marginTop: "8px"
            }}>
              Don't have QIE Wallet?{" "}
              <a 
                href="https://qiewallet.me" 
                target="_blank" 
                rel="noreferrer"
                style={{ color: "var(--color-cyan)", textDecoration: "none", fontWeight: "bold" }}
              >
                Download Extension
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
