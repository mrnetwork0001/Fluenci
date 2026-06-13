import React, { useState, useEffect, useRef } from "react";
import { Shield, Settings, Terminal, RefreshCw, AlertOctagon, Info, CheckCircle2 } from "lucide-react";
import { API_BASE_URL } from "../config";

export default function AISecurityDesk({
  contracts,
  account,
  updateContractAddresses,
  subscriberStreams,
  merchantStreams,
  loading,
  refreshData
}) {
  const [telemetryLogs, setTelemetryLogs] = useState([]);
  const [serverOnline, setServerOnline] = useState(false);
  const [serverConfig, setServerConfig] = useState({
    rpcUrl: "https://rpc1mainnet.qie.digital",
    registryAddress: contracts.registry,
    auditorAddress: contracts.auditor,
    aiPrivateKey: ""
  });

  // Synchronize configuration form fields when active contract network switches
  useEffect(() => {
    setServerConfig(prev => ({
      ...prev,
      rpcUrl: "https://rpc1mainnet.qie.digital",
      registryAddress: contracts.registry,
      auditorAddress: contracts.auditor
    }));
  }, [contracts]);
  
  const [selectedStream, setSelectedStream] = useState("");
  const [anomalyReason, setAnomalyReason] = useState("Pricing anomaly: stream billing rate inflated without DID consent");
  const [savingConfig, setSavingConfig] = useState(false);
  const [injectingAnomaly, setInjectingAnomaly] = useState(false);

  const consoleEndRef = useRef(null);

  // Fetch telemetry logs from Express server (wallet-scoped)
  const fetchTelemetry = async () => {
    try {
      const walletParam = account ? `?wallet=${account}` : "";
      const res = await fetch(`${API_BASE_URL}/telemetry${walletParam}`);
      if (res.ok) {
        const data = await res.json();
        const logsArray = Array.isArray(data) ? data : (data.logs || []);
        setTelemetryLogs(logsArray);
        setServerOnline(true);
      } else {
        setServerOnline(false);
      }
    } catch (err) {
      setServerOnline(false);
      // Generate simulated logs if backend is not running, so the UI is always impressive and interactive!
      simulateLogs();
    }
  };

  const simulateLogs = () => {
    if (telemetryLogs.length === 0) {
      setTelemetryLogs([
        { id: 1, timestamp: new Date().toISOString(), type: "SYSTEM", message: "Listening for AI Sentry node connection on port 5001..." },
        { id: 2, timestamp: new Date().toISOString(), type: "SYSTEM", message: "Status: Standby. Awaiting real-time telemetry from active auditing loops." }
      ]);
    }
  };

  // Configure Express server
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    setSavingConfig(true);
    
    // Save locally
    updateContractAddresses({
      registry: serverConfig.registryAddress,
      auditor: serverConfig.auditorAddress
    });

    try {
      const res = await fetch(`${API_BASE_URL}/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rpcUrl: serverConfig.rpcUrl,
          registryAddress: serverConfig.registryAddress,
          auditorAddress: serverConfig.auditorAddress,
          aiPrivateKey: serverConfig.aiPrivateKey
        })
      });
      if (res.ok) {
        alert("Server configuration updated successfully!");
        fetchTelemetry();
      }
    } catch (err) {
      console.warn("Backend node offline. Deployed addresses updated in browser local storage.");
      alert("Local storage updated. Connect to local Node.js backend to enable onchain AI automation.");
    } finally {
      setSavingConfig(false);
    }
  };

  // Manually trigger anomaly safety pause
  const handleInjectAnomaly = async () => {
    if (!selectedStream) return;
    setInjectingAnomaly(true);
    
    try {
      const res = await fetch(`${API_BASE_URL}/trigger-anomaly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subId: selectedStream,
          reason: anomalyReason
        })
      });
      
      if (res.ok) {
        alert("AI Safety Pause triggered successfully onchain!");
        fetchTelemetry();
        refreshData();
      } else {
        const data = await res.json();
        alert(`Error triggering pause: ${data.error}`);
      }
    } catch (err) {
      console.warn("Backend offline. Failed to trigger safety pause.");
      alert("Failed to trigger safety pause: AI Auditor backend server is offline.");
    } finally {
      setInjectingAnomaly(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(interval);
  }, [contracts, account]);

  // Filter active streams
  const allActiveStreams = [...subscriberStreams, ...merchantStreams].filter(
    (v, i, a) => a.findIndex(t => t.id === v.id) === i && v.active && !v.pausedByAI
  );

  const getLogColor = (type) => {
    switch (type) {
      case "ALERT": return "#999999";
      case "ACTION": return "#999999";
      case "SUCCESS": return "#ffffff";
      case "AUDIT": return "#ffffff";
      case "SENTRY_AGENT": return "#ffffff"; // Blue
      case "ANALYST_AGENT": return "#888888"; // Purple
      case "DECISION_AGENT": return "#10b981"; // Emerald
      case "ARBITRATOR_AGENT": return "#f59e0b"; // Amber
      case "SIMULATION": return "#a78bfa"; // Violet
      case "WARNING": return "#999999";
      default: return "var(--text-secondary)";
    }
  };

  return (
    <div className="ai-security-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "24px" }}>
      
      {/* LEFT COLUMN: Operations and Settings */}
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        
        {/* Node Connection Status */}
        <div className="glass-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "8px" }}>
              <Shield size={18} color="#333333" />
              AI Sentry Control Center
            </h3>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span className={`status-indicator ${serverOnline ? "status-online" : "status-paused"}`} />
              <span style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                {serverOnline ? "MULTI-AGENT ACTIVE" : "OFFLINE"}
              </span>
            </span>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
            {serverOnline ? (
              "Multi-Agent Sentry node is connected. Ingestion, fraud analysis, and safety execution loops are running."
            ) : (
              "Node backend offline. Start the backend node server (server.js) to enable real-time telemetry and autonomous AI safety pausing."
            )}
          </p>
        </div>

        {/* AI Agents Control Center Grid */}
        <div className="ai-agents-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
          
          <div className="glass-card" style={{ padding: "14px", border: "1px solid rgba(7, 154, 183, 0.25)", display: "flex", flexDirection: "column", gap: "6px", background: "rgba(7, 154, 183, 0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: "#079AB7" }}>Sentry Agent</span>
              <span className="status-indicator status-online" style={{ background: "#079AB7", boxShadow: "0 0 8px #079AB7" }} />
            </div>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Blockchain ingestion & mempool filter</span>
          </div>

          <div className="glass-card" style={{ padding: "14px", border: "1px solid #e0e0e0", display: "flex", flexDirection: "column", gap: "6px", background: "rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: "#666666" }}>Analyst Agent</span>
              <span className="status-indicator status-online" style={{ background: "#888888", boxShadow: "0 0 8px #888888" }} />
            </div>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>LLM pricing audits & IPFS reports</span>
          </div>

          <div className="glass-card" style={{ padding: "14px", border: "1px solid rgba(16, 185, 129, 0.2)", display: "flex", flexDirection: "column", gap: "6px", background: "rgba(16, 185, 129, 0.02)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: "#10b981" }}>Decision Agent</span>
              <span className="status-indicator status-online" style={{ background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
            </div>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Autonomous onchain safety pausing</span>
          </div>

          <div className="glass-card" style={{ padding: "14px", border: "1px solid rgba(245, 158, 11, 0.2)", display: "flex", flexDirection: "column", gap: "6px", background: "rgba(245, 158, 11, 0.02)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: "bold", color: "#f59e0b" }}>Arbitrator Agent</span>
              <span className="status-indicator status-online" style={{ background: "#f59e0b", boxShadow: "0 0 8px #f59e0b" }} />
            </div>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>EIP-712 dispute split calculations</span>
          </div>

        </div>

        {/* Dynamic Contract Address Configuration Form */}
        <div className="glass-card">
          <h3 style={{ fontSize: "1.1rem", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "10px" }}>
            <Settings size={18} color="#666666" />
            Auditor Node Configuration
          </h3>
          
          <form onSubmit={handleSaveConfig} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                Blockchain Provider RPC URL
              </label>
              <input 
                type="text" 
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid #e0e0e0", color: "#111111", fontSize: "0.85rem" }}
                value={serverConfig.rpcUrl}
                onChange={(e) => setServerConfig({ ...serverConfig, rpcUrl: e.target.value })}
                required
              />
            </div>
            
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                FluenciRegistry Contract Address
              </label>
              <input 
                type="text" 
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid #e0e0e0", color: "#111111", fontSize: "0.85rem", fontFamily: "monospace" }}
                value={serverConfig.registryAddress}
                onChange={(e) => setServerConfig({ ...serverConfig, registryAddress: e.target.value })}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                FluenciAIAuditor Contract Address
              </label>
              <input 
                type="text" 
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid #e0e0e0", color: "#111111", fontSize: "0.85rem", fontFamily: "monospace" }}
                value={serverConfig.auditorAddress}
                onChange={(e) => setServerConfig({ ...serverConfig, auditorAddress: e.target.value })}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                AI Auditor Private Key (Enables Autonomous Pausing)
              </label>
              <input 
                type="password" 
                placeholder="0x..."
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid #e0e0e0", color: "#111111", fontSize: "0.85rem" }}
                value={serverConfig.aiPrivateKey}
                onChange={(e) => setServerConfig({ ...serverConfig, aiPrivateKey: e.target.value })}
              />
            </div>

            <button 
              type="submit" 
              className="btn btn-secondary" 
              style={{ marginTop: "8px", alignSelf: "flex-end", fontSize: "0.8rem", padding: "8px 16px" }}
              disabled={savingConfig}
            >
              Update Config
            </button>
          </form>
        </div>

        {/* Manual Anomaly Trigger Gating */}
        <div className="glass-card" style={{ border: "1px dashed rgba(244, 63, 94, 0.3)" }}>
          <h3 style={{ fontSize: "1.1rem", color: "#777777", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertOctagon size={18} />
            SecOps Emergency Control
          </h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            Manually trigger an anomaly alert for a payment stream. The AI Sentry node will compile the compliance audit report and execute an autonomous safety pause onchain.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                Select Active Payment Stream
              </label>
              <select 
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(17, 24, 43, 0.9)", border: "1px solid #e0e0e0", color: "#ffffff", fontSize: "0.85rem" }}
                value={selectedStream}
                onChange={(e) => setSelectedStream(e.target.value)}
              >
                <option value="">-- Choose active stream --</option>
                {allActiveStreams.map((s) => (
                  <option key={s.id} value={s.id}>
                    ID: {s.id.substring(0, 10)}... (Rate: {((s.ratePerSecond * 3600) / 1e6).toFixed(2)} qUSD/hr)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                Audit Exploit Details (Reason)
              </label>
              <input 
                type="text" 
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "#f8f8f8", border: "1px solid #e0e0e0", color: "#111111", fontSize: "0.85rem" }}
                value={anomalyReason}
                onChange={(e) => setAnomalyReason(e.target.value)}
              />
            </div>

            <button 
              className="btn btn-danger" 
              style={{ alignSelf: "flex-start", marginTop: "4px", fontSize: "0.8rem", padding: "8px 16px" }}
              disabled={injectingAnomaly || !selectedStream}
              onClick={handleInjectAnomaly}
            >
              Trigger Safety Pause
            </button>
          </div>
        </div>

      </div>

      {/* RIGHT COLUMN: Console Event Telemetry */}
      <div className="glass-card" style={{ display: "flex", flexDirection: "column", height: "650px", position: "relative" }}>
        
        {/* Terminal Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "8px" }}>
            <Terminal size={18} color="#333333" />
            AI Sentry Log Telemetry
          </h3>
          <button 
            className="btn btn-secondary" 
            style={{ padding: "4px 8px", fontSize: "0.75rem" }}
            onClick={fetchTelemetry}
          >
            <RefreshCw size={12} />
          </button>
        </div>

        {/* Scan lines animation */}
        <div className="scanner-line" />

        {/* Terminal Screen */}
        <div 
          style={{ 
            flexGrow: 1, 
            background: "rgba(0, 0, 0, 0.5)", 
            borderRadius: "8px", 
            padding: "16px", 
            fontFamily: "monospace", 
            fontSize: "0.8rem", 
            lineHeight: "1.5", 
            overflowY: "auto", 
            border: "1px solid rgba(255,255,255,0.05)"
          }}
        >
          {telemetryLogs.map((log) => (
            <div key={log.id} style={{ marginBottom: "12px", borderBottom: "1px solid rgba(255,255,255,0.02)", paddingBottom: "6px" }}>
              <span style={{ color: "var(--text-muted)" }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{" "}
              <span style={{ color: getLogColor(log.type), fontWeight: "bold" }}>[{log.type}]</span>{" "}
              <span style={{ color: "var(--text-primary)" }}>{log.message}</span>
              {log.details && Object.keys(log.details).length > 0 && (
                <div style={{ paddingLeft: "15px", color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: "2px", wordBreak: "break-all" }}>
                  {JSON.stringify(log.details)}
                </div>
              )}
            </div>
          ))}
        </div>

      </div>

    </div>
  );
}
