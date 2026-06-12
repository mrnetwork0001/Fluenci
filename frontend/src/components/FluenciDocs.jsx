import React, { useState } from "react";
import { 
  BookOpen, 
  ShieldCheck, 
  KeyRound, 
  Coins, 
  HelpCircle, 
  ArrowRight, 
  ArrowLeft,
  Terminal, 
  AlertCircle,
  Play,
  Gamepad2,
  ChevronRight,
  ChevronLeft,
  FileCode,
  ExternalLink,
  Copy,
  Check
} from "lucide-react";

export default function FluenciDocs() {
  const [activeSection, setActiveSection] = useState("intro");

  const sections = [
    { id: "intro", title: "Introduction & Overview", shortTitle: "Intro", icon: <BookOpen size={16} />, color: "#2563eb" },
    { id: "sentry", title: "AI Sentry & Protection", shortTitle: "AI Sentry", icon: <ShieldCheck size={16} />, color: "#d97706" },
    { id: "qiepass", title: "QIE Pass & Trust", shortTitle: "QIE Pass", icon: <KeyRound size={16} />, color: "#10b981" },
    { id: "router", title: "Router & DEX Swaps", shortTitle: "Router", icon: <Coins size={16} />, color: "#8b5cf6" },
    { id: "arcade", title: "Fluenci Arcade", shortTitle: "Arcade", icon: <Gamepad2 size={16} />, color: "#ec4899" },
    { id: "guide", title: "Mainnet Interaction Guide", shortTitle: "Guide", icon: <Play size={16} />, color: "#111111" },
    { id: "contracts", title: "Deployed Contracts", shortTitle: "Contracts", icon: <FileCode size={16} />, color: "#06b6d4" }
  ];

  const currentIndex = sections.findIndex(s => s.id === activeSection);
  const prevSection = currentIndex > 0 ? sections[currentIndex - 1] : null;
  const nextSection = currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

  const handleNavigate = (sectionId) => {
    setActiveSection(sectionId);
    // Scroll to top of docs content on mobile
    const el = document.querySelector('.docs-content-pane');
    if (el) el.scrollTop = 0;
  };

  const PrevNextNav = () => (
    <div className="docs-prevnext" style={{
      display: "flex",
      justifyContent: prevSection && nextSection ? "space-between" : prevSection ? "flex-start" : "flex-end",
      gap: "12px",
      marginTop: "28px",
      paddingTop: "20px",
      borderTop: "1px solid #eeeeee"
    }}>
      {prevSection && (
        <button
          onClick={() => handleNavigate(prevSection.id)}
          className="docs-nav-btn docs-nav-btn-prev"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 20px",
            background: "#f8f8f8",
            border: "1px solid #e5e5e5",
            borderRadius: "12px",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: "600",
            color: "#555555",
            transition: "all 0.2s ease",
            maxWidth: "48%"
          }}
        >
          <ChevronLeft size={16} />
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: "0.7rem", color: "#999999", textTransform: "uppercase", letterSpacing: "0.05em" }}>Previous</div>
            <div style={{ marginTop: "2px" }}>{prevSection.shortTitle}</div>
          </div>
        </button>
      )}
      {nextSection && (
        <button
          onClick={() => handleNavigate(nextSection.id)}
          className="docs-nav-btn docs-nav-btn-next"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "12px 20px",
            background: "#111111",
            border: "1px solid #111111",
            borderRadius: "12px",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: "600",
            color: "#ffffff",
            transition: "all 0.2s ease",
            marginLeft: "auto",
            maxWidth: "48%"
          }}
        >
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Next</div>
            <div style={{ marginTop: "2px" }}>{nextSection.shortTitle}</div>
          </div>
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case "intro":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              Introduction & Overview
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              Fluenci is an <strong>AI-shielded real-time streaming payments protocol</strong> built natively on the <strong>QIE Blockchain</strong>. It is designed to solve the critical vulnerability in traditional Web3 recurring payments: <strong>"blind, unmonitored streams."</strong>
            </p>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              Unlike standard subscription protocols where funds are streamed automatically without supervision, Fluenci integrates an active <strong>AI Sentry</strong> layer onchain to protect subscribers and merchants from rogue balance drains, compromised wallets, and developer hacks.
            </p>

            <div style={{ 
              background: "rgba(37, 99, 235, 0.04)", 
              border: "1px solid rgba(37, 99, 235, 0.15)", 
              borderRadius: "12px", 
              padding: "16px",
              marginTop: "8px"
            }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: "0.95rem", color: "#2563eb", fontWeight: "700" }}>
                Why QIE Blockchain?
              </h4>
              <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "0.88rem", color: "#555555", display: "flex", flexDirection: "column", gap: "6px" }}>
                <li><strong>Sub-second Settlement:</strong> Streams update with extreme precision because of QIE's lightning-fast blocks.</li>
                <li><strong>Negligible Gas Fees:</strong> Claiming streamed funds or starting subscriptions costs fractions of a cent.</li>
                <li><strong>Native Ecosystem Registry:</strong> Deep integration with QIE Pass DIDs and reverse-resolved .qie domains.</li>
              </ul>
            </div>

            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#111111", margin: "12px 0 4px 0" }}>
              Core Protocol Components
            </h3>
            <div className="docs-components-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="glass-card" style={{ padding: "14px", borderRadius: "12px", background: "#fdfdfd" }}>
                <strong style={{ fontSize: "0.88rem", color: "#111111" }}>FluenciRegistry</strong>
                <p style={{ fontSize: "0.78rem", color: "#666666", margin: "4px 0 0 0", lineHeight: "1.4" }}>
                  The core smart contract orchestrating streams, cliff times, deposits, and claim/termination actions.
                </p>
              </div>
              <div className="glass-card" style={{ padding: "14px", borderRadius: "12px", background: "#fdfdfd" }}>
                <strong style={{ fontSize: "0.88rem", color: "#111111" }}>FluenciAIAuditor</strong>
                <p style={{ fontSize: "0.78rem", color: "#666666", margin: "4px 0 0 0", lineHeight: "1.4" }}>
                  Holds the cryptographic signatures and validation rules allowing the AI Sentry to pause streams dynamically.
                </p>
              </div>
              <div className="glass-card" style={{ padding: "14px", borderRadius: "12px", background: "#fdfdfd" }}>
                <strong style={{ fontSize: "0.88rem", color: "#111111" }}>QIE Pass DID Registry</strong>
                <p style={{ fontSize: "0.78rem", color: "#666666", margin: "4px 0 0 0", lineHeight: "1.4" }}>
                  Verifies that subscribers and merchants have completed decentralized identity KYC checks onchain.
                </p>
              </div>
              <div className="glass-card" style={{ padding: "14px", borderRadius: "12px", background: "#fdfdfd" }}>
                <strong style={{ fontSize: "0.88rem", color: "#111111" }}>FluenciRouter</strong>
                <p style={{ fontSize: "0.78rem", color: "#666666", margin: "4px 0 0 0", lineHeight: "1.4" }}>
                  Allows users to start streams using native QIE tokens, wrapping swap interactions through QIEDex with zero price volatility.
                </p>
              </div>
            </div>
            <PrevNextNav />
          </div>
        );

      case "sentry":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              AI Sentry & Protection Desk
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              Traditional streaming protocols continue draining your wallet even if a hack occurs, relying on manual user actions to cancel. Fluenci introduces an <strong>autonomous AI Sentry agent</strong> that continuously monitors stream behaviors.
            </p>

            <div style={{ 
              background: "rgba(245, 158, 11, 0.04)", 
              border: "1px solid rgba(245, 158, 11, 0.2)", 
              borderRadius: "12px", 
              padding: "16px",
              display: "flex",
              gap: "12px",
              alignItems: "flex-start"
            }}>
              <AlertCircle size={20} color="#d97706" style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <strong style={{ fontSize: "0.9rem", color: "#d97706" }}>How Anomaly Detection Works</strong>
                <p style={{ fontSize: "0.82rem", color: "#666666", margin: "4px 0 0 0", lineHeight: "1.4" }}>
                  The sentry monitors stream activity (rates, cliffs, claim frequencies). If a merchant initiates a sudden claim pattern shift or an unauthorized rate manipulation is detected, the AI pauses the stream onchain within seconds.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#111111", margin: "8px 0 4px 0" }}>
              Dynamic Sentry State Cycle
            </h3>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              When an anomaly is flagged, the AI Sentry triggers the <strong>FluenciAIAuditor</strong> contract:
            </p>
            <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "0.88rem", color: "#555555", display: "flex", flexDirection: "column", gap: "6px" }}>
              <li><strong>Temporary Lock:</strong> The stream is paused onchain (preventing claims/withdrawals).</li>
              <li><strong>AI security Alert:</strong> An alert log is emitted on the <em>AI Security Desk</em> telemetry terminal.</li>
              <li><strong>Dispute Resolution:</strong> The subscriber can safely review the claim behavior and either resume the stream or settle it in dual-shares via verified signatures.</li>
            </ol>

            <div style={{ 
              background: "#1e1e2e", 
              borderRadius: "10px", 
              padding: "14px", 
              fontFamily: "monospace", 
              fontSize: "0.78rem", 
              color: "#cdd6f4",
              border: "1px solid #313244",
              overflowX: "auto"
            }}>
              <span style={{ color: "#a6e3a1" }}>// Telemetry Log Example:</span><br />
              <span style={{ color: "#89b4fa" }}>[18:02:14 UTC]</span> ALERT: Anomalous claims detected on stream 0x5a1b...c912<br />
              <span style={{ color: "#89b4fa" }}>[18:02:15 UTC]</span> ACTION: AI Auditor signed freeze transaction.<br />
              <span style={{ color: "#a6e3a1" }}>[18:02:16 UTC]</span> SUCCESS: Stream status set to pausedByAI=true on QIE Mainnet.
            </div>
            <PrevNextNav />
          </div>
        );

      case "qiepass":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              QIE Pass & Identity Trust
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              To ensure compliance and prevent malicious Sybil attacks (where attackers create hundreds of fake addresses to bypass security), Fluenci integrates the official <strong>QIE Pass Decentralized Identity (DID)</strong> registry.
            </p>

            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#111111", margin: "8px 0 4px 0" }}>
              The Trust Mechanism
            </h3>
            <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "0.88rem", color: "#555555", display: "flex", flexDirection: "column", gap: "8px" }}>
              <li><strong>Identity Proofing:</strong> Subscribers and merchants are required to have a verified identity on the QIE Pass contract before they can create streaming agreements.</li>
              <li><strong>KYC Integration:</strong> Registering identity requires switching your wallet network to <strong>QIE Testnet</strong> to complete the verification step on the QIE Pass registry. Once completed, users switch back to <strong>QIE Mainnet</strong> to utilize their verified status for payment streams.</li>
              <li><strong>Domain Resolution:</strong> Fluenci decodes wallet domains (e.g. `mrnetwork.qie`) directly from the QIE Domain Registry history, displaying friendly names instead of hex addresses.</li>
            </ul>

            <div style={{ 
              background: "rgba(16, 185, 129, 0.04)", 
              border: "1px solid rgba(16, 185, 129, 0.15)", 
              borderRadius: "12px", 
              padding: "16px",
              marginTop: "8px"
            }}>
              <strong style={{ fontSize: "0.9rem", color: "#10b981", display: "flex", alignItems: "center", gap: "8px" }}>
                <ShieldCheck size={18} /> Onchain Rule Enforcement
              </strong>
              <p style={{ fontSize: "0.82rem", color: "#666666", margin: "4px 0 0 0", lineHeight: "1.4" }}>
                Creating a stream triggers the modifier <code>requiresQiePass(user)</code> in our smart contracts. If a subscriber's KYC is revoked or unverified, stream creation or claim actions will automatically revert.
              </p>
            </div>
            <PrevNextNav />
          </div>
        );

      case "router":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              Fluenci Router & DEX Swaps
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              Subscription billing requires stablecoin payments (like <strong>QUSDC</strong>) to ensure merchants receive constant value regardless of token price movements. However, users often hold native QIE.
            </p>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              The <strong>FluenciRouter</strong> smart contract bridges this gap by wrapping liquidity swaps directly through the <strong>QIEDex</strong> AMM.
            </p>

            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#111111", margin: "8px 0 4px 0" }}>
              Attributed Swap routing
            </h3>
            <div className="docs-swap-flow" style={{ 
              background: "#f9fafb", 
              border: "1px solid #e5e7eb", 
              borderRadius: "12px", 
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "8px"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "0.85rem", flexWrap: "wrap" }}>
                <span style={{ background: "#e5e7eb", padding: "4px 8px", borderRadius: "6px", fontWeight: "bold" }}>User Swap</span>
                <ArrowRight size={14} color="#666666" />
                <span style={{ background: "#dbeafe", color: "#2563eb", padding: "4px 8px", borderRadius: "6px", fontWeight: "bold" }}>FluenciRouter</span>
                <ArrowRight size={14} color="#666666" />
                <span style={{ background: "#e5e7eb", padding: "4px 8px", borderRadius: "6px", fontWeight: "bold" }}>QIEDex Router</span>
              </div>
              <p style={{ fontSize: "0.8rem", color: "#666666", margin: 0, lineHeight: "1.4" }}>
                Swapping native QIE to QUSDC through FluenciRouter registers a <code>FluenciSwap</code> event onchain. This ensures full attribution for judges to verify swap volumes originating from our front-end!
              </p>
            </div>
            <PrevNextNav />
          </div>
        );

      case "arcade":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              Fluenci Arcade
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              The Fluenci Arcade merges interactive utility and user support with real-time micro-payment streaming. Users can play games or chat with our intelligent copilot, paying a low, continuous stream rate of <strong>0.0001 QUSDC per second</strong>.
            </p>

            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#111111", margin: "8px 0 4px 0" }}>
              Arcade Modules
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="glass-card" style={{ padding: "16px", borderRadius: "12px", background: "#fdfdfd" }}>
                <strong style={{ fontSize: "0.9rem", color: "#111111", display: "block", marginBottom: "4px" }}>
                  Qie Snake Game
                </strong>
                <p style={{ fontSize: "0.82rem", color: "#555555", margin: 0, lineHeight: "1.4" }}>
                  A stream-to-play arcade classic where the game environment scales in speed and difficulty as you stream. Tracks your high scores locally and helps demonstrate stream starts and finishes.
                </p>
              </div>

              <div className="glass-card" style={{ padding: "16px", borderRadius: "12px", background: "#fdfdfd" }}>
                <strong style={{ fontSize: "0.9rem", color: "#111111", display: "block", marginBottom: "4px" }}>
                  AI Chat Copilot
                </strong>
                <p style={{ fontSize: "0.82rem", color: "#555555", margin: 0, lineHeight: "1.4" }}>
                  A ChatGPT-style support assistant integrated directly into the arcade. Backed by GPT-4o-mini, it responds to questions about the QIE blockchain ecosystem, KYC procedures, and Fluenci stream management. Features fullscreen display modes, message history persistence, and chat session creation.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#111111", margin: "12px 0 4px 0" }}>
              Onchain Payment Flow
            </h3>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              When you click Start AI Session or Insert QUSDC to Play:
            </p>
            <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "0.85rem", color: "#555555", display: "flex", flexDirection: "column", gap: "6px" }}>
              <li>The frontend opens a QUSDC payment stream to the platform's destination address: <code>0xfe5f1d13a31a5b86833adf4486720331d6e4a6bb</code> (domain: <code>fluenci.qie</code>).</li>
              <li>A micro-payment stream of <strong>0.0001 QUSDC/second</strong> starts flowing.</li>
              <li>When you end the session, the stream is automatically terminated onchain, ensuring you only pay for the exact duration of your activity.</li>
            </ul>
            <PrevNextNav />
          </div>
        );

      case "guide":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              Mainnet Interaction Guide
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              Follow this detailed guide to configure your identity, fund your wallet, and manage payment streams directly on QIE Mainnet.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Part 1 */}
              <div style={{ borderBottom: "1px solid #eeeeee", paddingBottom: "14px" }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: "700", color: "#111111", margin: "0 0 8px 0" }}>
                  1. Verifying Your Identity via QIE Pass (Testnet to Mainnet Flow)
                </h3>
                <p style={{ fontSize: "0.88rem", color: "#555555", lineHeight: "1.5", margin: "0 0 8px 0" }}>
                  To establish decentralized trust and fulfill security requirements, users must verify their identity on the QIE Pass DID registry. Follow these steps to register:
                </p>
                <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "0.82rem", color: "#666666", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li>Click the <strong>Verify QIE Pass</strong> button in the Subscriber Panel.</li>
                  <li>When prompted, <strong>switch your wallet network to QIE Testnet</strong> (RPC URL: <code>https://rpc4testnet.qie.digital/</code>). This network is used specifically for the signature KYC authorization registry steps.</li>
                  <li>Complete the registration and sign the consent payload inside the redirect interface.</li>
                  <li>Once completed, <strong>switch your wallet network back to QIE Mainnet</strong> (RPC URL: <code>https://rpc1mainnet.qie.digital</code>). Your verified status will automatically resolve on-chain.</li>
                </ol>
              </div>

              {/* Part 2 */}
              <div>
                <h3 style={{ fontSize: "1.05rem", fontWeight: "700", color: "#111111", margin: "0 0 8px 0" }}>
                  2. Initiating and Managing Streams on QIE Mainnet
                </h3>
                <p style={{ fontSize: "0.88rem", color: "#555555", lineHeight: "1.5", margin: "0 0 8px 0" }}>
                  Once your identity is verified, you can securely interact with recurring streaming agreements:
                </p>
                <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "0.82rem", color: "#666666", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <li>Ensure your wallet has native QIE (for gas fees) and QUSDC stablecoins (the default stream token).</li>
                  <li>Enter the target merchant's address (or reverse-resolved .qie domain name), streaming rate, and duration in the Subscriber Panel.</li>
                  <li>Click <strong>Start Stream</strong>. The front-end automatically approves a safe spending allowance limit (10,000 QUSDC cap) and creates the subscription.</li>
                  <li>Subscribers and merchants can manage active streams (pause, resume, claim, or terminate) directly with sub-second finality.</li>
                  <li>To review active audits and sentry logs, open the <strong>AI Security</strong> dashboard to inspect the autonomous Sentry agent's block-by-block telemetry.</li>
                </ol>
              </div>
            </div>
            <PrevNextNav />
          </div>
        );

      case "contracts":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              Deployed Contracts
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              All smart contracts powering the Fluenci protocol are deployed on the QIE Mainnet (Chain ID: 1990). The source code is verified and fully auditable. Interact directly using the block explorer or view contract states.
            </p>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "16px",
              marginTop: "8px"
            }}>
              <ContractCard 
                name="FluenciRegistry" 
                description="Core stream orchestration registry. Manages user subscriptions, cliff periods, stream rates, deposit balances, and withdrawal/termination events."
                address="0x13D948a6A3384a744cdB84B0236bbba7CC79cA41"
                isCore={true}
                isVerified={true}
              />
              <ContractCard 
                name="FluenciAIAuditor" 
                description="Autonomous security auditor. Holds cryptographic signature verification and controls the safety pause states triggered by the AI Sentry."
                address="0x5A2bFC25a951da06dCee2Bf1B7719c43ceB59B02"
                isCore={true}
                isVerified={true}
              />
              <ContractCard 
                name="FluenciRouter" 
                description="Attributed DEX router. Enables native QIE payments by executing wraps and swaps through QIEDex with built-in onchain front-end volume attribution."
                address="0x75475647f52531D4086296415392E4AA94b92de7"
                isCore={true}
                isVerified={true}
              />
              <ContractCard 
                name="QUSDC (Stablecoin)" 
                description="The default payment token. A stable ERC-20 coin pegged to the US Dollar, ensuring price stability for streaming subscriptions."
                address="0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"
                isVerified={true}
              />
              <ContractCard 
                name="QIE Pass DID Registry" 
                description="Decentralized Identity registry. Verifies subscriber and merchant identity status to ensure compliance and prevent Sybil stream creation."
                address="0x0766Ff824376CEf38CFa5C155A51E90578096e38"
              />
              <ContractCard 
                name="QIE Domain Registry" 
                description="Official name service. Resolves human-readable '.qie' domains to standard hex wallet addresses directly on-chain."
                address="0xcfbcbca93c607590b211c81c7dbcdbd7ed6cc6ed"
                isVerified={true}
              />
              <ContractCard 
                name="QIEDex Router" 
                description="Official Automated Market Maker (AMM) router. Facilitates token swapping and liquidity routing for the FluenciRouter."
                address="0x08cd2e72e156D8563B4351eb4065C262A9f553Ef"
              />
            </div>
            <PrevNextNav />
          </div>
        );

      default:
        return null;
    }
  };

  const currentSection = sections[currentIndex];

  return (
    <div className="docs-container" style={{ 
      display: "flex", 
      gap: "24px", 
      maxWidth: "1100px", 
      margin: "0 auto", 
      alignItems: "stretch",
      textAlign: "left",
      minHeight: "550px"
    }}>
      {/* Desktop Sidebar navigation */}
      <div className="docs-sidebar docs-sidebar-desktop" style={{ 
        width: "240px", 
        display: "flex", 
        flexDirection: "column", 
        gap: "8px",
        flexShrink: 0
      }}>
        <div style={{
          padding: "12px 16px",
          fontSize: "0.75rem",
          fontWeight: "700",
          color: "#888888",
          textTransform: "uppercase",
          letterSpacing: "0.05em"
        }}>
          Documentation
        </div>
        
        {sections.map((section) => {
          const isActive = activeSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => handleNavigate(section.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                width: "100%",
                padding: "12px 16px",
                background: isActive ? "#111111" : "transparent",
                border: "none",
                borderRadius: "10px",
                color: isActive ? "#ffffff" : "#555555",
                fontSize: "0.88rem",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
              className="docs-sidebar-btn"
            >
              {section.icon}
              {section.title}
            </button>
          );
        })}
      </div>

      {/* Mobile Section Navigation (visible only on mobile) */}
      <div className="docs-mobile-nav">
        {/* Step indicator */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px"
        }}>
          <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#999999", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Documentation
          </span>
          <span style={{ fontSize: "0.72rem", fontWeight: "700", color: "#999999" }}>
            {currentIndex + 1} of {sections.length}
          </span>
        </div>

        {/* Section cards grid */}
        <div className="docs-mobile-grid">
          {sections.map((section, idx) => {
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                onClick={() => handleNavigate(section.id)}
                className={`docs-mobile-card ${isActive ? "active" : ""}`}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "6px",
                  padding: "12px 8px",
                  background: isActive ? "#111111" : "#ffffff",
                  border: isActive ? "1px solid #111111" : "1px solid #e5e5e5",
                  borderRadius: "12px",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  textAlign: "center",
                  minWidth: 0
                }}
              >
                <div style={{ 
                  color: isActive ? "#ffffff" : section.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  background: isActive ? "rgba(255,255,255,0.15)" : `${section.color}10`,
                  flexShrink: 0
                }}>
                  {section.icon}
                </div>
                <span style={{ 
                  fontSize: "0.68rem", 
                  fontWeight: "600", 
                  color: isActive ? "#ffffff" : "#555555",
                  lineHeight: "1.2",
                  wordBreak: "break-word"
                }}>
                  {section.shortTitle}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content pane */}
      <div 
        className="glass-card docs-content-pane" 
        style={{ 
          flex: 1, 
          background: "#ffffff", 
          border: "1px solid #e0e0e0", 
          borderRadius: "20px", 
          padding: "32px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.02)"
        }}
      >
        {renderContent()}
      </div>
    </div>
  );
}

