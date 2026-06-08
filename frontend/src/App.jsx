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
import QiePassLogo from "./assets/qiepass.png";
import QieWalletLogo from "./assets/qiewallet.png";
import QieStableCoinLogo from "./assets/qusdc.png";
import QieDexLogo from "./assets/qiedex.png";
import "./App.css";

// Default deployment addresses
const DEFAULT_HARDHAT_CONTRACTS = {
  registry: "0x2DA9e917568D69626078df6bCb7B71F0DeDA6117",
  qusdc: "0xB64aE86dc64AEcB67a870192cDCAeC30EBd14b3b",
  qiepass: "0x774758CE0Cb704AC54f1cc0cace59d2957d8250A",
  auditor: "0x75475647f52531D4086296415392E4AA94b92de7",
  qiedex: "0xE21F69c4394dFA41FC5F31a9B994e0275B47cD34",
  qiedomain: "0x5b66380309C29D00Ff82388a856fB5e87fF09A7E"
};

// FAQ Accordion Item Component
function FAQItem({ question, answer }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="glass-card" style={{ 
      marginBottom: "12px", 
      textAlign: "left", 
      border: isOpen ? "1px solid rgba(157, 78, 221, 0.4)" : "1px solid var(--border-color)",
      background: isOpen ? "rgba(157, 78, 221, 0.02)" : "rgba(15, 20, 35, 0.5)",
      transition: "all 0.3s ease",
      borderRadius: "12px",
      overflow: "hidden"
    }}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          color: "#fff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          fontSize: "1rem",
          fontWeight: "600",
          cursor: "pointer",
          textAlign: "left"
        }}
      >
        <span>{question}</span>
        <span style={{ 
          color: "var(--color-cyan)", 
          transform: isOpen ? "rotate(45deg)" : "rotate(0deg)", 
          transition: "transform 0.2s ease",
          fontSize: "1.2rem",
          fontWeight: "bold"
        }}>+</span>
      </button>
      {isOpen && (
        <div style={{ 
          padding: "0 20px 20px 20px", 
          color: "var(--text-secondary)", 
          fontSize: "0.85rem",
          lineHeight: "1.6"
        }}>
          {answer}
        </div>
      )}
    </div>
  );
}
// Typewriter effect component — cycles through words with type-in / delete animation
function TypewriterWord({ words = [], typingSpeed = 120, deletingSpeed = 80, holdDuration = 2000 }) {
  const [wordIndex, setWordIndex] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentWord = words[wordIndex] || "";
    let timeout;

    if (!isDeleting) {
      // Typing forward
      if (displayText.length < currentWord.length) {
        timeout = setTimeout(() => {
          setDisplayText(currentWord.slice(0, displayText.length + 1));
        }, typingSpeed);
      } else {
        // Word fully typed — hold, then start deleting
        timeout = setTimeout(() => setIsDeleting(true), holdDuration);
      }
    } else {
      // Deleting backward
      if (displayText.length > 0) {
        timeout = setTimeout(() => {
          setDisplayText(displayText.slice(0, -1));
        }, deletingSpeed);
      } else {
        // Word fully deleted — move to next word
        setIsDeleting(false);
        setWordIndex((prev) => (prev + 1) % words.length);
      }
    }

    return () => clearTimeout(timeout);
  }, [displayText, isDeleting, wordIndex, words, typingSpeed, deletingSpeed, holdDuration]);

  return (
    <span style={{ position: "relative" }}>
      {displayText}
      <span style={{ 
        display: "inline-block",
        width: "3px", 
        height: "0.9em", 
        background: "var(--color-cyan)", 
        marginLeft: "2px",
        verticalAlign: "baseline",
        animation: "pulse 0.8s infinite"
      }} />
    </span>
  );
}

