import React, { useState, useEffect, useRef } from "react";
import { useFluenci } from "./hooks/useFluenci";
import ConnectWallet from "./components/ConnectWallet";
import SubscriberPanel from "./components/SubscriberPanel";
import MerchantDashboard from "./components/MerchantDashboard";
import AISecurityDesk from "./components/AISecurityDesk";
import { QieDoodleGame } from "./components/QieDoodleGame";
import TransactionModal from "./components/TransactionModal";
import { Shield, Sparkles, Building2, UserCircle, Terminal, HelpCircle, Activity } from "lucide-react";
import LogoImage from "./assets/logo.png";
import "./App.css";

// Default deployment addresses
const DEFAULT_HARDHAT_CONTRACTS = {
  registry: "0x2DA9e917568D69626078df6bCb7B71F0DeDA6117",
  qusdc: "0xB64aE86dc64AEcB67a870192cDCAeC30EBd14b3b",
  weth: "0x45466425dc303c8c014885ACdEd3d95147eC4993",
  qiepass: "0x774758CE0Cb704AC54f1cc0cace59d2957d8250A",
  auditor: "0x75475647f52531D4086296415392E4AA94b92de7",
  qiedex: "0xE21F69c4394dFA41FC5F31a9B994e0275B47cD34",
  qiedomain: "0x5b66380309C29D00Ff82388a856fB5e87fF09A7E"
};