function ContractCard({ name, description, address, isVerified, isCore }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="glass-card" style={{
      padding: "20px",
      borderRadius: "14px",
      background: "#ffffff",
      border: "1px solid #e2e8f0",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
      position: "relative",
      transition: "transform 0.2s, border-color 0.2s"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" }}>
        <h4 style={{ margin: "0 0 4px 0", fontSize: "0.95rem", color: "#111111", fontWeight: "700", display: "inline-flex" }}>
          {name}
        </h4>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {isCore && (
            <span style={{
              fontSize: "0.62rem",
              fontWeight: "700",
              color: "#2563eb",
              background: "rgba(37, 99, 235, 0.08)",
              border: "1px solid rgba(37, 99, 235, 0.15)",
              padding: "2px 6px",
              borderRadius: "100px",
              textTransform: "uppercase",
              letterSpacing: "0.03em"
            }}>
              Core
            </span>
          )}
          {isVerified && (
            <span style={{
              fontSize: "0.62rem",
              fontWeight: "700",
              color: "#16a34a",
              background: "rgba(22, 163, 74, 0.08)",
              border: "1px solid rgba(22, 163, 74, 0.15)",
              padding: "2px 6px",
              borderRadius: "100px",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              display: "flex",
              alignItems: "center",
              gap: "3px"
            }}>
              <ShieldCheck size={10} />
              Verified
            </span>
          )}
        </div>
      </div>
      
      <div>
        <p style={{ fontSize: "0.8rem", color: "#555555", margin: 0, lineHeight: "1.45" }}>
          {description}
        </p>
      </div>

      <div style={{
        marginTop: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "10px"
      }}>
        {/* Address Badge */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          padding: "8px 12px",
          fontFamily: "monospace",
          fontSize: "0.78rem",
          color: "#475569"
        }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>
            {address}
          </span>
          <button 
            onClick={handleCopy}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: copied ? "#10b981" : "#94a3b8",
              transition: "color 0.2s"
            }}
            title="Copy address"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>

        {/* Explorer Link */}
        <a 
          href={`https://mainnet.qie.digital/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            padding: "10px",
            background: "#111111",
            color: "#ffffff",
            borderRadius: "8px",
            textDecoration: "none",
            fontSize: "0.8rem",
            fontWeight: "600",
            textAlign: "center",
            transition: "background 0.2s"
          }}
          className="explorer-link-btn"
        >
          <span style={{ color: "#ffffff" }}>View on Explorer</span>
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}
