import React, { useState, useEffect, useRef } from "react";
import { Wallet, ShieldAlert, CheckCircle, X, ArrowLeft, LogOut, Copy, Check, ChevronDown, Smartphone, Shield, Globe, QrCode, ChevronRight, Puzzle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export default function ConnectWallet({ 
  account, 
  accountDomain,
  chainId, 
  connectWallet,
  connectWalletConnect,
  finalizeWalletConnect,
  disconnectWallet, 
  loading,
  switchToQieMainnet,
  showDashboard,
  onLaunchApp,
  announcedProviders = [],
  isOpen,
  setIsOpen
}) {
  const [modalView, setModalView] = useState("primary"); // primary | other_evm | mobile_qr
  const [showDropdown, setShowDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wcUri, setWcUri] = useState("");
  const [wcConnecting, setWcConnecting] = useState(false);
  const [wcError, setWcError] = useState("");
  const dropdownRef = useRef(null);

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

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

  const isQieWalletDetected = !!qieProvider || !!(window.ethereum && (
    window.ethereum.isQieWallet || 
    window.ethereum.isQIE || 
    (window.ethereum.providers && window.ethereum.providers.some(p => p.isQieWallet || p.isQIE))
  ));

  const handleConnectClick = () => {
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
                style={{ padding: "6px 12px", fontSize: "0.75rem", background: "rgba(255,255,255,0.06)", borderColor: "#e0e0e0", color: "#666666" }}
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
              background: "#f8f8f8",
              fontSize: "0.85rem",
              borderColor: isSupportedNetwork ? "rgba(16, 185, 129, 0.2)" : "rgba(244, 63, 94, 0.2)"
            }}
          >
            {isSupportedNetwork ? (
              <CheckCircle size={16} color="#333333" />
            ) : (
              <ShieldAlert size={16} color="#777777" />
            )}
            <span style={{ color: isSupportedNetwork ? "#111111" : "#cc3333", fontWeight: "bold" }}>
              {getNetworkName(chainId)}
            </span>
          </div>

          {/* Account Indicator with Dropdown */}
          <div style={{ position: "relative" }}>
            <button 
              className="btn btn-secondary" 
              onClick={() => setShowDropdown(!showDropdown)}
              style={{ 
                fontFamily: "monospace", 
                fontSize: "0.85rem",
                background: "#e8e8e8",
                borderColor: "#e0e0e0",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <Wallet size={16} color="#333333" />
              <span>
                {accountDomain && accountDomain !== "" ? accountDomain : `${account.substring(0, 6)}...${account.substring(account.length - 4)}`}
              </span>
              <ChevronDown size={14} style={{ opacity: 0.6, transform: showDropdown ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
            </button>

            {showDropdown && (
              <div 
                ref={dropdownRef}
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  background: "#ffffff",
                  border: "1px solid #e0e0e0",
                  borderRadius: "12px",
                  width: "260px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  boxShadow: "0 10px 25px rgba(0, 0, 0, 0.12), 0 4px 10px rgba(0, 0, 0, 0.06)",
                  zIndex: 1000,
                  textAlign: "left"
                }}
              >
                {/* Header / Domain */}
                <div>
                  <div style={{ fontSize: "0.75rem", color: "#888888", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
                    Connected Wallet
                  </div>
                  {accountDomain && (
                    <div style={{ fontWeight: "bold", color: "#111111", fontSize: "0.95rem", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {accountDomain}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "0.85rem", color: "#111111" }}>
                      {account.substring(0, 8)}...{account.substring(account.length - 6)}
                    </span>
                    <button 
                      onClick={handleCopyAddress}
                      style={{
                        background: "#f5f5f5",
                        border: "1px solid #e0e0e0",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        padding: "6px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "6px",
                        transition: "all 0.2s"
                      }}
                      title="Copy Address"
                    >
                      {copied ? <Check size={14} color="#333333" /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>

                <hr style={{ border: "none", borderTop: "1px solid #e8e8e8", margin: "0" }} />

                {/* Actions */}
                <button 
                  onClick={() => {
                    disconnectWallet();
                    setShowDropdown(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    width: "100%",
                    padding: "10px",
                    background: "#fff5f5",
                    border: "1px solid #e8c4c4",
                    borderRadius: "8px",
                    color: "#cc3333",
                    fontSize: "0.85rem",
                    fontWeight: "bold",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  <LogOut size={14} />
                  Disconnect Wallet
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <button 
          className="btn btn-primary" 
          onClick={showDashboard ? handleConnectClick : onLaunchApp}
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
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: "24px",
            width: "400px",
            padding: "28px",
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            boxShadow: "0 0 50px rgba(0,0,0,0.5)"
          }}>
            {/* Close Button */}
            <button 
              onClick={() => setIsOpen(false)}
              style={{
                position: "absolute",
                top: "20px",
                right: "20px",
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "50%",
                padding: "6px",
                cursor: "pointer",
                display: "flex",
                color: "#ffffff"
              }}
            >
              <X size={16} />
            </button>

            {modalView === "primary" ? (
              <>
                {/* Header */}
                <div style={{ textAlign: "center", marginTop: "10px" }}>
                  <div style={{ 
                    width: "48px", height: "48px", margin: "0 auto 14px auto",
                    background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
                    borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 4px 20px rgba(99, 102, 241, 0.3)"
                  }}>
                    <Wallet size={24} color="#ffffff" />
                  </div>
                  <h3 style={{ margin: 0, fontSize: "1.3rem", fontWeight: "800", color: "#ffffff", letterSpacing: "-0.02em" }}>
                    Connect Wallet
                  </h3>
                  <p style={{ margin: "6px 0 0 0", fontSize: "0.82rem", color: "#71717a" }}>
                    Choose how you'd like to connect
                  </p>
                </div>

                {/* Primary Options */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "6px" }}>
                  {/* QIE Wallet (Recommended) */}
                  <button 
                    onClick={handleConnectQie}
                    style={{
                      background: "linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.03) 100%)",
                      border: "1px solid rgba(59, 130, 246, 0.25)",
                      borderRadius: "14px",
                      padding: "14px 16px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "#ffffff",
                      transition: "all 0.25s ease"
                    }}
                    className="wallet-option-btn-qie"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: "40px", height: "40px",
                        background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                        borderRadius: "10px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 2px 12px rgba(59, 130, 246, 0.35)",
                        flexShrink: 0
                      }}>
                        <Shield size={20} color="#ffffff" strokeWidth={2.5} />
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: "700", fontSize: "0.92rem", letterSpacing: "-0.01em" }}>QIE Wallet</div>
                        <div style={{ fontSize: "0.72rem", color: "#71717a", marginTop: "2px" }}>Browser Extension</div>
                      </div>
                    </div>
                    <span style={{
                      fontSize: "0.6rem",
                      background: "rgba(59, 130, 246, 0.15)",
                      color: "#60a5fa",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      fontWeight: "700",
                      border: "1px solid rgba(59, 130, 246, 0.25)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase"
                    }}>Recommended</span>
                  </button>

                  {/* QIE Mobile Wallet (WalletConnect QR) */}
                  <button 
                    onClick={() => {
                      setWcConnecting(true);
                      setWcUri("");
                      setWcError("");
                      setModalView("mobile_qr");
                      connectWalletConnect((uri) => {
                        if (uri) {
                          setWcUri(uri);
                          setWcConnecting(false);
                          setWcError("");
                        } else {
                          // Relay blocked or timed out — show error inside the QR view
                          setWcConnecting(false);
                          setWcError("Network is blocking WalletConnect relay.\n\nFix: Enable a VPN on your device, or switch to a different Wi-Fi / mobile data network, then tap Retry.");
                        }
                      });
                    }}
                    style={{
                      background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.02) 100%)",
                      border: "1px solid rgba(16, 185, 129, 0.2)",
                      borderRadius: "14px",
                      padding: "14px 16px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "#ffffff",
                      transition: "all 0.25s ease"
                    }}
                    className="wallet-option-btn"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: "40px", height: "40px",
                        background: "linear-gradient(135deg, #10b981, #059669)",
                        borderRadius: "10px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        boxShadow: "0 2px 12px rgba(16, 185, 129, 0.3)",
                        flexShrink: 0
                      }}>
                        <QrCode size={20} color="#ffffff" strokeWidth={2.5} />
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: "700", fontSize: "0.92rem", letterSpacing: "-0.01em" }}>QIE Mobile</div>
                        <div style={{ fontSize: "0.72rem", color: "#71717a", marginTop: "2px" }}>Scan QR to connect</div>
                      </div>
                    </div>
                    <span style={{
                      fontSize: "0.6rem",
                      background: "rgba(16, 185, 129, 0.12)",
                      color: "#34d399",
                      padding: "4px 8px",
                      borderRadius: "6px",
                      fontWeight: "700",
                      border: "1px solid rgba(16, 185, 129, 0.25)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase"
                    }}>Mobile</span>
                  </button>

                  {/* Other EVM Wallets */}
                  <button 
                    onClick={() => setModalView("other_evm")}
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "14px",
                      padding: "14px 16px",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      color: "#ffffff",
                      transition: "all 0.25s ease"
                    }}
                    className="wallet-option-btn"
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: "40px", height: "40px",
                        background: "linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))",
                        borderRadius: "10px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "1px solid rgba(255,255,255,0.08)",
                        flexShrink: 0
                      }}>
                        <Puzzle size={20} color="#a1a1aa" strokeWidth={2} />
                      </div>
                      <div style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: "700", fontSize: "0.92rem", letterSpacing: "-0.01em" }}>Other Wallets</div>
                        <div style={{ fontSize: "0.72rem", color: "#71717a", marginTop: "2px" }}>MetaMask, Rabby, OKX & more</div>
                      </div>
                    </div>
                    <ChevronRight size={16} color="rgba(255,255,255,0.3)" />
                  </button>
                </div>
              </>
            ) : modalView === "other_evm" ? (
              <>
                {/* Header with Back button */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "10px" }}>
                  <button 
                    onClick={() => setModalView("primary")}
                    style={{
                      background: "rgba(255, 255, 255, 0.08)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px",
                      padding: "6px",
                      cursor: "pointer",
                      display: "flex",
                      color: "#ffffff"
                    }}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: "800", color: "#ffffff" }}>
                    Other EVM Wallets
                  </h3>
                </div>

                {!isQieWalletDetected && (
                  <div style={{
                    background: "rgba(255, 171, 0, 0.08)",
                    border: "1px solid rgba(255, 171, 0, 0.2)",
                    borderRadius: "12px",
                    padding: "10px 14px",
                    fontSize: "0.8rem",
                    color: "#ffab00",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    lineHeight: "1.3"
                  }}>
                    <ShieldAlert size={16} style={{ flexShrink: 0 }} />
                    <span>
                      QIE Wallet was not detected. Connect another wallet or install QIE Wallet below.
                    </span>
                  </div>
                )}

                {/* Submenu Listing */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "250px", overflowY: "auto", paddingRight: "4px" }}>
                  {otherProviders.length > 0 ? (
                    otherProviders.map((prov) => (
                      <button 
                        key={prov.info.uuid}
                        onClick={() => handleConnectProvider(prov)}
                        style={{
                          background: "#f8f8f8",
                          border: "1px solid rgba(255, 255, 255, 0.05)",
                          borderRadius: "12px",
                          padding: "12px 16px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          color: "#111111",
                          transition: "all 0.2s"
                        }}
                        className="wallet-sub-btn"
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          {prov.info.icon ? (
                            <img src={prov.info.icon} alt={prov.info.name} style={{ width: "24px", height: "24px", borderRadius: "6px" }} />
                          ) : (
                            <span style={{ fontSize: "1.2rem" }}>
                              <Globe size={18} color="#a1a1aa" />
                            </span>
                          )}
                          <span style={{ fontWeight: "600", fontSize: "0.9rem" }}>{prov.info.name}</span>
                        </div>
                        <span style={{ fontSize: "0.8rem", color: "#111111", fontWeight: "bold" }}>Connect</span>
                      </button>
                    ))
                  ) : (
                    /* Fallback standard window.ethereum button */
                    <button 
                      onClick={() => handleConnectProvider(null)}
                      style={{
                        background: "#f8f8f8",
                        border: "1px solid rgba(255, 255, 255, 0.05)",
                        borderRadius: "12px",
                        padding: "12px 16px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: "#111111",
                        transition: "all 0.2s"
                      }}
                      className="wallet-sub-btn"
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span style={{ display: "flex", alignItems: "center" }}><Globe size={20} color="#a1a1aa" /></span>
                        <span style={{ fontWeight: "600", fontSize: "0.9rem" }}>Standard MetaMask / Injected</span>
                      </div>
                      <span style={{ fontSize: "0.8rem", color: "#111111", fontWeight: "bold" }}>Connect</span>
                    </button>
                  )}
                </div>
              </>
            ) : modalView === "mobile_qr" ? (
              <>
                {/* Header with Back button */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "10px" }}>
                  <button 
                    onClick={() => { setModalView("primary"); setWcUri(""); setWcError(""); }}
                    style={{
                      background: "rgba(255, 255, 255, 0.08)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px",
                      padding: "6px",
                      cursor: "pointer",
                      display: "flex",
                      color: "#ffffff"
                    }}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: "800", color: "#ffffff" }}>
                    QIE Mobile Wallet
                  </h3>
                </div>

                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "20px",
                  padding: "10px 0"
                }}>
                  {wcUri ? (
                    <>
                      <div style={{
                        background: "#ffffff",
                        borderRadius: "16px",
                        padding: "16px",
                        display: "inline-flex"
                      }}>
                        <QRCodeSVG 
                          value={wcUri} 
                          size={220}
                          level="M"
                          bgColor="#ffffff"
                          fgColor="#111111"
                        />
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <p style={{ margin: 0, fontSize: "0.9rem", color: "#ffffff", fontWeight: "600" }}>
                          Scan with QIE Mobile Wallet
                        </p>
                        <p style={{ margin: "6px 0 0 0", fontSize: "0.78rem", color: "#a1a1aa", lineHeight: "1.4" }}>
                          Open your QIE Mobile Wallet app and scan this QR code to connect
                        </p>
                      </div>
                    </>
                  ) : wcError ? (
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "16px",
                      padding: "20px 0"
                    }}>
                      <div style={{
                        width: "52px", height: "52px",
                        background: "rgba(239, 68, 68, 0.12)",
                        border: "1px solid rgba(239, 68, 68, 0.35)",
                        borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center"
                      }}>
                        <ShieldAlert size={24} color="#f87171" />
                      </div>
                      <div style={{ textAlign: "center", maxWidth: "260px" }}>
                        <p style={{ margin: "0 0 6px 0", fontSize: "0.9rem", fontWeight: "700", color: "#f87171" }}>
                          Relay Connection Failed
                        </p>
                        {wcError.split("\n\n").map((line, i) => (
                          <p key={i} style={{ margin: "4px 0", fontSize: "0.78rem", color: "#a1a1aa", lineHeight: "1.5" }}>
                            {line}
                          </p>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          setWcConnecting(true);
                          setWcUri("");
                          setWcError("");
                          connectWalletConnect((uri) => {
                            if (uri) {
                              setWcUri(uri);
                              setWcConnecting(false);
                              setWcError("");
                            } else {
                              setWcConnecting(false);
                              setWcError("Network is blocking WalletConnect relay.\n\nFix: Enable a VPN on your device, or switch to a different Wi-Fi / mobile data network, then tap Retry.");
                            }
                          });
                        }}
                        style={{
                          background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                          border: "none",
                          borderRadius: "10px",
                          padding: "10px 24px",
                          color: "#ffffff",
                          fontWeight: "700",
                          fontSize: "0.85rem",
                          cursor: "pointer"
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "12px",
                      padding: "30px 0"
                    }}>
                      <div style={{
                        width: "40px",
                        height: "40px",
                        border: "3px solid rgba(255,255,255,0.1)",
                        borderTopColor: "#60a5fa",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite"
                      }} />
                      <p style={{ margin: 0, fontSize: "0.85rem", color: "#a1a1aa" }}>
                        Initializing WalletConnect...
                      </p>
                      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                    </div>
                  )}
                </div>
              </>
            ) : null}

            {/* Install Footer */}
            <div style={{
              textAlign: "center",
              fontSize: "0.75rem",
              color: "#9ca3af",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              paddingTop: "16px",
              marginTop: "8px"
            }}>
              Don't have QIE Wallet?{" "}
              <a 
                href="https://qiewallet.me" 
                target="_blank" 
                rel="noreferrer"
                style={{ color: "#60a5fa", textDecoration: "none", fontWeight: "bold" }}
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
