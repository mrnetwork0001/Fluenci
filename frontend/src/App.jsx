import React, { useState, useEffect, useRef } from "react";
import { useFluenci } from "./hooks/useFluenci";
import ConnectWallet from "./components/ConnectWallet";
import SubscriberPanel from "./components/SubscriberPanel";
import MerchantDashboard from "./components/MerchantDashboard";
import AISecurityDesk from "./components/AISecurityDesk";
import { QieDoodleGame } from "./components/QieDoodleGame";
import FluenciDocs from "./components/FluenciDocs";
import BlogPage from "./components/BlogPage";
import TransactionModal from "./components/TransactionModal";
import { Shield, Sparkles, Building2, UserCircle, Terminal, HelpCircle, Activity, X, Wallet, CheckCircle, LogOut, FileText, AlertTriangle, ChevronDown, ChevronUp, Clock, HardDrive, Info } from "lucide-react";
import LogoImage from "./assets/logo.png";
import QiePassLogo from "./assets/qiepass.png";
import QieWalletLogo from "./assets/qiewallet.png";
import QieStableCoinLogo from "./assets/qusdc.png";
import QieDexLogo from "./assets/qiedex.png";
import QieIdLogo from "./assets/qie-id.svg";
import QieLogoImage from "./assets/qie-logo.png";
import "./App.css";
import DashboardV2 from "./dashboard/DashboardV2";
import { V4_CONFIGURED } from "./dashboard/v4Config";
import { API_BASE_URL, V2_BUILD_NOTICE } from "./config";

// Default deployment addresses
const DEFAULT_HARDHAT_CONTRACTS = {
  registry: "0x2DA9e917568D69626078df6bCb7B71F0DeDA6117",
  qusdc: "0xB64aE86dc64AEcB67a870192cDCAeC30EBd14b3b",
  qiepass: "0x774758CE0Cb704AC54f1cc0cace59d2957d8250A",
  auditor: "0x75475647f52531D4086296415392E4AA94b92de7",
  qiedex: "0xE21F69c4394dFA41FC5F31a9B994e0275B47cD34",
  fluenciRouter: "",
  qiedomain: "0x5b66380309C29D00Ff82388a856fB5e87fF09A7E"
};

// FAQ Accordion Item Component
function FAQItem({ question, answer, index, isOpen, onToggle }) {
  return (
    <div className="faq-item" style={{ 
      borderBottom: "1px solid #1a1a1a",
      transition: "all 0.3s ease"
    }}>
      <button 
        onClick={onToggle}
        className="faq-question-btn"
        style={{
          width: "100%",
          background: "none",
          border: "none",
          color: "#ffffff",
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "22px 0",
          fontSize: "0.95rem",
          fontWeight: "500",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "'Montserrat', sans-serif",
          letterSpacing: "-0.01em"
        }}
      >
        <span style={{
          color: "#333333",
          fontSize: "0.8rem",
          fontWeight: "700",
          fontFamily: "monospace",
          minWidth: "28px"
        }}>
          {String(index).padStart(2, "0")}
        </span>
        <span style={{ flex: 1 }}>{question}</span>
        <span style={{ 
          color: "#555555", 
          transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", 
          transition: "transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)",
          fontSize: "0.75rem",
          flexShrink: 0
        }}>▼</span>
      </button>
      <div style={{ 
        maxHeight: isOpen ? "300px" : "0px",
        overflow: "hidden",
        transition: "max-height 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease",
        opacity: isOpen ? 1 : 0
      }}>
        <div style={{ 
          padding: "0 0 22px 44px", 
          color: "#777777", 
          fontSize: "0.88rem",
          lineHeight: "1.75",
          maxWidth: "620px"
        }}>
          {answer}
        </div>
      </div>
    </div>
  );
}
// Typewriter effect component - cycles through words with type-in / delete animation
const QIE_ECOSYSTEM = [
                  { logo: QiePassLogo, name: "QIE Pass", desc: "QIE's identity system. Merchants need a verified Pass to withdraw; subscribers do not need one to subscribe. Fluenci records Pass status through an oracle it operates.", accent: "0, 242, 254" },
                  { logo: QieWalletLogo, name: "QIE Wallet", desc: "Secure, user-friendly wallet for managing native tokens. Integrated with gas overrides and smooth signatures.", accent: "167, 139, 250" },
                  { logo: QieStableCoinLogo, name: "QIE Stable Coin", desc: "Stable digital currency backed by the QIE ecosystem. Settles payment streams in real-time to eliminate price volatility.", accent: "244, 63, 94" },
                  { logo: QieLogoImage, name: "QIE Reputation", desc: "Wallet scores computed offchain by QIE. Fluenci verifies a signed score and stores only the result, never KYC data. Awaiting QIE's signing key.", accent: "245, 158, 11" },
                  { logo: QieDexLogo, name: "QIE Dex", desc: "Decentralized exchange for trading tokens. Integrated dual-direction swaps for continuous QIE to qUSDC conversion.", accent: "16, 185, 129" },
                  { logo: QieIdLogo, name: "QIE ID", desc: "Human-readable identity for a wallet. Fluenci resolves a .qie name to an address, and an address back to its primary name, in one call.", accent: "236, 72, 153" }
];

const HERO_TYPEWRITER_WORDS = ["Read", "Cap", "Cancel"];

function TypewriterWord({ words = HERO_TYPEWRITER_WORDS, typingSpeed = 120, deletingSpeed = 80, holdDuration = 2000 }) {
  const wordsRef = useRef(words);
  const [wordIndex, setWordIndex] = useState(0);
  const [displayText, setDisplayText] = useState(wordsRef.current[0] || "");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isHolding, setIsHolding] = useState(true);

  useEffect(() => {
    const currentWord = wordsRef.current[wordIndex] || "";
    let timeout;

    if (isHolding) {
      // Initial hold on first word before starting the cycle
      timeout = setTimeout(() => {
        setIsHolding(false);
        setIsDeleting(true);
      }, holdDuration);
    } else if (!isDeleting) {
      // Typing forward
      if (displayText.length < currentWord.length) {
        timeout = setTimeout(() => {
          setDisplayText(currentWord.slice(0, displayText.length + 1));
        }, typingSpeed);
      } else {
        // Word fully typed - hold, then start deleting
        timeout = setTimeout(() => setIsDeleting(true), holdDuration);
      }
    } else {
      // Deleting backward
      if (displayText.length > 0) {
        timeout = setTimeout(() => {
          setDisplayText(displayText.slice(0, -1));
        }, deletingSpeed);
      } else {
        // Word fully deleted - move to next word and start typing
        setIsDeleting(false);
        setWordIndex((prev) => (prev + 1) % wordsRef.current.length);
      }
    }

    return () => clearTimeout(timeout);
  }, [displayText, isDeleting, isHolding, wordIndex, typingSpeed, deletingSpeed, holdDuration]);

  return (
    <span style={{ 
      position: "relative", 
      color: "#2563eb",
      WebkitTextFillColor: "#2563eb",
      background: "none",
      WebkitBackgroundClip: "unset"
    }}>
      {displayText}
      <span style={{ 
        display: "inline-block",
        width: "3px", 
        height: "0.85em", 
        background: "#2563eb", 
        marginLeft: "2px",
        verticalAlign: "baseline",
        animation: "pulse 0.8s infinite"
      }} />
    </span>
  );
}

