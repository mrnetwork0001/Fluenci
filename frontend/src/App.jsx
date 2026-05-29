import React, { useState, useEffect } from "react";
import { useQieFlow } from "./hooks/useQieFlow";
import ConnectWallet from "./components/ConnectWallet";
import SubscriberPanel from "./components/SubscriberPanel";
import MerchantDashboard from "./components/MerchantDashboard";
import AISecurityDesk from "./components/AISecurityDesk";
import { Shield, Sparkles, Building2, UserCircle, Terminal, HelpCircle, Activity } from "lucide-react";

// Default QIE Testnet deployment addresses
const DEFAULT_HARDHAT_CONTRACTS = {
  registry: "0x5650DA53061EdAB0747549c81c8df774Cf41AeE9",
  qusd: "0x5784640BD820d5e48C918C1AaD52aD7DDb562cBA",
  qiepass: "0x5D5f0BA355B52938e140B5500A27Bd3F70A420e2",
  auditor: "0x75474b0Be53403F0c8e66249266445e00bD7Cc70"
};

export default function App() {
  const qieflow = useQieFlow();
  const [activeTab, setActiveTab] = useState("subscriber");

  // Prepopulate contract addresses if empty
  useEffect(() => {
    if (!qieflow.contracts.registry || !qieflow.contracts.qusd || !qieflow.contracts.qiepass || !qieflow.contracts.auditor) {
      qieflow.updateContractAddresses(DEFAULT_HARDHAT_CONTRACTS);
    }
  }, [qieflow]);

  const renderActiveTab = () => {
    switch (activeTab) {
      case "subscriber":
        return (
          <SubscriberPanel
            account={qieflow.account}
            qusdBalance={qieflow.qusdBalance}
            qusdAllowance={qieflow.qusdAllowance}
            qiePassVerified={qieflow.qiePassVerified}
            subscriberStreams={qieflow.subscriberStreams}
            realtimeClaimables={qieflow.realtimeClaimables}
            loading={qieflow.loading}
            mintMockQUSD={qieflow.mintMockQUSD}
            approveQUSD={qieflow.approveQUSD}
            toggleQiePassStatus={qieflow.toggleQiePassStatus}
            createSubscription={qieflow.createSubscription}
            resumeStream={qieflow.resumeStream}
            terminateStream={qieflow.terminateStream}
          />
        );
      case "merchant":
        return (
          <MerchantDashboard
            account={qieflow.account}
            qusdBalance={qieflow.qusdBalance}
            merchantStreams={qieflow.merchantStreams}
            realtimeClaimables={qieflow.realtimeClaimables}
            loading={qieflow.loading}
            claimStream={qieflow.claimStream}
          />
        );
      case "security":
        return (
          <AISecurityDesk
            contracts={qieflow.contracts}
            updateContractAddresses={qieflow.updateContractAddresses}
            subscriberStreams={qieflow.subscriberStreams}
            merchantStreams={qieflow.merchantStreams}
            loading={qieflow.loading}
            refreshData={qieflow.refreshData}
          />
        );
      default:
        return null;
    }
  };

  const isSupportedNetwork = qieflow.chainId === 1983 || qieflow.chainId === 31337;

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
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div 
            style={{ 
              background: "linear-gradient(135deg, #00f2fe 0%, #9d4edd 100%)",
              padding: "10px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 15px rgba(0, 242, 254, 0.2)"
            }}
          >
            <Shield size={22} color="#000" />
          </div>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: "800", color: "#fff", lineHeight: "1.2" }}>
              QieFlow
            </h1>
            <span style={{ fontSize: "0.75rem", color: "var(--color-cyan)", fontWeight: "600", tracking: "0.05em" }}>
              AI-SHIELDED PAYMENT STREAMS
            </span>
          </div>
        </div>

        {/* Tab Navigation (only visible when connected) */}
        {qieflow.account && isSupportedNetwork && (
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
          account={qieflow.account}
          chainId={qieflow.chainId}
          connectWallet={qieflow.connectWallet}
          loading={qieflow.loading}
        />
      </header>

      {/* Main Content Area */}
      <main style={{ flexGrow: 1, padding: "40px", maxWidth: "1200px", width: "100%", margin: "0 auto" }}>
        
        {/* Error alert banner */}
        {qieflow.error && (
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
            <span>{qieflow.error}</span>
          </div>
        )}

        {/* Network Warning Banner */}
        {qieflow.account && !isSupportedNetwork && (
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
              QieFlow operates on the **QIE Testnet (Chain ID: 1983)** or a local Hardhat chain (Chain ID: 31337). 
              Please switch your MetaMask network connection.
            </p>
            <button className="btn btn-primary" onClick={qieflow.switchToQieTestnet}>
              Switch Network in MetaMask
            </button>
          </div>
        )}

        {/* tab Content display */}
        {qieflow.account ? (
          isSupportedNetwork ? (
            renderActiveTab()
          ) : null
        ) : (
          /* Landing Promo view when wallet is not connected */
          <div 
            className="glass-card" 
            style={{ 
              textAlign: "center", 
              padding: "80px 40px", 
              maxWidth: "800px", 
              margin: "40px auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "24px"
            }}
          >
            <div 
              style={{ 
                background: "linear-gradient(135deg, rgba(0, 242, 254, 0.1) 0%, rgba(157, 78, 221, 0.1) 100%)",
                width: "100px",
                height: "100px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid rgba(0, 242, 254, 0.2)",
                boxShadow: "0 0 30px rgba(0, 242, 254, 0.1)"
              }}
            >
              <Shield size={46} color="var(--color-cyan)" className="pulse" />
            </div>

            <div>
              <h2 style={{ fontSize: "2.4rem", fontFamily: "var(--font-title)", fontWeight: "800", color: "#fff", marginBottom: "12px" }}>
                AI-Shielded Recurring Streams
              </h2>
              <p style={{ fontSize: "1.05rem", color: "var(--text-secondary)", lineHeight: "1.6", maxWidth: "600px", margin: "0 auto" }}>
                Stop blind payment streams. QieFlow integrates an autonomous off-chain AI Auditor Agent 
                that monitors subscription telemetry, flags billing anomalies, and executes instant contract-level stream pauses.
              </p>
            </div>

            <div style={{ display: "flex", gap: "16px", marginTop: "12px" }}>
              <button className="btn btn-primary" onClick={qieflow.connectWallet}>
                Get Started
              </button>
            </div>

            {/* Core Tech Gating highlights */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", width: "100%", marginTop: "40px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "40px" }}>
              <div>
                <h4 style={{ color: "var(--color-cyan)", marginBottom: "8px" }}>QIE Pass Gated</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.4" }}>
                  Streams and anomaly resolutions are secure-gated via verified DID identity checks.
                </p>
              </div>
              <div>
                <h4 style={{ color: "var(--color-purple)", marginBottom: "8px" }}>Stablecoin (qUSD)</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.4" }}>
                  Subscriptions are settled in mock QIE Stable Coins to completely eliminate volatility.
                </p>
              </div>
              <div>
                <h4 style={{ color: "var(--color-amber)", marginBottom: "8px" }}>Autonomous AI Auditor</h4>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.4" }}>
                  An AI agent automatically pauses streams if it detects unauthorized rate adjustments.
                </p>
              </div>
            </div>
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
          fontSize: "0.8rem",
          color: "var(--text-muted)",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          alignItems: "center"
        }}
      >
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "16px" }}>
          <span>Registry: <strong style={{ color: "var(--color-cyan)" }}>{qieflow.contracts.registry}</strong></span>
          <span>qUSD: <strong style={{ color: "var(--color-cyan)" }}>{qieflow.contracts.qusd}</strong></span>
          <span>QiePass: <strong style={{ color: "var(--color-cyan)" }}>{qieflow.contracts.qiepass}</strong></span>
          <span>Auditor: <strong style={{ color: "var(--color-cyan)" }}>{qieflow.contracts.auditor}</strong></span>
        </div>
        <p>© 2026 QieFlow Protocol. Built for QIE Blockchain Hackathon. All rights reserved.</p>
      </footer>
    </div>
  );
}
