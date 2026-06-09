import React, { useState } from "react";
import { 
  BookOpen, 
  ShieldCheck, 
  KeyRound, 
  Coins, 
  HelpCircle, 
  ArrowRight, 
  Terminal, 
  AlertCircle,
  Play
} from "lucide-react";

export default function FluenciDocs() {
  const [activeSection, setActiveSection] = useState("intro");

  const sections = [
    { id: "intro", title: "Introduction & Overview", icon: <BookOpen size={16} /> },
    { id: "sentry", title: "AI Sentry & Protection", icon: <ShieldCheck size={16} /> },
    { id: "qiepass", title: "QIE Pass & Trust", icon: <KeyRound size={16} /> },
    { id: "router", title: "Router & DEX Swaps", icon: <Coins size={16} /> },
    { id: "demo", title: "How to Demo & Test", icon: <Play size={16} /> }
  ];

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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
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
          </div>
        );

      case "sentry":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              AI Sentry & Protection Desk
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              Traditional streaming protocols continue draining your wallet even if a hack occurs, relying on manual user actions to cancel. Fluenci introduces an **autonomous AI Sentry agent** that continuously monitors stream behaviors.
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
          </div>
        );

      case "qiepass":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              QIE Pass & Identity Trust
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              To ensure compliance and prevent malicious Sybil attacks (where attackers create hundreds of fake addresses to bypass security), Fluenci integrates the official **QIE Pass Decentralized Identity (DID)** registry.
            </p>

            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#111111", margin: "8px 0 4px 0" }}>
              The Trust Mechanism
            </h3>
            <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "0.88rem", color: "#555555", display: "flex", flexDirection: "column", gap: "8px" }}>
              <li><strong>Identity Proofing:</strong> Subscribers and merchants are required to have a verified identity on the QIE Pass contract before they can create streaming agreements.</li>
              <li><strong>KYC Integration:</strong> Our dashboard connects directly to the QIE Pass identity verifier. Users can register their wallet or perform verification steps on the fly.</li>
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
          </div>
        );

      case "router":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              Fluenci Router & DEX Swaps
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              Subscription billing requires stablecoin payments (like **QUSDC**) to ensure merchants receive constant value regardless of token price movements. However, users often hold native QIE.
            </p>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              The **FluenciRouter** smart contract bridges this gap by wrapping liquidity swaps directly through the **QIEDex** AMM.
            </p>

            <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#111111", margin: "8px 0 4px 0" }}>
              Attributed Swap routing
            </h3>
            <div style={{ 
              background: "#f9fafb", 
              border: "1px solid #e5e7eb", 
              borderRadius: "12px", 
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "8px"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "0.85rem" }}>
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
          </div>
        );

      case "demo":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <h2 style={{ fontSize: "1.5rem", fontWeight: "800", color: "#111111", margin: 0 }}>
              How to Demo & Test Fluenci
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#555555", lineHeight: "1.6", margin: 0 }}>
              Follow these simple steps to test all of Fluenci's onchain and AI sentry capabilities in real-time:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Step 1 */}
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ 
                  background: "#111111", 
                  color: "#ffffff", 
                  width: "24px", 
                  height: "24px", 
                  borderRadius: "50%", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  fontSize: "0.8rem",
                  fontWeight: "bold",
                  flexShrink: 0
                }}>1</span>
                <div>
                  <strong style={{ fontSize: "0.9rem", color: "#111111" }}>Mint QUSDC Mock Tokens</strong>
                  <p style={{ fontSize: "0.82rem", color: "#666666", margin: "2px 0 0 0", lineHeight: "1.4" }}>
                    In the <strong>Subscriber Panel</strong>, click the <strong>Mint Mock QUSDC</strong> button to add test stablecoins to your wallet.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ 
                  background: "#111111", 
                  color: "#ffffff", 
                  width: "24px", 
                  height: "24px", 
                  borderRadius: "50%", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  fontSize: "0.8rem",
                  fontWeight: "bold",
                  flexShrink: 0
                }}>2</span>
                <div>
                  <strong style={{ fontSize: "0.9rem", color: "#111111" }}>Verify QIE Pass DID</strong>
                  <p style={{ fontSize: "0.82rem", color: "#666666", margin: "2px 0 0 0", lineHeight: "1.4" }}>
                    Click <strong>Verify QIE Pass</strong>. This starts a simulated decentralized identity registration flow. Consent to KYC on the redirect page to verify your wallet onchain.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ 
                  background: "#111111", 
                  color: "#ffffff", 
                  width: "24px", 
                  height: "24px", 
                  borderRadius: "50%", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  fontSize: "0.8rem",
                  fontWeight: "bold",
                  flexShrink: 0
                }}>3</span>
                <div>
                  <strong style={{ fontSize: "0.9rem", color: "#111111" }}>Create a Subscription Stream</strong>
                  <p style={{ fontSize: "0.82rem", color: "#666666", margin: "2px 0 0 0", lineHeight: "1.4" }}>
                    Choose a merchant (or use the preloaded test merchant address) and set a duration. Click <strong>Start Stream</strong> to approve the allowance and create the onchain agreement.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div style={{ display: "flex", gap: "12px" }}>
                <span style={{ 
                  background: "#111111", 
                  color: "#ffffff", 
                  width: "24px", 
                  height: "24px", 
                  borderRadius: "50%", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  fontSize: "0.8rem",
                  fontWeight: "bold",
                  flexShrink: 0
                }}>4</span>
                <div>
                  <strong style={{ fontSize: "0.9rem", color: "#111111" }}>Monitor Sentry Telemetry</strong>
                  <p style={{ fontSize: "0.82rem", color: "#666666", margin: "2px 0 0 0", lineHeight: "1.4" }}>
                    Head to the <strong>AI Security Desk</strong> tab. You will see real-time log outputs of the AI sentry auditing your active streams and securing transaction states.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{ 
      display: "flex", 
      gap: "24px", 
      maxWidth: "1100px", 
      margin: "0 auto", 
      alignItems: "stretch",
      textAlign: "left",
      minHeight: "550px"
    }}>
      {/* Sidebar navigation */}
      <div style={{ 
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
              onClick={() => setActiveSection(section.id)}
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

      {/* Content pane */}
      <div 
        className="glass-card" 
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