// v2 build notice - restored from 38f4c60 (CSS for .qie-upgrade-* is still in index.css),
// recolored from outage-amber to brand cyan and rewritten for the v2 rebuild.
function BuildNoticeBanner() {
  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return localStorage.getItem("fluenci_v2_build_notice_dismissed") === "true";
    } catch (e) {
      return false;
    }
  });
  const [isExpanded, setIsExpanded] = useState(() => {
    try {
      return localStorage.getItem("fluenci_v2_build_notice_expanded") === "true";
    } catch (e) {
      return false;
    }
  });

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      localStorage.setItem("fluenci_v2_build_notice_dismissed", "true");
    } catch (e) {}
  };

  const handleRestore = () => {
    setIsDismissed(false);
    try {
      localStorage.setItem("fluenci_v2_build_notice_dismissed", "false");
    } catch (e) {}
  };

  const toggleExpand = () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    try {
      localStorage.setItem("fluenci_v2_build_notice_expanded", String(nextState));
    } catch (e) {}
  };

  if (isDismissed) {
    return (
      <div className="qie-upgrade-floating-trigger" onClick={handleRestore} title="Show Fluenci v2 build notice">
        <Sparkles size={14} />
        <span>v2 In Progress</span>
      </div>
    );
  }

  return (
    <div className="qie-upgrade-banner">
      <div className="qie-upgrade-content" style={{ flexDirection: "column", alignItems: "stretch", gap: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px", flexWrap: "wrap" }}>
          <div className="qie-upgrade-main">
            <div className="qie-upgrade-icon-wrapper">
              <Sparkles size={18} color="#079AB7" />
            </div>
            <div className="qie-upgrade-text-block">
              <div className="qie-upgrade-title">
                Fluenci v2 is being built right now
                <span className="pill-badge" style={{ padding: "2px 8px", fontSize: "0.68rem", background: "rgba(7, 154, 183, 0.15)", color: "#079AB7", border: "1px solid rgba(7, 154, 183, 0.3)", borderRadius: "20px", fontWeight: "700", marginLeft: "8px" }}>V2 IN PROGRESS</span>
              </div>
              <div className="qie-upgrade-desc">
                v1 is live on this site and settling real streams on QIE mainnet - we're rebuilding the streaming registry and dashboard against a new integration spec, and v2 deploys to this domain the day the contracts land.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button className="qie-upgrade-details-toggle" onClick={toggleExpand}>
              {isExpanded ? (
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>Hide Details <ChevronUp size={12} /></span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>Show Details <ChevronDown size={12} /></span>
              )}
            </button>
            <button className="qie-upgrade-close" onClick={handleDismiss} title="Dismiss notice">
              <X size={16} />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="qie-upgrade-detail-panel">
            <div className="qie-upgrade-detail-item">
              <strong style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <CheckCircle size={12} />
                Live now
              </strong>
              <span>Connect a wallet and explore the full v1 dashboard, AI Security Desk and merchant flows. Everything you see is the shipped product, running against QIE mainnet.</span>
            </div>
            <div className="qie-upgrade-detail-item">
              <strong style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Clock size={12} />
                Paused
              </strong>
              <span>New stream creation on the v1 registry is off while we migrate contracts. Existing streams keep settling normally.</span>
            </div>
            <div className="qie-upgrade-detail-item">
              <strong style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <Info size={12} />
                Next
              </strong>
              <span>v2 brings the new registry, updated settlement logic and the integration spec's endpoints. Same domain, no migration for you.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Live AI Telemetry widget for Landing Page
function LandingTelemetryTerminal() {
  const [logs, setLogs] = useState([
    { type: "INFO", time: new Date().toLocaleTimeString(), text: "Fluenci Protect initialising..." }
  ]);
  const [activeStreams, setActiveStreams] = useState(0);
  const [systemRisk, setSystemRisk] = useState(0);
  const [serverOnline, setServerOnline] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchTelemetry = async () => {
      if (!API_BASE_URL) return;
      try {
        const res = await fetch(`${API_BASE_URL}/telemetry`);
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
            { type: "SYSTEM", time: new Date().toLocaleTimeString(), text: `Fluenci Protect offline (cannot reach ${API_BASE_URL}).` },
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

  const getLogBadgeStyle = (type) => {
    switch (type) {
      case "ALERT": return { background: "rgba(239, 68, 68, 0.15)", color: "#f87171", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" };
      case "ACTION": return { background: "rgba(245, 158, 11, 0.15)", color: "#fbbf24", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" };
      case "SUCCESS": return { background: "rgba(16, 185, 129, 0.15)", color: "#34d399", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" };
      case "AUDIT": return { background: "rgba(59, 130, 246, 0.15)", color: "#60a5fa", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" };
      default: return { background: "rgba(113, 113, 122, 0.15)", color: "#a1a1aa", padding: "2px 6px", borderRadius: "4px", fontWeight: "bold" };
    }
  };

  const latestLog = logs.length > 0 ? logs[logs.length - 1] : { text: "Monitoring recurring streams on QIE Mainnet. System secured.", type: "INFO" };

  return (
    <div className="copilot-card">
      <div className="copilot-header">
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Sparkles size={14} color="#c084fc" />
          <span style={{ fontWeight: "700", fontSize: "0.8rem", color: "#ffffff", fontFamily: "'Montserrat', sans-serif" }}>Copilot</span>
        </div>
        <X size={14} style={{ opacity: 0.5, color: "#ffffff" }} />
      </div>
      <div className="copilot-tabs">
        <span className="copilot-tab active">Protect</span>
        <span className="copilot-tab" style={{ color: "#a1a1aa" }}>Live Risk: <strong style={{ color: systemRisk > 40 ? '#f87171' : '#34d399' }}>{systemRisk}%</strong></span>
      </div>
      <div className="copilot-list">
        {/* Active Stream Alert Card */}
        <div className="copilot-item active-source">
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <div className="copilot-avatar purple">
              <Shield size={12} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: "700", fontSize: "0.75rem", color: "#ffffff" }}>
                  {systemRisk > 40 ? "Anomaly Blocked" : "Active Monitor"}
                </span>
                <span className={systemRisk > 40 ? "pill-badge red" : "pill-badge green"}>
                  {systemRisk > 40 ? "Exploit paused" : "Shield active"}
                </span>
              </div>
              <p style={{ fontSize: "0.65rem", color: "#a1a1aa", marginTop: "4px", lineHeight: "1.3" }}>
                {latestLog.text}
              </p>
            </div>
          </div>
        </div>

        {/* Secondary Info Card */}
        <div className="copilot-item">
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <div className="copilot-avatar">
              <Activity size={12} color="#10b981" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: "700", fontSize: "0.75rem", color: "#ffffff" }}>Protocol Streams</span>
                <span className="pill-badge green" style={{ background: "rgba(16, 185, 129, 0.1)", color: "#34d399" }}>
                  {activeStreams} Active
                </span>
              </div>
              <p style={{ fontSize: "0.65rem", color: "#a1a1aa", marginTop: "4px", lineHeight: "1.3" }}>
                Protect is watching every active subscription for anomalies.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const IS_LAUNCHED = true;
const LAUNCH_DATE_MS = new Date("2026-06-14T07:00:00Z").getTime();
const PREVIEW_SECRET = import.meta.env.VITE_PREVIEW_SECRET || "mrnetwork419";

export default function App() {
  const fluenci = useFluenci();
  // URL-based routing: parse initial path
  const getInitialRoute = () => {
    const path = window.location.pathname.replace(/^\/+/, '').toLowerCase();
    // Payment links: fluenci.xyz/pay/<merchant.qie> opens the subscribe form
    // pre-filled with that merchant, which auto-resolves.
    if (path.startsWith('pay/') && path.length > 4) {
      return { view: 'v2', tab: 'subscriber', role: 'subscriber', v2tab: 'subscriptions', payMerchant: path.slice(4) };
    }
    switch (path) {
      case 'blog': return { view: 'blog', tab: 'subscriber' };
      // The v2 dashboard takes over the real routes once a v4 registry is
      // configured. Until then production keeps serving v1, which is the UI
      // that actually reads the deployed v3 contracts. Cutover is one env var.
      case 'subscription': return V4_CONFIGURED
        ? { view: 'v2', tab: 'subscriber', role: 'subscriber', v2tab: 'dashboard' }
        : { view: 'dashboard', tab: 'subscriber' };
      case 'merchants': return V4_CONFIGURED
        ? { view: 'v2', tab: 'merchant', role: 'merchant', v2tab: 'dashboard' }
        : { view: 'dashboard', tab: 'merchant' };
      case 'security': return V4_CONFIGURED
        ? { view: 'v2', tab: 'security', role: 'subscriber', v2tab: 'protect' }
        : { view: 'dashboard', tab: 'security' };
      case 'dashboard': return V4_CONFIGURED
        ? { view: 'v2', tab: 'subscriber', role: 'subscriber', v2tab: 'dashboard' }
        : { view: 'dashboard', tab: 'subscriber' };
      case 'swap': return { view: 'v2', tab: 'subscriber', role: 'subscriber', v2tab: 'swap' };
      case 'limits': return { view: 'v2', tab: 'subscriber', role: 'subscriber', v2tab: 'limits' };
      case 'docs': return { view: 'dashboard', tab: 'docs' };
      // Escape hatches: /v1 always the old dashboard, /v2 always the new one.
      case 'v1': return { view: 'dashboard', tab: 'subscriber' };
      case 'v2': return { view: 'v2', tab: 'subscriber', role: 'subscriber', v2tab: 'dashboard' };
      default: return { view: 'landing', tab: 'subscriber' };
    }
  };
  const initialRoute = getInitialRoute();
  const [activeTab, setActiveTab] = useState(initialRoute.tab);
  const [viewMode, setViewMode] = useState(initialRoute.view);
  const [activeFaqIndex, setActiveFaqIndex] = useState(null);
  // On mobile the marquee stops animating and becomes a real scroller, so the
  // arrows move it by one card rather than fighting a CSS animation.
  const ecosystemTrackRef = useRef(null);
  const scrollEcosystem = (dir) => {
    const el = ecosystemTrackRef.current;
    if (!el) return;
    const card = el.querySelector(".ecosystem-card");
    const step = card ? card.getBoundingClientRect().width + 20 : 300;
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  };
  const [isWalletModalOpen, setWalletModalOpen] = useState(false);
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDashMenuOpen, setDashMenuOpen] = useState(false);
  const prevAccountRef = useRef(fluenci.account);
  const cardRef = useRef(null);

  const [timeRemaining, setTimeRemaining] = useState(() => LAUNCH_DATE_MS - Date.now());
  const [isBypassed, setIsBypassed] = useState(() => {
    try {
      return localStorage.getItem("fluenci_preview_bypass") === PREVIEW_SECRET;
    } catch (e) {
      return false;
    }
  });

  // Check URL query parameters for bypass: ?preview=SECRET
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview") === PREVIEW_SECRET) {
      try {
        localStorage.setItem("fluenci_preview_bypass", PREVIEW_SECRET);
      } catch (e) {}
      setIsBypassed(true);
    }
  }, []);

  // Sync URL when viewMode or activeTab changes
  useEffect(() => {
    window.scrollTo(0, 0);
    let targetPath = '/';
    if (viewMode === 'blog') {
      targetPath = '/blog';
    } else if (viewMode === 'v2') {
      // v2 owns its own sub-navigation and pushes its own paths; only the
      // entry path is set here, and anything under it is left alone.
      const entry = activeTab === 'merchant' ? '/merchants' : '/subscription';
      targetPath = ['/subscription', '/merchants', '/security', '/swap', '/limits', '/v2']
        .includes(window.location.pathname) ? window.location.pathname : entry;
    } else if (viewMode === 'dashboard') {
      switch (activeTab) {
        case 'subscriber': targetPath = '/subscription'; break;
        case 'merchant': targetPath = '/merchants'; break;
        case 'security': targetPath = '/security'; break;
        case 'docs': targetPath = '/docs'; break;
        default: targetPath = '/dashboard';
      }
    }
    if (window.location.pathname !== targetPath) {
      window.history.pushState({ viewMode, activeTab }, '', targetPath);
    }
  }, [viewMode, activeTab]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = (e) => {
      if (e.state && e.state.viewMode) {
        setViewMode(e.state.viewMode);
        if (e.state.activeTab) setActiveTab(e.state.activeTab);
      } else {
        const route = getInitialRoute();
        setViewMode(route.view);
        setActiveTab(route.tab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Update countdown clock
  useEffect(() => {
    if (timeRemaining <= 0) return;
    const interval = setInterval(() => {
      const remaining = LAUNCH_DATE_MS - Date.now();
      setTimeRemaining(remaining <= 0 ? 0 : remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [timeRemaining]);

  const formatTimeRemaining = (ms) => {
    if (ms <= 0) return "00h : 00m : 00s";
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${String(hrs).padStart(2, "0")}h : ${String(mins).padStart(2, "0")}m : ${String(secs).padStart(2, "0")}s`;
  };

  const handleConnectClick = () => {
    const qieProvider = fluenci.announcedProviders.find(
      (p) => p.info.name.toLowerCase().includes("qie") || p.info.rdns.toLowerCase().includes("qie")
    );
    const hasQieInjected = window.ethereum && (
      window.ethereum.isQieWallet || 
      window.ethereum.isQIE || 
      (window.ethereum.providers && window.ethereum.providers.some(p => p.isQieWallet || p.isQIE))
    );

    if (qieProvider || hasQieInjected) {
      // QIE Wallet detected (extension or injected) - connect directly
      fluenci.connectWallet(qieProvider || null);
    } else if (window.ethereum) {
      // Mobile in-app browser (Zerion, MetaMask, Trust, etc.) - connect to injected provider
      fluenci.connectWallet(null);
    } else {
      // No provider at all - show modal for WalletConnect / install links
      setWalletModalOpen(true);
    }
  };

  // Typewriter effect for hero title
  const heroWords = ["Read", "Cap", "Cancel"];
  const [heroWordIndex, setHeroWordIndex] = useState(0);
  const [heroDisplay, setHeroDisplay] = useState("");
  const [heroTyping, setHeroTyping] = useState(true); // true = typing, false = deleting

  useEffect(() => {
    const word = heroWords[heroWordIndex];
    let timeout;
    if (heroTyping) {
      if (heroDisplay.length < word.length) {
        timeout = setTimeout(() => setHeroDisplay(word.slice(0, heroDisplay.length + 1)), 120);
      } else {
        timeout = setTimeout(() => setHeroTyping(false), 2000); // pause before deleting
      }
    } else {
      if (heroDisplay.length > 0) {
        timeout = setTimeout(() => setHeroDisplay(heroDisplay.slice(0, -1)), 80);
      } else {
        setHeroWordIndex((heroWordIndex + 1) % heroWords.length);
        setHeroTyping(true);
      }
    }
    return () => clearTimeout(timeout);
  }, [heroDisplay, heroTyping, heroWordIndex]);

  const handleCardMouseMove = (e) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const rotateX = -y / 6;
    const rotateY = x / 6;
    card.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  };

  const handleCardMouseLeave = () => {
    const card = cardRef.current;
    if (card) {
      card.style.transform = "rotateX(20deg) rotateY(-15deg)";
    }
  };

  useEffect(() => {
    if (viewMode !== "landing") return;
    
    const timer = setTimeout(() => {
      if (!window.gsap || !window.SplitType) return;
      
      try {
        window.gsap.registerPlugin(window.ScrollTrigger);
        
        const splitText = new window.SplitType(".split-lines", {
          types: "lines"
        });
        
        const lines = document.querySelectorAll(".split-lines .line");
        lines.forEach(line => {
          if (!line.querySelector(".line-mask")) {
            const mask = document.createElement("div");
            mask.className = "line-mask";
            line.appendChild(mask);
          }
        });
        
        const lineElements = document.querySelectorAll(".split-lines .line");
        lineElements.forEach(line => {
          const mask = line.querySelector(".line-mask");
          if (mask) {
            window.gsap.to(mask, {
              width: "0%",
              scrollTrigger: {
                trigger: line,
                start: "top 85%",
                end: "bottom 70%",
                scrub: true
              }
            });
          }
        });
      } catch (err) {
        console.warn("GSAP/SplitType animation setup failed:", err);
      }
    }, 400);
    
    return () => {
      clearTimeout(timer);
      if (window.ScrollTrigger) {
        try {
          window.ScrollTrigger.getAll().forEach(t => t.kill());
        } catch (e) {}
      }
    };
  }, [viewMode]);

  const [stats, setStats] = useState({
    uniqueUsersCount: 0,
    totalVolumeUSD: 0,
    totalRevenueUSD: 0,
    streamsCreatedCount: 0,
    totalSwapVolumeUSD: 0
  });

  useEffect(() => {
    let active = true;
    const fetchStats = async () => {
      if (!API_BASE_URL) return;
      try {
        const res = await fetch(`${API_BASE_URL}/stats`);
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
    const interval = setInterval(fetchStats, 5000);
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
    if (!prevAccountRef.current && fluenci.account && (IS_LAUNCHED || isBypassed)) {
      setViewMode(V4_CONFIGURED ? "v2" : "dashboard");
    }
    prevAccountRef.current = fluenci.account;
  }, [fluenci.account, isBypassed]);

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
              resolveQieDomain={fluenci.resolveQieDomain}
            />
            
            <QieDoodleGame
              account={fluenci.account}
              subscriberStreams={fluenci.subscriberStreams}
              createSubscription={fluenci.createSubscription}
              terminateStream={fluenci.terminateStream}
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
      case "docs":
        return (
          <FluenciDocs />
        );
      default:
        return null;
    }
  };

  const formatTimeRemainingComponents = (ms) => {
    if (ms <= 0) {
      return (
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "16px 20px", minWidth: "72px" }}>00</div>
            <div style={{ fontSize: "0.68rem", color: "#555", marginTop: "6px", textTransform: "uppercase", fontWeight: "700" }}>Hrs</div>
          </div>
          <span style={{ color: "rgba(255,255,255,0.15)", alignSelf: "center", fontSize: "2rem", marginBottom: "20px" }}>:</span>
          <div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "16px 20px", minWidth: "72px" }}>00</div>
            <div style={{ fontSize: "0.68rem", color: "#555", marginTop: "6px", textTransform: "uppercase", fontWeight: "700" }}>Min</div>
          </div>
          <span style={{ color: "rgba(255,255,255,0.15)", alignSelf: "center", fontSize: "2rem", marginBottom: "20px" }}>:</span>
          <div>
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "16px 20px", minWidth: "72px" }}>00</div>
            <div style={{ fontSize: "0.68rem", color: "#555", marginTop: "6px", textTransform: "uppercase", fontWeight: "700" }}>Sec</div>
          </div>
        </div>
      );
    }
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    
    const hStr = String(hrs).padStart(2, "0");
    const mStr = String(mins).padStart(2, "0");
    const sStr = String(secs).padStart(2, "0");

    return (
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "16px 20px", minWidth: "72px" }}>{hStr}</div>
          <div style={{ fontSize: "0.68rem", color: "#555", marginTop: "6px", textTransform: "uppercase", fontWeight: "700" }}>Hrs</div>
        </div>
        <span style={{ color: "rgba(255,255,255,0.15)", alignSelf: "center", fontSize: "2rem", marginBottom: "20px" }}>:</span>
        <div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "16px 20px", minWidth: "72px" }}>{mStr}</div>
          <div style={{ fontSize: "0.68rem", color: "#555", marginTop: "6px", textTransform: "uppercase", fontWeight: "700" }}>Min</div>
        </div>
        <span style={{ color: "rgba(255,255,255,0.15)", alignSelf: "center", fontSize: "2rem", marginBottom: "20px" }}>:</span>
        <div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "16px 20px", minWidth: "72px" }}>{sStr}</div>
          <div style={{ fontSize: "0.68rem", color: "#555", marginTop: "6px", textTransform: "uppercase", fontWeight: "700" }}>Sec</div>
        </div>
      </div>
    );
  };

  // Every "Launch App" affordance goes through here, so the landing page can
  // never disagree with the URL router about which dashboard is current.
  const launchApp = (tab = "subscriber") => {
    if (V4_CONFIGURED) {
      setViewMode("v2");
      setActiveTab(tab);
      window.history.pushState({}, "", tab === "merchant" ? "/merchants" : "/subscription");
    } else {
      setViewMode("dashboard");
      setActiveTab(tab);
    }
  };

  const goHome = () => {
    setViewMode("landing");
    window.history.pushState({}, "", "/");
  };

  const isSupportedNetwork = fluenci.chainId === 1990;

  if (!IS_LAUNCHED && !isBypassed) {
    return (
      <div style={{ 
        minHeight: "100vh", 
        display: "flex", 
        flexDirection: "column", 
        alignItems: "center", 
        justifyContent: "center", 
        background: "#000000",
        color: "#ffffff",
        fontFamily: "'Inter', sans-serif",
        position: "relative",
        overflow: "hidden"
      }}>
        {/* Glowing background meshes */}
        <div style={{
          position: "absolute",
          top: "20%",
          left: "30%",
          width: "400px",
          height: "400px",
          background: "radial-gradient(circle, rgba(7, 154, 183, 0.15) 0%, rgba(0,0,0,0) 70%)",
          filter: "blur(60px)",
          pointerEvents: "none"
        }} />
        <div style={{
          position: "absolute",
          bottom: "20%",
          right: "25%",
          width: "350px",
          height: "350px",
          background: "radial-gradient(circle, rgba(37, 99, 235, 0.12) 0%, rgba(0,0,0,0) 70%)",
          filter: "blur(50px)",
          pointerEvents: "none"
        }} />

        <div className="glass-card" style={{ 
          zIndex: 1, 
          padding: "48px 32px", 
          borderRadius: "24px", 
          border: "1px solid rgba(255, 255, 255, 0.08)", 
          background: "rgba(255, 255, 255, 0.02)", 
          backdropFilter: "blur(20px)",
          textAlign: "center",
          maxWidth: "520px",
          width: "90%",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5)"
        }}>
          <img src={LogoImage} alt="Fluenci" style={{ width: "64px", height: "64px", borderRadius: "16px", marginBottom: "20px" }} />
          <h1 style={{ fontSize: "2.5rem", fontWeight: "900", margin: "0 0 10px 0", letterSpacing: "-0.03em", fontFamily: "'Montserrat', sans-serif" }}>Fluenci</h1>
          <p style={{ color: "#888888", fontSize: "0.95rem", margin: "0 0 40px 0" }}>Stripe-style subscriptions for Web3, on QIE Blockchain</p>
          
          <div style={{ fontSize: "0.75rem", color: "#079AB7", textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: "700", marginBottom: "16px" }}>
            Public Launch In
          </div>
          
          <div style={{ 
            fontSize: "3.2rem", 
            fontWeight: "800", 
            fontFamily: "monospace", 
            letterSpacing: "0.02em", 
            color: "#ffffff",
            display: "flex",
            justifyContent: "center",
            gap: "16px",
            textShadow: "0 0 20px rgba(7, 154, 183, 0.3)"
          }}>
            {formatTimeRemainingComponents(timeRemaining)}
          </div>
        </div>

        <div style={{ position: "absolute", bottom: "40px", fontSize: "0.78rem", color: "#444444" }}>
          © 2026 Fluenci Protocol. All rights reserved.
        </div>
      </div>
    );
  }

  if (viewMode === "v2") {
    return (
      <DashboardV2
        fluenci={fluenci}
        initialRole={initialRoute.role || "subscriber"}
        initialTab={initialRoute.v2tab || "dashboard"}
        payMerchant={initialRoute.payMerchant || ""}
        onHome={goHome}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: viewMode === "landing" ? "#000000" : "#f5f5f5" }}>
      {V2_BUILD_NOTICE && <BuildNoticeBanner />}
      {/* Navbar */}
      <header 
        className={viewMode === "landing" ? "landing-header" : "dashboard-header"}
        style={viewMode === "landing" ? { 
          padding: "20px 40px", 
          borderBottom: "none", 
          background: "rgba(255, 255, 255, 1)",
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          position: "sticky",
          top: 0,
          zIndex: 100
        } : { 
          padding: "20px 40px", 
          borderBottom: "1px solid #e5e5e5", 
          background: "#ffffff",
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
            style={viewMode === "landing" ? { 
              width: "42px", 
              height: "42px", 
              borderRadius: "50%",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
              border: "1px solid #e2e8f0"
            } : { 
              width: "42px", 
              height: "42px", 
              borderRadius: "10px",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
              border: "1px solid #e2e8f0"
            }} 
          />
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: "900", color: "#000000", lineHeight: "1.2", fontFamily: "'Montserrat', sans-serif" }}>
              Fluenci
            </h1>
            {viewMode !== "landing" && (
              <span className="dashboard-subtitle" style={{ fontSize: "0.72rem", color: "#888888", fontWeight: "600", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                Subscriptions on QIE Blockchain
              </span>
            )}
          </div>
        </div>

        {/* Center Links for Landing Page & Blog */}
        {(viewMode === "landing" || viewMode === "blog") && (
          <>
            <nav className="landing-nav">
              <a href="#features" style={{ color: "#111111", textDecoration: "none", fontWeight: "600", fontSize: "0.9rem", fontFamily: "'Montserrat', sans-serif" }}>Features</a>
              <a href="#how-it-works" style={{ color: "#111111", textDecoration: "none", fontWeight: "600", fontSize: "0.9rem", fontFamily: "'Montserrat', sans-serif" }}>How it works</a>
              <a href="#arbitration" style={{ color: "#111111", textDecoration: "none", fontWeight: "600", fontSize: "0.9rem", fontFamily: "'Montserrat', sans-serif" }}>Protect</a>
              <a href="#comparison" style={{ color: "#111111", textDecoration: "none", fontWeight: "600", fontSize: "0.9rem", fontFamily: "'Montserrat', sans-serif" }}>Comparison</a>
              <a href="#faq" style={{ color: "#111111", textDecoration: "none", fontWeight: "600", fontSize: "0.9rem", fontFamily: "'Montserrat', sans-serif" }}>FAQ</a>
              <a href="#" onClick={(e) => { e.preventDefault(); setViewMode('blog'); }} style={{ color: "#111111", textDecoration: "none", fontWeight: "600", fontSize: "0.9rem", fontFamily: "'Montserrat', sans-serif" }}>Blog</a>
            </nav>

            <button 
              className={`hamburger-btn ${isMobileMenuOpen ? "open" : ""}`}
              onClick={() => setMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle Navigation Menu"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>

            <div className={`mobile-nav-overlay ${isMobileMenuOpen ? "open" : ""}`}>
              <a href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
              <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it works</a>
              <a href="#arbitration" onClick={() => setMobileMenuOpen(false)}>Protect</a>
              <a href="#comparison" onClick={() => setMobileMenuOpen(false)}>Comparison</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
              <a href="#" onClick={(e) => { e.preventDefault(); setViewMode('blog'); setMobileMenuOpen(false); }}>Blog</a>
            </div>
          </>
        )}


        {/* Tab Navigation (visible when dashboard view is active) */}
        {viewMode === "dashboard" && (!fluenci.account || isSupportedNetwork) && (
          <>
            {/* Desktop inline nav (hidden on mobile) */}
            <nav className="dashboard-nav dashboard-nav-desktop" style={{ display: "flex", gap: "4px", background: "#f5f5f5", padding: "4px", borderRadius: "10px" }}>
              <button 
                className={`btn ${activeTab === "subscriber" ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "none", boxShadow: "none", fontSize: "0.82rem" }}
                onClick={() => setActiveTab("subscriber")}
              >
                <UserCircle size={16} />
                Subscriber
              </button>
              <button 
                className={`btn ${activeTab === "merchant" ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "none", boxShadow: "none", fontSize: "0.82rem" }}
                onClick={() => setActiveTab("merchant")}
              >
                <Building2 size={16} />
                Merchant
              </button>
              <button 
                className={`btn ${activeTab === "security" ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "none", boxShadow: "none", fontSize: "0.82rem" }}
                onClick={() => setActiveTab("security")}
              >
                <Terminal size={16} />
                AI Security
              </button>
              <button 
                className={`btn ${activeTab === "docs" ? "btn-primary" : "btn-secondary"}`}
                style={{ padding: "8px 16px", borderRadius: "8px", border: "none", boxShadow: "none", fontSize: "0.82rem" }}
                onClick={() => setActiveTab("docs")}
              >
                <HelpCircle size={16} />
                Docs
              </button>
            </nav>

            {/* Mobile hamburger button (hidden on desktop) */}
            <button 
              className={`dash-hamburger-btn ${isDashMenuOpen ? "open" : ""}`}
              onClick={() => setDashMenuOpen(!isDashMenuOpen)}
              aria-label="Toggle Dashboard Menu"
            >
              <span></span>
              <span></span>
              <span></span>
            </button>

            {/* Mobile dashboard menu overlay */}
            <div className={`dash-mobile-overlay ${isDashMenuOpen ? "open" : ""}`}>
              <button 
                className={`dash-overlay-item ${activeTab === "subscriber" ? "active" : ""}`}
                onClick={() => { setActiveTab("subscriber"); setDashMenuOpen(false); }}
              >
                <UserCircle size={20} />
                Subscriber
              </button>
              <button 
                className={`dash-overlay-item ${activeTab === "merchant" ? "active" : ""}`}
                onClick={() => { setActiveTab("merchant"); setDashMenuOpen(false); }}
              >
                <Building2 size={20} />
                Merchant
              </button>
              <button 
                className={`dash-overlay-item ${activeTab === "security" ? "active" : ""}`}
                onClick={() => { setActiveTab("security"); setDashMenuOpen(false); }}
              >
                <Terminal size={20} />
                AI Security
              </button>
              <button 
                className={`dash-overlay-item ${activeTab === "docs" ? "active" : ""}`}
                onClick={() => { setActiveTab("docs"); setDashMenuOpen(false); }}
              >
                <HelpCircle size={20} />
                Docs
              </button>

              {/* Wallet info section inside overlay */}
              <div className="dash-overlay-wallet">
                {fluenci.account ? (
                  <>
                    <div className="dash-overlay-wallet-info">
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <CheckCircle size={16} color={fluenci.chainId === 1990 ? "#10b981" : "#cc3333"} />
                        <span style={{ fontSize: "0.82rem", fontWeight: "700", color: fluenci.chainId === 1990 ? "#111111" : "#cc3333" }}>
                          {fluenci.chainId === 1990 ? "QIE Mainnet" : `Wrong Network (${fluenci.chainId})`}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
                        <Wallet size={16} color="#555555" />
                        <span style={{ fontFamily: "monospace", fontSize: "0.82rem", color: "#333333" }}>
                          {fluenci.accountDomain || `${fluenci.account.substring(0, 8)}...${fluenci.account.substring(fluenci.account.length - 6)}`}
                        </span>
                      </div>
                    </div>
                    <button 
                      className="dash-overlay-item" 
                      style={{ color: "#cc3333", marginTop: "4px" }}
                      onClick={() => { fluenci.disconnectWallet(); setDashMenuOpen(false); }}
                    >
                      <LogOut size={20} />
                      Disconnect Wallet
                    </button>
                  </>
                ) : (
                  <button 
                    className="dash-overlay-item active"
                    onClick={() => { setWalletModalOpen(true); setDashMenuOpen(false); }}
                  >
                    <Wallet size={20} />
                    Connect Wallet
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {viewMode === "dashboard" && (
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div className="connect-wallet-header">
              <ConnectWallet
                account={fluenci.account}
                accountDomain={fluenci.accountDomain}
                chainId={fluenci.chainId}
                connectWallet={fluenci.connectWallet}
                connectWalletConnect={fluenci.connectWalletConnect}
                finalizeWalletConnect={fluenci.finalizeWalletConnect}
                disconnectWallet={fluenci.disconnectWallet}
                loading={fluenci.loading}
                switchToQieMainnet={fluenci.switchToQieMainnet}
                showDashboard={viewMode === "dashboard"}
                onLaunchApp={() => launchApp()}
                announcedProviders={fluenci.announcedProviders}
                isOpen={isWalletModalOpen}
                setIsOpen={setWalletModalOpen}
              />
            </div>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className={viewMode === "dashboard" ? "dashboard-content" : ""} style={viewMode === "landing" || viewMode === "blog" ? {
        flexGrow: 1,
        padding: viewMode === "blog" ? "40px 20px" : 0,
        maxWidth: viewMode === "blog" ? "820px" : "none",
        width: "100%",
        margin: viewMode === "blog" ? "0 auto" : 0
      } : {
        flexGrow: 1,
        maxWidth: "1200px",
        width: "100%",
        margin: "0 auto",
        background: "#f5f5f5"
      }}>
        
        {/* Error alert banners */}
        {fluenci.error && (fluenci.error.includes("rpc1mainnet") || fluenci.error.includes("timed out") || fluenci.error.includes("request failed") || fluenci.error.includes("Failed to fetch") || fluenci.error.includes("coalesce") || fluenci.error.includes("32603")) ? (
          <div 
            className="glass-card" 
            style={{ 
              marginBottom: "24px", 
              borderColor: "rgba(245, 158, 11, 0.3)", 
              color: "#f59e0b",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              textAlign: "left"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Shield size={22} color="#f59e0b" />
              <strong style={{ fontSize: "1.05rem" }}>Wallet RPC Misconfiguration Detected</strong>
            </div>
            <p style={{ fontSize: "0.88rem", color: "#666666", margin: 0, lineHeight: "1.5" }}>
              Your wallet is trying to reach the QIE Mainnet node but it appears to be down or unreachable.
              Please check your wallet's <strong style={{ color: "#333333" }}>Custom Network settings</strong> for QIE Mainnet (Chain ID 1990)
              and ensure the RPC URL is set to <code style={{ color: "#111111" }}>https://rpc1mainnet.qie.digital</code>, then try again.
            </p>
            <button 
              className="btn btn-primary" 
              style={{ alignSelf: "flex-start", padding: "8px 16px", fontSize: "0.85rem" }}
              onClick={fluenci.switchToQieMainnet}
            >
              Auto-Repair Wallet RPC
            </button>
          </div>
        ) : fluenci.error && (
          <div 
            className="glass-card" 
            style={{ 
              marginBottom: "24px", 
              borderColor: "rgba(244, 63, 94, 0.3)", 
              color: "#f43f5e",
              padding: "16px",
              display: "flex",
              alignItems: "center",
              gap: "10px"
            }}
          >
            <Shield size={20} />
            <span style={{ flex: 1 }}>{fluenci.error}</span>
            <button 
              onClick={() => fluenci.clearError()}
              style={{
                background: "none",
                border: "none",
                color: "#f43f5e",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.7,
                transition: "opacity 0.2s"
              }}
              onMouseEnter={e => e.target.style.opacity = 1}
              onMouseLeave={e => e.target.style.opacity = 0.7}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
 
        {/* Network Warning Banner */}
        {fluenci.account && !isSupportedNetwork && (
          <div 
            className="glass-card" 
            style={{ 
              marginBottom: "30px", 
              borderColor: "rgba(245, 158, 11, 0.3)", 
              color: "#f59e0b",
              padding: "24px",
              textAlign: "center"
            }}
          >
            <h3 style={{ marginBottom: "10px" }}>Unsupported Network</h3>
            <p style={{ fontSize: "0.9rem", color: "#888888", marginBottom: "16px" }}>
              Fluenci operates exclusively on QIE Mainnet (Chain ID: 1990). Please switch your wallet.
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
              padding: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#666666" }}>
              <Shield size={20} />
              <span>
                <strong style={{ color: "#111111" }}>Read-Only Preview:</strong> Connect your wallet to start payment streams, claim funds, or verify identity.
              </span>
            </div>
            <button className="btn btn-primary" style={{ padding: "6px 14px", fontSize: "0.80rem", whiteSpace: "nowrap" }} onClick={handleConnectClick}>
              Connect Wallet
            </button>
          </div>
        )}

        {/* tab Content display */}
        {viewMode === "blog" ? (
          <BlogPage onBack={() => setViewMode("landing")} />
        ) : viewMode === "dashboard" ? (
          (!fluenci.account || isSupportedNetwork) ? (
            renderActiveTab()
          ) : null
        ) : (
          /* New High-Fidelity Revamped Landing Page */
          <div className="landing-container">
            <div className="dot-grid" />
            
            {/* Hero Section */}
            <section className="home-hero-section" id="features">
              <div className="hero-grid">
                {/* Hero Text Block - uses display:contents on mobile for grid reordering */}
                <div className="hero-text-block" style={{ textAlign: "left", zIndex: 1 }}>

                  {/* Title + Subtitle */}
                  <div className="hero-heading-block">
                    <h1 className="gradient-title" style={{ color: "#000000", fontWeight: "900", lineHeight: 1.12 }}>
                      <span className="hero-headline__line1">
                        Payments you can <span className="hero-typeword">{heroDisplay}</span>
                      </span>
                      <span className="hero-headline__line2">Stripe-style subscriptions for Web3.</span>
                    </h1>
                    <p className="hero-subtitle">
                      Fluenci is recurring billing for Web3. A merchant charges $20 a month, not tokens per second. You see who you are paying, cap what that merchant can take, and cancel whenever you want. The streaming, the stablecoin and the DEX routing run underneath.
                    </p>
                  </div>

                  {/* CTA + Stats */}
                  <div className="hero-cta-stats-block">
                    <div className="hero-cta-buttons" style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
                      {(IS_LAUNCHED || isBypassed) ? (
                        <button className="btn btn-primary" onClick={() => launchApp()}>
                          Launch App
                        </button>
                      ) : (
                        <div className="glass-card" style={{ 
                          padding: "10px 20px", 
                          border: "1px solid rgba(7, 154, 183, 0.3)", 
                          background: "rgba(7, 154, 183, 0.05)",
                          borderRadius: "8px",
                          fontSize: "0.9rem",
                          fontWeight: "700",
                          color: "#079AB7",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          fontFamily: "monospace"
                        }}>
                          <span className="pulse" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#079AB7" }} />
                          <span>Launch In: {formatTimeRemaining(timeRemaining)}</span>
                        </div>
                      )}
                      <a href="#how-it-works" className="btn btn-secondary" style={{ textDecoration: "none" }}>
                        Explore the Platform
                      </a>
                    </div>

                    {/* Real-time Protocol Stats Row */}
                    <div className="hero-stats-row" style={{ 
                      display: "flex", 
                      gap: "0", 
                      marginTop: "40px", 
                      padding: "16px 0", 
                      background: "#f8fafc", 
                      border: "1px solid #e2e8f0",
                      borderRadius: "12px",
                      maxWidth: "680px",
                      flexWrap: "wrap"
                    }}>
                      <div style={{ flex: 1, textAlign: "center", padding: "8px 12px" }}>
                        <div style={{ fontSize: "0.7rem", color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>Active Users</div>
                        <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#0f172a", fontFamily: "monospace" }}>
                          {stats.uniqueUsersCount}
                        </div>
                      </div>
                      <div style={{ width: "1px", background: "#e2e8f0", alignSelf: "stretch" }} />
                      <div style={{ flex: 1, textAlign: "center", padding: "8px 12px" }}>
                        <div style={{ fontSize: "0.7rem", color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>Settled Volume</div>
                        <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#000000", fontFamily: "monospace" }}>
                          ${stats.totalVolumeUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div style={{ width: "1px", background: "#e2e8f0", alignSelf: "stretch" }} />
                      <div style={{ flex: 1, textAlign: "center", padding: "8px 12px" }}>
                        <div style={{ fontSize: "0.7rem", color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>Swap Volume (DEX)</div>
                        <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#000000", fontFamily: "monospace" }}>
                          ${(stats.totalSwapVolumeUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div style={{ width: "1px", background: "#e2e8f0", alignSelf: "stretch" }} />
                      <div style={{ flex: 1, textAlign: "center", padding: "8px 12px" }}>
                        <div style={{ fontSize: "0.7rem", color: "#64748b", textTransform: "uppercase", marginBottom: "6px" }}>Streams Created</div>
                        <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#000000", fontFamily: "monospace" }}>
                          {(stats.streamsCreatedCount || 0).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Layered Browser + Copilot Telemetry Mockup */}
                <div className="hero-mockup-wrapper">
                  {/* Browser window mockup in background */}
                  <div className="browser-mockup">
                    <div className="browser-header">
                      <div style={{ display: "flex", gap: "6px" }}>
                        <span className="browser-dot red"></span>
                        <span className="browser-dot yellow"></span>
                        <span className="browser-dot green"></span>
                      </div>
                      <div className="browser-url-bar">fluenci.app/dashboard</div>
                    </div>
                    <div className="browser-content">
                      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #f1f5f9", paddingBottom: "10px", marginBottom: "12px" }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: "bold", color: "#1e293b" }}>Active Streams</span>
                        <span style={{ fontSize: "0.65rem", color: "#64748b" }}>QIE Mainnet</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div className="browser-stream-row active-target">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.7rem", fontWeight: "700", color: "#0f172a" }}>Acme Corp SaaS</span>
                            <span className="mock-badge green">Streaming</span>
                          </div>
                          <div className="mock-progress-bar">
                            <div className="mock-progress-fill" style={{ width: "65%" }}></div>
                          </div>
                        </div>
                        <div className="browser-stream-row">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.7rem", fontWeight: "600", color: "#475569" }}>Netflix Premium</span>
                            <span className="mock-badge green">Streaming</span>
                          </div>
                          <div className="mock-progress-bar">
                            <div className="mock-progress-fill" style={{ width: "40%" }}></div>
                          </div>
                        </div>
                        <div className="browser-stream-row paused">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: "0.7rem", fontWeight: "600", color: "#475569" }}>Unusual billing rate</span>
                            <span className="mock-badge red">Paused by Protect</span>
                          </div>
                          <div className="mock-progress-bar">
                            <div className="mock-progress-fill red" style={{ width: "100%" }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SVG connecting dotted arc */}
                  <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 3 }}>
                    <path 
                      className="connecting-path"
                      d="M 330,190 Q 210,140 140,200" 
                      fill="none" 
                      stroke="#a855f7" 
                      strokeWidth="2" 
                      strokeDasharray="4,4" 
                      markerEnd="url(#arrow)"
                    />
                    <defs>
                      <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill="#a855f7" />
                      </marker>
                    </defs>
                  </svg>

                  {/* Copilot window on top with live telemetry styled as UI card */}
                  <div className="copilot-mockup">
                    <LandingTelemetryTerminal />
                  </div>
                </div>
              </div>
            </section>


            {/* Scroll-Highlight Sticky Text Section */}
            <section className="home-text-highlight-section">
              <div className="home-text-highlight-container">
                <p className="split-lines home">
                  Most people have never cancelled a crypto subscription, because most people have never been able to read one. Fluenci prices a subscription the way the rest of the internet does: an amount, a period, and a merchant you can name. The cap on what that merchant can take sits onchain, and only you can raise it.
                </p>
              </div>
            </section>

            {/* Fixing the Hidden Gaps in Web3 Billing Section */}
            <section id="how-it-works" className="home-fixing-section">
              <div className="home-fixing-container">
                <div className="track">
                  <h2>What Web3 Billing Gets Wrong</h2>
                  <p>
                    Three things break recurring payments onchain: a price quoted per second that never adds up to the number you agreed, an approval with no ceiling, and a merchant who is only an address. Fluenci fixes those three.
                  </p>
                </div>
                <div className="benefit-stack">
                  <div className="benefit-card">
                    <div className="benefit-card-icon">
                      <Shield size={24} />
                    </div>
                    <h3>$20 a Month Means $20</h3>
                    <p>
                      A subscription is stored as an amount and a period, not a rate. The earlier per-second design billed $20 a month as $18.14, and could not price $1 a month at all.
                    </p>
                  </div>
                  <div className="benefit-card">
                    <div className="benefit-card-icon">
                      <UserCircle size={24} />
                    </div>
                    <h3>A Merchant With a Name</h3>
                    <p>
                      QIE's reverse resolver turns a merchant address into its primary .qie name in one call, so you see a name before you agree to pay. Merchants may also require QIE ID or QIE Pass of their subscribers - the default is open, and subscribing needs no KYC.
                    </p>
                  </div>
                  <div className="benefit-card">
                    <div className="benefit-card-icon">
                      <Activity size={24} />
                    </div>
                    <h3>A Cap Only You Can Raise</h3>
                    <p>
                      Set a merchant's ceiling at, say, $20 per month. The contract enforces it per merchant, clamps any claim above it down to the cap rather than reverting, and will not raise it for anyone but you.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* AI-First. Safe-by-Design Section with Interactive 3D Card */}
            <section id="arbitration" className="landing-section home-ai-first-section">
              <div className="ai-first-grid-container">
                <div className="card-wrapper" onMouseMove={handleCardMouseMove} onMouseLeave={handleCardMouseLeave}>
                  <div ref={cardRef} className="perspective-3d-card">
                    <img src={LogoImage} alt="Fluenci Logo" className="perspective-card-image" />
                  </div>
                </div>
                <div className="ai-first-description">
                  <h2>Fluenci Protect</h2>
                  <p>
                    One system watches subscriptions for anomalies, raises alerts, and can pause a stream onchain. That is the whole of its power. Protect holds no funds and custodies nothing - creating a subscription locks nothing up in the first place.
                  </p>
                </div>
              </div>
              <div className="ai-features-grid">
                <div className="ai-feature-cell">
                  <Shield className="ai-feature-cell-icon" />
                  <h3>Anomaly Detection</h3>
                  <p>
                    Reads claim timing and amounts across the registry and flags subscriptions that have stopped behaving like subscriptions.
                  </p>
                </div>
                <div className="ai-feature-cell">
                  <Activity className="ai-feature-cell-icon" />
                  <h3>Alerts, Not Autopilot</h3>
                  <p>
                    Says what changed and who it affects, so the subscriber or the merchant can decide before the next claim lands.
                  </p>
                </div>
                <div className="ai-feature-cell">
                  <Sparkles className="ai-feature-cell-icon" />
                  <h3>Pause, Never Custody</h3>
                  <p>
                    Protect can pause a stream. Only the subscriber can resume it, and nothing in the system escrows or holds a subscriber's balance.
                  </p>
                </div>
              </div>
            </section>

            {/* QIE Ecosystem Integrations - Static Grid */}
            <section className="landing-section marquee-section">
              <div className="section-header">
                <h2>Built on QIE</h2>
                <p>Fluenci settles in QIE's stablecoin, routes swaps through QIE DEX, and resolves .qie names onchain. Identity and reputation reach the contracts through adapters Fluenci built and runs - each is labelled below for what it is.</p>
              </div>

              <div className="ecosystem-marquee">


                <button type="button" className="ecosystem-nav ecosystem-nav--prev"


                        onClick={() => scrollEcosystem(-1)} aria-label="Previous integrations">


                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"


                       strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l-6 6 6 6" /></svg>


                </button>


                <div className="ecosystem-track" ref={ecosystemTrackRef}>


                  {[...QIE_ECOSYSTEM, ...QIE_ECOSYSTEM].map((item, i) => (
                  <div key={i} className="ecosystem-card" style={{
                    borderColor: `rgba(${item.accent}, 0.15)`
                  }}>
                    <div className="ecosystem-card-glow" style={{
                      background: `radial-gradient(circle at top left, rgba(${item.accent}, 0.08), transparent 70%)`
                    }} />
                    <div className="ecosystem-card-header">
                      <img src={item.logo} alt={item.name} className="ecosystem-card-logo" />
                      <h3 className="ecosystem-card-title">{item.name}</h3>
                    </div>
                    <p className="ecosystem-card-desc">{item.desc}</p>
                    <div className="ecosystem-card-tag" style={{
                      color: `rgb(${item.accent})`,
                      borderColor: `rgba(${item.accent}, 0.25)`,
                      background: `rgba(${item.accent}, 0.06)`
                    }}>
                      ✓ Integrated
                    </div>
                  </div>


                  ))}


                


                <button type="button" className="ecosystem-nav ecosystem-nav--next"


                        onClick={() => scrollEcosystem(1)} aria-label="Next integrations">


                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8"


                       strokeLinecap="round" strokeLinejoin="round"><path d="M8 4l6 6-6 6" /></svg>


                </button></div>


              </div>
            </section>

            {/* Feature Comparison Matrix */}
            <section id="comparison" className="landing-section matrix-section">
              <div className="section-header">
                <h2>Token Approvals vs. Fluenci</h2>
                <p>The difference is what a merchant can take from you, and whether you can read the price before you agree to it.</p>
              </div>

              <div className="matrix-card">
                <table className="matrix-table">
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th>Standard Web3</th>
                      <th className="matrix-fluenci-col">Fluenci</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["What you agree to pay", "A rate per second", "An amount and a period: $20 per month"],
                      ["The merchant's ceiling", "An open-ended approval", "A cap per merchant that only you can raise"],
                      ["A claim above the ceiling", "Takes whatever the approval allows", "Clamped down to the cap, not reverted"],
                      ["Who you are paying", "An address", "The merchant's primary .qie name, resolved onchain"],
                      ["Receiving a subscription NFT", "Pushed to you, bill included", "Opt-in, because receiving one makes you the payer"]
                    ].map(([feature, standard, fluenci], i) => (
                      <tr key={i}>
                        <td className="matrix-feature-name">{feature}</td>
                        <td className="matrix-standard-col">�- {standard}</td>
                        <td className="matrix-fluenci-col">✓ {fluenci}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* FAQ Accordion Section */}
            <section id="faq" className="landing-section faq-section">
              <div className="section-header">
                <h2>Frequently Asked Questions</h2>
                <p>How the contracts behave, and what is not built yet.</p>
              </div>

              <div style={{ width: "100%", maxWidth: "720px" }}>
                <FAQItem 
                  index={1}
                  isOpen={activeFaqIndex === 1}
                  onToggle={() => setActiveFaqIndex(activeFaqIndex === 1 ? null : 1)}
                  question="What is Fluenci Protect and what can it do?"
                  answer="Fluenci Protect is one monitoring system, not four agents. It watches active subscriptions for anomalies - an unexpected billing rate, a sudden change in claim behaviour - raises an alert, and in the worst case pauses the stream onchain so nothing further accrues. It never holds your funds; a subscription locks nothing up. The one case where its key moves money is settling a dispute you opened, capped at what has already accrued and clamped by your spending limit. Only you can resume a paused stream."
                />
                <FAQItem 
                  index={2}
                  isOpen={activeFaqIndex === 2}
                  onToggle={() => setActiveFaqIndex(activeFaqIndex === 2 ? null : 2)}
                  question="Can I transfer a subscription to someone else?"
                  answer="Yes. Each subscription is an ERC-721 token and can still be transferred, but receiving one is opt-in: the recipient wallet must first accept subscription transfers. Owning the token makes you the payer, and an audit showed the old design let an attacker push an uncapped billing obligation onto any wallet with a standing allowance. The sender must also clear arrears before transferring."
                />
                <FAQItem 
                  index={3}
                  isOpen={activeFaqIndex === 3}
                  onToggle={() => setActiveFaqIndex(activeFaqIndex === 3 ? null : 3)}
                  question="How do programmable spending limits work?"
                  answer="You set a cap on each merchant - for example $20 every 30 days - enforced onchain against the (subscriber, merchant) pair rather than per subscription, so a merchant opening three streams cannot take three times the cap. A claim above the remaining allowance is clamped to what is left, not reverted. Only you can raise or clear your own cap."
                />
                <FAQItem 
                  index={4}
                  isOpen={activeFaqIndex === 4}
                  onToggle={() => setActiveFaqIndex(activeFaqIndex === 4 ? null : 4)}
                  question="Do I need to deposit all my subscription funds upfront?"
                  answer="No. Creating a subscription locks nothing. It authorises the merchant to pull funds as they accrue, so your qUSDC stays in your wallet until it is earned. A merchant can never claim more than has accrued so far, and never more than your cap for that merchant allows. The protocol fee is 0.5%, taken at claim time."
                />
                <FAQItem 
                  index={5}
                  isOpen={activeFaqIndex === 5}
                  onToggle={() => setActiveFaqIndex(activeFaqIndex === 5 ? null : 5)}
                  question="How does the built-in DEX swap integration work?"
                  answer="Fluenci routes swaps to QIEDex through its own FluenciRouter contract, so you can move between QIE and qUSDC without leaving the app. Every routed swap emits a FluenciSwap event onchain recording the direction and the amounts in and out. That makes swap volume originating from Fluenci verifiable by anyone on the QIE block explorer."
                />
                <FAQItem 
                  index={6}
                  isOpen={activeFaqIndex === 6}
                  onToggle={() => setActiveFaqIndex(activeFaqIndex === 6 ? null : 6)}
                  question="Do I need to pass KYC to subscribe?"
                  answer="No. Each merchant chooses the access rule for their own subscriptions - Open, QIE ID, verified QIE Pass, or a minimum reputation score - and the default is Open, so most subscriptions require no verification at all. Merchants do need a verified QIE Pass to withdraw. Fluenci checks Pass status against QIE's API and writes only the result to an oracle contract it deployed itself."
                />
                <FAQItem 
                  index={7}
                  isOpen={activeFaqIndex === 7}
                  onToggle={() => setActiveFaqIndex(activeFaqIndex === 7 ? null : 7)}
                  question="Are the Fluenci smart contracts auditable and open-source?"
                  answer="The Solidity source is public on GitHub. What is live on QIE mainnet today is v3: the registry at 0xddB7398B6bA13641eC66D9beFb67BA3F765c57C9, qUSDC, and the FluenciRouter, each linked from the footer straight to the QIE explorer - check each one's verification status yourself. Two things to know first: the QIE Pass oracle Fluenci operates is not verified, and FluenciRegistryV4 is not deployed yet."
                />
                <FAQItem 
                  index={8}
                  isOpen={activeFaqIndex === 8}
                  onToggle={() => setActiveFaqIndex(activeFaqIndex === 8 ? null : 8)}
                  question="What does the reputation score mean, and where does it come from?"
                  answer="QIE computes reputation off-chain from signals such as wallet age and transaction history; there is no onchain reputation registry. QIE's service would sign a score with a tier, a model version and an expiry, and Fluenci's attestor contract verifies that signature before a merchant's minimum-score rule can use it. Only the result is stored onchain - never KYC data. This gate is built and tested, but waits on QIE issuing its signing key."
                />
              </div>
            </section>

            {/* Explore the Platform CTA */}
            <section className="landing-section cta-section">
              <div className="section-header">
                <h2>See What the Contract Does</h2>
                <p style={{ marginBottom: "28px" }}>Registry v3 is live on QIE mainnet; new subscriptions against it are frozen while v4 lands. v4 - period pricing, spend caps, opt-in transfers - has 50 passing tests and is not deployed yet. The contracts are on GitHub. Read them before you take our word for any of this.</p>
                {(IS_LAUNCHED || isBypassed) ? (
                  <button className="btn btn-primary btn-cta-pulse" onClick={() => launchApp()}>
                    Launch App
                  </button>
                ) : (
                  <div className="glass-card" style={{ 
                    padding: "12px 24px", 
                    border: "1px solid rgba(7, 154, 183, 0.3)", 
                    background: "rgba(7, 154, 183, 0.05)",
                    borderRadius: "8px",
                    fontSize: "1rem",
                    fontWeight: "700",
                    color: "#079AB7",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    fontFamily: "monospace",
                    margin: "0 auto"
                  }}>
                    <span className="pulse" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#079AB7" }} />
                    <span>Launch In: {formatTimeRemaining(timeRemaining)}</span>
                  </div>
                )}
              </div>
            </section>
          </div>

        )}
      </main>

      {/* Footer */}
      <footer className="fluenci-footer">
        <div className="footer-grid">
          {/* Brand Column */}
          <div className="footer-brand">
            <div className="footer-logo">
              <img src={LogoImage} alt="Fluenci" style={{ width: "32px", height: "32px", borderRadius: "8px" }} />
              <span>Fluenci</span>
            </div>
            <p className="footer-tagline">Stripe-style subscriptions for Web3. Priced by the month, settled on QIE Blockchain.</p>
            <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
              <a href="https://x.com/fluenciAI" target="_blank" rel="noopener noreferrer" style={{ color: "#888", transition: "color 0.2s" }} onMouseOver={e => e.currentTarget.style.color = "#fff"} onMouseOut={e => e.currentTarget.style.color = "#888"} aria-label="X (Twitter)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="https://github.com/mrnetwork0001/Fluenci" target="_blank" rel="noopener noreferrer" style={{ color: "#888", transition: "color 0.2s" }} onMouseOver={e => e.currentTarget.style.color = "#fff"} onMouseOut={e => e.currentTarget.style.color = "#888"} aria-label="GitHub">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              </a>
            </div>
          </div>

          {/* Protocol Column */}
          <div className="footer-col">
            <h4>PROTOCOL</h4>
            <a href="#features" onClick={(e) => { e.preventDefault(); if(viewMode !== 'landing') setViewMode('landing'); }}>Features</a>
            <a href="#comparison" onClick={(e) => { e.preventDefault(); if(viewMode !== 'landing') setViewMode('landing'); }}>AI-Shield</a>
            {(IS_LAUNCHED || isBypassed) && (
              <a href="#" onClick={(e) => { e.preventDefault(); launchApp(); }}>Launch App</a>
            )}
          </div>

          {/* Ecosystem Column */}
          <div className="footer-col">
            <h4>ECOSYSTEM</h4>
            <a href="https://mainnet.qie.digital" target="_blank" rel="noopener noreferrer">QIE Explorer</a>
            <a href="https://www.qie.digital" target="_blank" rel="noopener noreferrer">QIE Blockchain</a>
            <a href="https://dex.qie.digital" target="_blank" rel="noopener noreferrer">QieDex</a>
            <a href="https://qiepass.qie.digital" target="_blank" rel="noopener noreferrer">QIE Pass</a>
          </div>

          {/* Resources Column */}
          <div className="footer-col">
            <h4>RESOURCES</h4>
            <a href="/docs" onClick={(e) => { e.preventDefault(); setViewMode('dashboard'); setActiveTab('docs'); window.history.pushState({}, '', '/docs'); }}>Docs</a>
            <a href={`https://mainnet.qie.digital/address/${fluenci.contracts.registry}`} target="_blank" rel="noopener noreferrer">Contracts</a>
            <a href={`https://mainnet.qie.digital/address/${fluenci.contracts.fluenciRouter || '0x75475647f52531D4086296415392E4AA94b92de7'}`} target="_blank" rel="noopener noreferrer">FluenciRouter</a>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 Fluenci Protocol. Built for QIE Blockchain Hackathon.</p>
        </div>
      </footer>


      {/* Transaction Progress Modal */}
      <TransactionModal txState={fluenci.txState} onClose={fluenci.resetTx} />
    </div>
  );
}