// Live AI Telemetry mock widget for Landing Page
function LandingTelemetryTerminal() {
  const [logs, setLogs] = useState([
    { type: "INFO", time: "12:00:01", text: "Fluenci AI Sentry Node Initializing..." }
  ]);
  const [activeStreams, setActiveStreams] = useState(12);
  const [systemRisk, setSystemRisk] = useState(12);
  const logIndexRef = useRef(1);

  const MOCK_LANDING_LOGS = [
    { type: "INFO", text: "Establishing secure link to QIE Testnet (1983)..." },
    { type: "SUCCESS", text: "DID verification module loaded via QIE Pass." },
    { type: "INFO", text: "Monitoring active streams for pricing telemetry..." },
    { type: "AUDIT", text: "Scanning stream 0x4e8d... rate = 100 qUSD/hr. Status: compliant" },
    { type: "AUDIT", text: "Scanning stream 0xa39b... rate = 50 qUSD/hr. Status: compliant" },
    { type: "ALERT", text: "ANOMALY DETECTED on stream 0xf92c! Monthly rate spiked from baseline." },
    { type: "ACTION", text: "AI Worker executing safety pause tx on-chain..." },
    { type: "SUCCESS", text: "Registry updated: stream 0xf92c successfully PAUSED." },
    { type: "INFO", text: "Waiting for subscriber DID signature to unlock..." }
  ];

  useEffect(() => {
    const logInterval = setInterval(() => {
      const nextLog = MOCK_LANDING_LOGS[logIndexRef.current % MOCK_LANDING_LOGS.length];
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];

      if (nextLog.type === "ALERT") {
        setSystemRisk(89);
      } else if (nextLog.type === "SUCCESS" && nextLog.text.includes("PAUSED")) {
        setSystemRisk(15);
        setActiveStreams(prev => Math.max(0, prev - 1));
      } else if (nextLog.type === "SUCCESS" && nextLog.text.includes("loaded")) {
        setSystemRisk(8);
      } else if (logIndexRef.current % MOCK_LANDING_LOGS.length === 0) {
        setSystemRisk(12);
        setActiveStreams(12);
      }

      setLogs(prev => {
        const next = [...prev, { type: nextLog.type, time: timeStr, text: nextLog.text }];
        if (next.length > 7) {
          next.shift();
        }
        return next;
      });

      logIndexRef.current++;
    }, 2800);

    return () => clearInterval(logInterval);
  }, []);

  const getLogColor = (type) => {
    switch (type) {
      case "ALERT": return "var(--color-rose)";
      case "ACTION": return "var(--color-amber)";
      case "SUCCESS": return "var(--color-emerald)";
      case "AUDIT": return "var(--color-cyan)";
      default: return "var(--text-secondary)";
    }
  };

  return (
    <div className="telemetry-mock-box">
      {/* Terminal Titlebar */}
      <div style={{ 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center", 
        padding: "12px 16px", 
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        background: "rgba(0, 0, 0, 0.2)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span className="status-indicator status-online" />
          <span style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#fff", fontWeight: "bold", letterSpacing: "0.05em" }}>
            AI-TELEMETRY.NODE
          </span>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
        </div>
      </div>

      {/* Terminal Stats */}
      <div style={{ 
        display: "grid", 
        gridTemplateColumns: "1fr 1fr", 
        gap: "10px", 
        padding: "14px 16px", 
        borderBottom: "1px solid rgba(255, 255, 255, 0.03)",
        background: "rgba(255,255,255,0.01)"
      }}>
        <div style={{ borderLeft: "2px solid var(--color-cyan)", paddingLeft: "8px" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Active Streams</div>
          <div style={{ fontSize: "1.2rem", fontWeight: "bold", fontFamily: "monospace", color: "#fff" }}>{activeStreams}</div>
        </div>
        <div style={{ borderLeft: `2px solid ${systemRisk > 50 ? 'var(--color-rose)' : 'var(--color-emerald)'}`, paddingLeft: "8px" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>System Risk Score</div>
          <div style={{ 
            fontSize: "1.2rem", 
            fontWeight: "bold", 
            fontFamily: "monospace", 
            color: systemRisk > 50 ? 'var(--color-rose)' : 'var(--color-emerald)',
            textShadow: systemRisk > 50 ? '0 0 10px rgba(244, 63, 94, 0.2)' : 'none'
          }}>{systemRisk}%</div>
        </div>
      </div>

      {/* Screen scanline */}
      <div className="scanner-line" style={{ height: "1px" }} />

      {/* Screen logs */}
      <div style={{ 
        flexGrow: 1, 
        padding: "16px", 
        fontFamily: "monospace", 
        fontSize: "0.75rem", 
        color: "var(--text-primary)", 
        display: "flex", 
        flexDirection: "column", 
        gap: "8px", 
        overflowY: "hidden" 
      }}>
        {logs.map((log, i) => (
          <div key={i} style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
            <span style={{ color: "var(--text-muted)" }}>[{log.time}]</span>
            <span style={{ color: getLogColor(log.type), fontWeight: "bold" }}>[{log.type}]</span>
            <span style={{ flexGrow: 1, wordBreak: "break-all" }}>{log.text}</span>
          </div>
        ))}
        {/* Blinking cursor at the end */}
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ color: "var(--color-cyan)" }}>&gt;</span>
          <span style={{ 
            width: "6px", 
            height: "12px", 
            background: "var(--color-cyan)", 
            animation: "pulse 1s infinite" 
          }} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const fluenci = useFluenci();
  const [activeTab, setActiveTab] = useState("subscriber");
  const [viewMode, setViewMode] = useState("landing");
  const prevAccountRef = useRef(fluenci.account);

  // Prepopulate contract addresses if empty
  useEffect(() => {
    if (!fluenci.contracts.registry || !fluenci.contracts.qusdc || !fluenci.contracts.qiepass || !fluenci.contracts.auditor) {
      fluenci.updateContractAddresses(DEFAULT_HARDHAT_CONTRACTS);
    }
  }, [fluenci]);

  // Auto-redirect to dashboard when wallet connects
  useEffect(() => {
    if (!prevAccountRef.current && fluenci.account) {
      setViewMode("dashboard");
    }
    prevAccountRef.current = fluenci.account;
  }, [fluenci.account]);

  const renderActiveTab = () => {
    switch (activeTab) {
      case "subscriber":
        return (
          <>
            <SubscriberPanel
              account={fluenci.account}
              qieBalance={fluenci.qieBalance}
              qusdcBalance={fluenci.qusdcBalance}
              wethBalance={fluenci.wethBalance}
              qusdcAllowance={fluenci.qusdcAllowance}
              wethAllowance={fluenci.wethAllowance}
              qiePassVerified={fluenci.qiePassVerified}
              subscriberStreams={fluenci.subscriberStreams}
              realtimeClaimables={fluenci.realtimeClaimables}
              loading={fluenci.loading}
              mintMockTokens={fluenci.mintMockTokens}
              approveToken={fluenci.approveToken}
              toggleQiePassStatus={fluenci.toggleQiePassStatus}
              createSubscription={fluenci.createSubscription}
              resumeStream={fluenci.resumeStream}
              terminateStream={fluenci.terminateStream}
              openDispute={fluenci.openDispute}
              resolveDisputeOnChain={fluenci.resolveDisputeOnChain}
              transferStreamNFT={fluenci.transferStreamNFT}
              swapQieForTokens={fluenci.swapQieForTokens}
              contracts={fluenci.contracts}
            />
            
            <QieDoodleGame
              account={fluenci.account}
              subscriberStreams={fluenci.subscriberStreams}
              createSubscription={fluenci.createSubscription}
              contracts={fluenci.contracts}
            />
          </>
        );
      case "merchant":
        return (
          <MerchantDashboard
            account={fluenci.account}
            qieBalance={fluenci.qieBalance}
            qusdcBalance={fluenci.qusdcBalance}
            wethBalance={fluenci.wethBalance}
            merchantStreams={fluenci.merchantStreams}
            realtimeClaimables={fluenci.realtimeClaimables}
            loading={fluenci.loading}
            claimStream={fluenci.claimStream}
          />
        );
      case "security":
        return (
          <AISecurityDesk
            contracts={fluenci.contracts}
            updateContractAddresses={fluenci.updateContractAddresses}
            subscriberStreams={fluenci.subscriberStreams}
            merchantStreams={fluenci.merchantStreams}
            loading={fluenci.loading}
            refreshData={fluenci.refreshData}
          />
        );
      default:
        return null;
    }
  };

  const isSupportedNetwork = fluenci.chainId === 1983 || fluenci.chainId === 1990;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Navbar */}
      <header 
        style={{ 
          padding: "20px 40px", 
          borderBottom: "1px solid var(--border-color)", 
          background: "rgba(10, 15, 30, 0.5)",
          backdropFilter: "blur(8px)",
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          position: "sticky",
          top: 0,
          zIndex: 100
        }}
      >
        <div 
          style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer" }}
          onClick={() => setViewMode("landing")}
          title="Return to Landing Page"
        >
          <img 
            src={LogoImage} 
            alt="Fluenci Logo" 
            style={{ 
              width: "42px", 
              height: "42px", 
              borderRadius: "10px",
              boxShadow: "0 0 15px rgba(0, 242, 254, 0.3)",
              border: "1px solid rgba(0, 242, 254, 0.2)"
            }} 
          />
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: "800", color: "#fff", lineHeight: "1.2" }}>
              Fluenci
            </h1>
            <span style={{ fontSize: "0.75rem", color: "var(--color-cyan)", fontWeight: "600", tracking: "0.05em" }}>
              AI-SHIELDED PAYMENT STREAMS & DISPUTE NFT
            </span>
          </div>
        </div>

        {/* Tab Navigation (visible when dashboard view is active) */}
        {viewMode === "dashboard" && (!fluenci.account || isSupportedNetwork) && (
          <nav style={{ display: "flex", gap: "8px", background: "rgba(255,255,255,0.03)", padding: "4px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <button 
              className={`btn ${activeTab === "subscriber" ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "8px 16px", borderRadius: "8px", border: "none", boxShadow: activeTab === "subscriber" ? "var(--shadow-neon)" : "none" }}
              onClick={() => setActiveTab("subscriber")}
            >
              <UserCircle size={16} />
              Subscriber Panel
            </button>
            <button 
              className={`btn ${activeTab === "merchant" ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "8px 16px", borderRadius: "8px", border: "none", boxShadow: activeTab === "merchant" ? "var(--shadow-neon)" : "none" }}
              onClick={() => setActiveTab("merchant")}
            >
              <Building2 size={16} />
              Merchant Dashboard
            </button>
            <button 
              className={`btn ${activeTab === "security" ? "btn-primary" : "btn-secondary"}`}
              style={{ padding: "8px 16px", borderRadius: "8px", border: "none", boxShadow: activeTab === "security" ? "var(--shadow-neon)" : "none" }}
              onClick={() => setActiveTab("security")}
            >
              <Terminal size={16} />
              AI Security Desk
            </button>
          </nav>
        )}

        <ConnectWallet
          account={fluenci.account}
          chainId={fluenci.chainId}
          connectWallet={fluenci.connectWallet}
          loading={fluenci.loading}
          switchToQieTestnet={fluenci.switchToQieTestnet}
          switchToQieMainnet={fluenci.switchToQieMainnet}
          showDashboard={viewMode === "dashboard"}
          onLaunchApp={() => setViewMode("dashboard")}
        />
      </header>
 
      {/* Main Content Area */}
      <main style={{ flexGrow: 1, padding: "40px", maxWidth: "1200px", width: "100%", margin: "0 auto" }}>
        
        {/* Error alert banners */}
        {fluenci.error && (fluenci.error.includes("rpc1testnet") || fluenci.error.includes("timed out") || fluenci.error.includes("request failed") || fluenci.error.includes("Failed to fetch") || fluenci.error.includes("coalesce") || fluenci.error.includes("32603")) ? (
          <div 
            className="glass-card" 
            style={{ 
              marginBottom: "24px", 
              borderColor: "var(--color-amber)", 
              background: "rgba(245, 158, 11, 0.05)",
              color: "var(--color-amber)",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              textAlign: "left"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Shield size={22} color="var(--color-amber)" />
              <strong style={{ fontSize: "1.1rem" }}>Wallet RPC Misconfiguration Detected</strong>
            </div>
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", margin: 0, lineHeight: "1.4" }}>
              Your wallet is trying to reach the <code>rpc1testnet.qie.digital</code> node but it appears to be down.
              Please check your wallet's <strong>Custom Network / Chain settings</strong> for QIE Testnet (Chain ID 1983)
              and ensure the RPC URL is set to <code>https://rpc1testnet.qie.digital</code>, then try again.
              You can also click the button below to attempt an automatic repair.
            </p>
            <button 
              className="btn btn-primary" 
              style={{ alignSelf: "flex-start", padding: "8px 16px", fontSize: "0.85rem" }}
              onClick={fluenci.switchToQieTestnet}
            >
              Auto-Repair Wallet RPC Configuration
            </button>
          </div>
        ) : fluenci.error && (
          <div 
            className="glass-card" 
            style={{ 
              marginBottom: "24px", 
              borderColor: "rgba(244, 63, 94, 0.4)", 
              background: "rgba(244, 63, 94, 0.05)",
              color: "var(--color-rose)",
              padding: "16px",
              display: "flex",
              alignItems: "center",
              gap: "10px"
            }}
          >
            <Shield size={20} />
            <span>{fluenci.error}</span>
          </div>
        )}
 
        {/* Network Warning Banner */}
        {fluenci.account && !isSupportedNetwork && (
          <div 
            className="glass-card" 
            style={{ 
              marginBottom: "30px", 
              borderColor: "rgba(245, 158, 11, 0.4)", 
              background: "rgba(245, 158, 11, 0.05)",
              color: "var(--color-amber)",
              padding: "24px",
              textAlign: "center"
            }}
          >
            <h3 style={{ marginBottom: "10px" }}>Unsupported Blockchain Network Connected</h3>
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Fluenci operates on the **QIE Testnet (Chain ID: 1983)** or **QIE Mainnet (Chain ID: 1990)**. 
              Please switch your MetaMask network connection.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={fluenci.switchToQieTestnet}>
                Switch to QIE Testnet
              </button>
              <button className="btn btn-secondary" onClick={fluenci.switchToQieMainnet}>
                Switch to QIE Mainnet
              </button>
            </div>
          </div>
        )}

        {/* Read-Only Mode Preview Banner */}
        {viewMode === "dashboard" && !fluenci.account && (
          <div 
            className="glass-card" 
            style={{ 
              marginBottom: "24px", 
              borderColor: "rgba(0, 242, 254, 0.3)", 
              background: "rgba(0, 242, 254, 0.03)",
              color: "var(--color-cyan)",
              padding: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Shield size={20} />
              <span>
                <strong>Read-Only Preview Mode:</strong> You are browsing the dashboard. Connect your Web3 wallet to start payment streams, claim funds, or verify identity.
              </span>
            </div>
            <button className="btn btn-primary" style={{ padding: "6px 14px", fontSize: "0.80rem" }} onClick={fluenci.connectWallet}>
              Connect Wallet
            </button>
          </div>
        )}

        {/* tab Content display */}
        {viewMode === "dashboard" ? (
          (!fluenci.account || isSupportedNetwork) ? (
            renderActiveTab()
          ) : null
        ) : (
          /* New High-Fidelity Revamped Landing Page */
          <div className="landing-container">
            <div className="dot-grid" />
            
            {/* Hero Section */}
            <section className="landing-section hero-grid">
              <div style={{ textAlign: "left", zIndex: 1 }}>
                <div className="hero-badge">
                  <Sparkles size={12} />
                  AI-Shielded Subscriptions
                </div>
                <h1 className="gradient-title">
                  Stop Blind Streams.<br />
                  <span className="gradient-title-accent">AI-Shielded</span> Payments.
                </h1>
                <p className="hero-subtitle">
                  Fluenci is the first recurring billing protocol on QIE Blockchain that integrates an autonomous AI Auditor Agent to audit transaction telemetry and prevent billing exploits.
                </p>
                <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                  <button className="btn btn-primary btn-cta-pulse" onClick={() => setViewMode("dashboard")}>
                    Launch App
                  </button>
                  <a href="#how-it-works" className="btn btn-secondary" style={{ textDecoration: "none" }}>
                    How it works
                  </a>
                </div>
              </div>

              {/* Live Telemetry Terminal Simulation */}
              <div style={{ zIndex: 1, position: "relative" }}>
                <LandingTelemetryTerminal />
              </div>
            </section>

            {/* How It Works Section */}
            <section id="how-it-works" className="landing-section">
              <div className="section-header">
                <h2>Continuous Flow, Protected in Real-Time</h2>
                <p>Fluenci integrates three layers of verification to make subscription billing safe for everyone.</p>
              </div>

              <div className="step-cards-grid">
                <div className="step-card">
                  <div className="step-number">01</div>
                  <div className="step-icon-wrapper">
                    <UserCircle size={24} />
                  </div>
                  <h3>QIE Pass KYC Identity</h3>
                  <p>Subscribers and merchants are verified using on-chain DIDs. Prevent sybil attacks and track identity-gated payment history securely.</p>
                </div>

                <div className="step-card">
                  <div className="step-number">02</div>
                  <div className="step-icon-wrapper">
                    <Sparkles size={24} />
                  </div>
                  <h3>Stablecoin Payment Streams</h3>
                  <p>Stream real-time value settled in qUSD stablecoins to eliminate price volatility. Setup custom cliff periods and stop-times for dynamic contracts.</p>
                </div>

                <div className="step-card">
                  <div className="step-number">03</div>
                  <div className="step-icon-wrapper">
                    <Shield size={24} />
                  </div>
                  <h3>Autonomous AI Oracle Sentry</h3>
                  <p>An autonomous AI auditor watches every stream. Upon detecting pricing exploits or abnormal billing drift, it executes contract-level pauses.</p>
                </div>
              </div>
            </section>

            {/* Feature Comparison Matrix */}
            <section className="landing-section">
              <div className="section-header">
                <h2>Standard Payments vs. Fluenci AI-Shield</h2>
                <p>Why Fluenci represents the next generation of trustless Web3 subscriptions.</p>
              </div>

              <div className="matrix-card">
                <table className="matrix-table">
                  <thead>
                    <tr>
                      <th>Feature Capability</th>
                      <th>Standard Web3 Streams</th>
                      <th className="matrix-fluenci-col">Fluenci AI-Shield</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="matrix-feature-name">Exploit / Rate Spike Protection</td>
                      <td className="matrix-standard-col">None (Streams drain completely)</td>
                      <td className="matrix-fluenci-col">Instant On-Chain AI Safety Pause</td>
                    </tr>
                    <tr>
                      <td className="matrix-feature-name">KYC/Identity Gating</td>
                      <td className="matrix-standard-col">Address only (Anonymity issues)</td>
                      <td className="matrix-fluenci-col">Gated via QIE Pass DID Verification</td>
                    </tr>
                    <tr>
                      <td className="matrix-feature-name">Dispute Resolution</td>
                      <td className="matrix-standard-col">Manual Arbitration / Legal recourse</td>
                      <td className="matrix-fluenci-col">AI-Arbitrated EIP-712 Dispute Signatures</td>
                    </tr>
                    <tr>
                      <td className="matrix-feature-name">Token Volatility Protection</td>
                      <td className="matrix-standard-col">Exposed to market fluctuations</td>
                      <td className="matrix-fluenci-col">Settled in Stablecoins (qUSD) & DEX Swaps</td>
                    </tr>
                    <tr>
                      <td className="matrix-feature-name">Subscription Model</td>
                      <td className="matrix-standard-col">Basic push transactions</td>
                      <td className="matrix-fluenci-col">Transferable Subscription NFT Streams</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer 
        style={{ 
          padding: "30px 40px", 
          borderTop: "1px solid var(--border-color)", 
          background: "rgba(7, 10, 19, 0.8)",
          textAlign: "center",
          fontSize: "0.85rem",
          color: "var(--text-muted)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          alignItems: "center"
        }}
      >
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "16px" }}>
          <span>Registry: <strong style={{ color: "var(--color-cyan)" }}>{fluenci.contracts.registry}</strong></span>
          <span>qUSDC: <strong style={{ color: "var(--color-cyan)" }}>{fluenci.contracts.qusdc}</strong></span>
          <span>WETH: <strong style={{ color: "var(--color-cyan)" }}>{fluenci.contracts.weth}</strong></span>
          <span>QiePass KYC: <strong style={{ color: "var(--color-cyan)" }}>{fluenci.contracts.qiepass}</strong></span>
          <span>AI Auditor: <strong style={{ color: "var(--color-cyan)" }}>{fluenci.contracts.auditor}</strong></span>
          <span>Qiedex: <strong style={{ color: "var(--color-cyan)" }}>{fluenci.contracts.qiedex}</strong></span>
          <span>Qiedomain: <strong style={{ color: "var(--color-cyan)" }}>{fluenci.contracts.qiedomain}</strong></span>
        </div>
        <p>© 2026 Fluenci Protocol. Built for QIE Blockchain Hackathon. All rights reserved.</p>
      </footer>

      {/* Transaction Progress Modal */}
      <TransactionModal txState={fluenci.txState} onClose={fluenci.resetTx} />
    </div>
  );
}