// Live AI Telemetry widget for Landing Page
function LandingTelemetryTerminal() {
  const [logs, setLogs] = useState([
    { type: "INFO", time: new Date().toLocaleTimeString(), text: "Fluenci AI Sentry Node Initializing..." }
  ]);
  const [activeStreams, setActiveStreams] = useState(0);
  const [systemRisk, setSystemRisk] = useState(0);
  const [serverOnline, setServerOnline] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchTelemetry = async () => {
      try {
        const res = await fetch("http://127.0.0.1:5001/telemetry");
        if (res.ok) {
          const data = await res.json();
          if (!active) return;
          
          setServerOnline(true);
          
          const logsArray = Array.isArray(data) ? data : (data.logs || []);
          const riskFromBackend = data && typeof data.systemRiskScore === 'number' ? data.systemRiskScore : null;
          const streamsFromBackend = data && typeof data.activeStreamsCount === 'number' ? data.activeStreamsCount : null;

          // Map telemetry logs to widget format with client-side anonymization safety net
          // Masks all 0x-prefixed hex strings (wallets, tx hashes, stream IDs, KYC IDs, etc.)
          const maskHex = (s) => s.replace(/0x[a-fA-F0-9]{20,}/g, (m) => `0x${m.slice(2, 6)}••••${m.slice(-4)}`);
          const formattedLogs = logsArray.map(log => ({
            type: log.type,
            time: new Date(log.timestamp).toLocaleTimeString(),
            text: maskHex(log.message || "")
          }));
          
          // Show last 7 logs
          setLogs(formattedLogs.slice(-7));

          if (riskFromBackend !== null && streamsFromBackend !== null) {
            setSystemRisk(riskFromBackend);
            setActiveStreams(streamsFromBackend);
          } else {
            // Calculate actual active streams and risk from real data
            const activeIds = new Set();
            let maxRisk = 12; // baseline
            
            logsArray.forEach(log => {
              if (log.message.includes("Captured new subscription stream")) {
                const parts = log.message.split("stream: ");
                if (parts[1]) {
                  const id = parts[1].split(".")[0];
                  activeIds.add(id);
                }
              }
              if (log.message.includes("StreamTerminated") || log.message.includes("terminated")) {
                const parts = log.message.split("stream ");
                if (parts[1]) {
                  activeIds.delete(parts[1]);
                }
              }
              if (log.details && log.details.riskScore) {
                maxRisk = Math.max(maxRisk, Number(log.details.riskScore));
              }
            });
            
            setActiveStreams(activeIds.size);
            setSystemRisk(maxRisk);
          }
        } else {
          if (active) {
            setServerOnline(false);
            setLogs([
              { type: "SYSTEM", time: new Date().toLocaleTimeString(), text: "AI Auditor node connection lost. Awaiting node startup..." }
            ]);
            setActiveStreams(0);
            setSystemRisk(0);
          }
        }
      } catch (err) {
        if (active) {
          setServerOnline(false);
          setLogs([
            { type: "SYSTEM", time: new Date().toLocaleTimeString(), text: "AI Sentry Node offline (Cannot fetch from http://localhost:5001)." },
            { type: "SYSTEM", time: new Date().toLocaleTimeString(), text: "Please start the server backend (npm start) to view real onchain telemetry." }
          ]);
          setActiveStreams(0);
          setSystemRisk(0);
        }
      }
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
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
  const [stats, setStats] = useState({
    uniqueUsersCount: 0,
    totalVolumeUSD: 0,
    totalRevenueUSD: 0,
    totalSwapVolumeUSD: 0
  });

  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      try {
        const res = await fetch("http://127.0.0.1:5001/stats");
        if (res.ok) {
          const data = await res.json();
          if (!active) return;
          setStats(data);
        }
      } catch (err) {
        console.warn("Failed to fetch stats from server.", err);
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

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
              qusdcAllowance={fluenci.qusdcAllowance}
              qiePassVerified={fluenci.qiePassVerified}
              subscriberStreams={fluenci.subscriberStreams}
              realtimeClaimables={fluenci.realtimeClaimables}
              loading={fluenci.loading}
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
              kycState={fluenci.kycState}
              checkKycStatus={fluenci.checkKycStatus}
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
            account={fluenci.account}
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

  const isSupportedNetwork = fluenci.chainId === 1990;

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
          accountDomain={fluenci.accountDomain}
          chainId={fluenci.chainId}
          connectWallet={fluenci.connectWallet}
          disconnectWallet={fluenci.disconnectWallet}
          loading={fluenci.loading}
          switchToQieMainnet={fluenci.switchToQieMainnet}
          showDashboard={viewMode === "dashboard"}
          onLaunchApp={() => setViewMode("dashboard")}
          announcedProviders={fluenci.announcedProviders}
        />
      </header>

      {/* Main Content Area */}
      <main style={{ flexGrow: 1, padding: "40px", maxWidth: "1200px", width: "100%", margin: "0 auto" }}>
        
        {/* Error alert banners */}
        {fluenci.error && (fluenci.error.includes("rpc1mainnet") || fluenci.error.includes("timed out") || fluenci.error.includes("request failed") || fluenci.error.includes("Failed to fetch") || fluenci.error.includes("coalesce") || fluenci.error.includes("32603")) ? (
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
              Your wallet is trying to reach the QIE Mainnet node but it appears to be down or unreachable.
              Please check your wallet's <strong>Custom Network settings</strong> for QIE Mainnet (Chain ID 1990)
              and ensure the RPC URL is set to <code>https://rpc1mainnet.qie.digital</code>, then try again.
              You can also click the button below to attempt an automatic network sync.
            </p>
            <button 
              className="btn btn-primary" 
              style={{ alignSelf: "flex-start", padding: "8px 16px", fontSize: "0.85rem" }}
              onClick={fluenci.switchToQieMainnet}
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
              Fluenci operates exclusively on the **QIE Mainnet (Chain ID: 1990)**. 
              Please switch your wallet network connection.
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={fluenci.switchToQieMainnet}>
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
                  Stop <TypewriterWord words={["Blind", "Rogue", "Unaudited"]} /> Streams.<br />
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

                {/* Real-time Protocol Stats Row */}
                <div style={{ 
                  display: "flex", 
                  gap: "0", 
                  marginTop: "40px", 
                  padding: "16px 0", 
                  background: "rgba(255, 255, 255, 0.02)", 
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  borderRadius: "12px",
                  maxWidth: "680px"
                }}>
                  <div style={{ flex: 1, textAlign: "center", padding: "8px 12px" }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "6px" }}>Active Users</div>
                    <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#fff", fontFamily: "monospace" }}>
                      {stats.uniqueUsersCount}
                    </div>
                  </div>
                  <div style={{ width: "1px", background: "rgba(255,255,255,0.08)", alignSelf: "stretch" }} />
                  <div style={{ flex: 1, textAlign: "center", padding: "8px 12px" }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "6px" }}>Settled Volume</div>
                    <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "var(--color-cyan)", fontFamily: "monospace" }}>
                      ${stats.totalVolumeUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div style={{ width: "1px", background: "rgba(255,255,255,0.08)", alignSelf: "stretch" }} />
                  <div style={{ flex: 1, textAlign: "center", padding: "8px 12px" }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "6px" }}>Swap Volume (DEX)</div>
                    <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "var(--color-purple)", fontFamily: "monospace" }}>
                      ${(stats.totalSwapVolumeUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div style={{ width: "1px", background: "rgba(255,255,255,0.08)", alignSelf: "stretch" }} />
                  <div style={{ flex: 1, textAlign: "center", padding: "8px 12px" }}>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: "6px" }}>App Revenue (0.5%)</div>
                    <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "var(--color-emerald)", fontFamily: "monospace" }}>
                      ${stats.totalRevenueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
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
                  <p>Subscribers and merchants are verified using onchain DIDs. Prevent sybil attacks and track identity-gated payment history securely.</p>
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

            {/* QIE Ecosystem Integrations */}
            <section className="landing-section">
              <div className="section-header">
                <h2>Native QIE Ecosystem Integrations</h2>
                <p>Fluenci leverages the power of QIE blockchain's core components to build a seamless and secure billing protocol.</p>
              </div>

              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", 
                gap: "20px" 
              }}>
                {/* QIE Pass */}
                <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px", border: "1px solid rgba(0, 242, 254, 0.15)", background: "rgba(0, 242, 254, 0.01)", borderRadius: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <img 
                      src={QiePassLogo} 
                      alt="QIE Pass Logo" 
                      style={{ 
                        height: "28px", 
                        objectFit: "contain"
                      }} 
                    />
                    <h3 style={{ fontSize: "1.05rem", margin: 0, color: "#fff", fontWeight: "600" }}>QIE Pass</h3>
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
                    Digital identity and access management system. Verifies users via DID verification to prevent sybil attacks and enforce compliance.
                  </p>
                </div>

                {/* QIE Wallet */}
                <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px", border: "1px solid rgba(167, 139, 250, 0.15)", background: "rgba(167, 139, 250, 0.01)", borderRadius: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <img 
                      src={QieWalletLogo} 
                      alt="QIE Wallet Logo" 
                      style={{ 
                        height: "28px", 
                        objectFit: "contain"
                      }} 
                    />
                    <h3 style={{ fontSize: "1.05rem", margin: 0, color: "#fff", fontWeight: "600" }}>QIE Wallet</h3>
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
                    Secure, user-friendly wallet for managing native tokens. Directly integrated with gas overrides and smooth, hang-free signatures.
                  </p>
                </div>

                {/* QIE Stable Coin (qUSDC) */}
                <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px", border: "1px solid rgba(244, 63, 94, 0.15)", background: "rgba(244, 63, 94, 0.01)", borderRadius: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <img 
                      src={QieStableCoinLogo} 
                      alt="QIE Stable Coin Logo" 
                      style={{ 
                        height: "28px", 
                        objectFit: "contain"
                      }} 
                    />
                    <h3 style={{ fontSize: "1.05rem", margin: 0, color: "#fff", fontWeight: "600" }}>QIE Stable Coin</h3>
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
                    Stable digital currency backed by the QIE ecosystem. Settles payment streams in real-time to eliminate token price volatility.
                  </p>
                </div>

                {/* QIEDex */}
                <div className="glass-card" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "12px", border: "1px solid rgba(16, 185, 129, 0.15)", background: "rgba(16, 185, 129, 0.01)", borderRadius: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <img 
                      src={QieDexLogo} 
                      alt="QIE Dex Logo" 
                      style={{ 
                        height: "28px", 
                        objectFit: "contain"
                      }} 
                    />
                    <h3 style={{ fontSize: "1.05rem", margin: 0, color: "#fff", fontWeight: "600" }}>QIE Dex</h3>
                  </div>
                  <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
                    Decentralized exchange for trading tokens. Integrated dual-direction swaps allow continuous conversion of QIE to qUSDC.
                  </p>
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
                      <td className="matrix-fluenci-col">Instant onchain AI Safety Pause</td>
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

            {/* FAQ Accordion Section */}
            <section className="landing-section" style={{ maxWidth: "800px", margin: "0 auto" }}>
              <div className="section-header" style={{ textAlign: "center" }}>
                <h2>Frequently Asked Questions</h2>
                <p>Everything you need to know about the Fluenci protocol and how the AI sentries protect your assets.</p>
              </div>
              
              <FAQItem 
                question="How does the autonomous AI Sentry Node pause streaming exploits?"
                answer="The offchain Sentry Agent continuously monitors the blockchain for new stream creations. When a stream is detected, the Analyst Agent uses reputation checkers and heuristics to determine if the rate is safe. If the velocity is dangerously high (e.g. attempting to drain the subscriber's balance), the Decision Agent signs a safety-pause transaction and broadcasts it to lock the stream onchain until it is verified."
              />
              <FAQItem 
                question="Why are payment streams minted as transferable NFTs?"
                answer="Fluenci represents each streaming payment agreement as an ERC-721 Subscription NFT. This allows users to trade, gift, or delegate their subscriptions. When the NFT is transferred, the smart contract automatically shifts the billing obligation to the new owner's wallet address, enabling tradeable recurring memberships."
              />
              <FAQItem 
                question="How does AI-arbitrated dispute resolution work?"
                answer="If a subscriber opens a dispute, the stream is paused. The offchain Arbitrator Agent evaluates the text evidence provided by both parties, determines a fair split of the accrued tokens, and signs an EIP-712 cryptographic message containing the resolution. The smart contract validates the AI's signature onchain to unlock and distribute the funds securely."
              />
              <FAQItem 
                question="Do I need to deposit all my subscription funds upfront?"
                answer="No. Fluenci uses a pull-based payment model. Creating a subscription stream does not lock up your funds. Instead, it authorizes the merchant to pull accrued funds from your wallet in real-time. You only need to maintain a balance of qUSDC in your wallet to cover the continuous claims."
              />
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
