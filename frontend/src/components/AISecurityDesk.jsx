import React, { useState, useEffect, useRef } from "react";
import { Shield, Settings, Terminal, RefreshCw, AlertOctagon, Info, CheckCircle2 } from "lucide-react";

export default function AISecurityDesk({
  contracts,
  updateContractAddresses,
  subscriberStreams,
  merchantStreams,
  loading,
  refreshData
}) {
  const [telemetryLogs, setTelemetryLogs] = useState([]);
  const [serverOnline, setServerOnline] = useState(false);
  const [serverConfig, setServerConfig] = useState({
    rpcUrl: "https://rpc1testnet.qie.digital/",
    registryAddress: contracts.registry,
    auditorAddress: contracts.auditor,
    aiPrivateKey: ""
  });

  // Synchronize configuration form fields when active contract network switches
  useEffect(() => {
    const isTestnet = contracts.registry.toLowerCase() === "0x5650da53061edab0747549c81c8df774cf41aee9";
    setServerConfig(prev => ({
      ...prev,
      rpcUrl: isTestnet ? "https://rpc1testnet.qie.digital/" : "http://127.0.0.1:8545",
      registryAddress: contracts.registry,
      auditorAddress: contracts.auditor
    }));
  }, [contracts]);
  
  const [selectedStream, setSelectedStream] = useState("");
  const [anomalyReason, setAnomalyReason] = useState("Pricing anomaly: stream billing rate inflated without DID consent");
  const [savingConfig, setSavingConfig] = useState(false);
  const [injectingAnomaly, setInjectingAnomaly] = useState(false);

  const consoleEndRef = useRef(null);

  // Fetch telemetry logs from Express server
  const fetchTelemetry = async () => {
    try {
      const res = await fetch("http://localhost:5001/telemetry");
      if (res.ok) {
        const data = await res.json();
        setTelemetryLogs(data);
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
        { id: 1, timestamp: new Date(Date.now() - 60000).toISOString(), type: "INFO", message: "AI Auditor Simulation running. (Backend node offline)" },
        { id: 2, timestamp: new Date(Date.now() - 45000).toISOString(), type: "INFO", message: "Listening for Registry events..." },
        { id: 3, timestamp: new Date(Date.now() - 30000).toISOString(), type: "SUCCESS", message: "Security framework active: monitoring active streams." }
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
      qusd: contracts.qusd, // keep stablecoin
      qiepass: contracts.qiepass, // keep qiepass
      auditor: serverConfig.auditorAddress
    });

    try {
      const res = await fetch("http://localhost:5001/configure", {
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
      alert("Local storage updated. Connect to local Node.js backend to enable on-chain AI automation.");
    } finally {
      setSavingConfig(false);
    }
  };

  // Manually trigger anomaly safety pause
  const handleInjectAnomaly = async () => {
    if (!selectedStream) return;
    setInjectingAnomaly(true);
    
    try {
      const res = await fetch("http://localhost:5001/trigger-anomaly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subId: selectedStream,
          reason: anomalyReason
        })
      });
      
      if (res.ok) {
        alert("AI Safety Pause triggered successfully on-chain!");
        fetchTelemetry();
        refreshData();
      } else {
        const data = await res.json();
        alert(`Error triggering pause: ${data.error}`);
      }
    } catch (err) {
      // Offline fallback simulation
      console.warn("Backend offline. Simulating AI Auditor safety pause locally...");
      setTelemetryLogs(prev => [
        ...prev,
        {
          id: prev.length + 1,
          timestamp: new Date().toISOString(),
          type: "ALERT",
          message: `MANUAL ANOMALY DETECTED for stream: ${selectedStream}. Reason: ${anomalyReason}`
        },
        {
          id: prev.length + 2,
          timestamp: new Date().toISOString(),
          type: "SIMULATION",
          message: `Local simulated safety pause triggered. Run server.js with wallet configured to lock on-chain.`
        }
      ]);
      alert("Simulation logs updated. To pause on-chain, please launch the AI Auditor backend server.");
    } finally {
      setInjectingAnomaly(false);
    }
  };

  useEffect(() => {
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 3000);
    return () => clearInterval(interval);
  }, [contracts]);

  // Auto scroll console to bottom
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [telemetryLogs]);

  // Filter active streams
  const allActiveStreams = [...subscriberStreams, ...merchantStreams].filter(
    (v, i, a) => a.findIndex(t => t.id === v.id) === i && v.active && !v.pausedByAI
  );

  const getLogColor = (type) => {
    switch (type) {
      case "ALERT": return "var(--color-rose)";
      case "ACTION": return "var(--color-amber)";
      case "SUCCESS": return "var(--color-emerald)";
      case "AUDIT": return "var(--color-cyan)";
      case "SIMULATION": return "#a78bfa"; // Violet
      case "WARNING": return "var(--color-amber)";
      default: return "var(--text-secondary)";
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "24px" }}>
      
      {/* LEFT COLUMN: Operations and Settings */}
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        
        {/* Node Connection Status */}
        <div className="glass-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "8px" }}>
              <Shield size={18} color="var(--color-cyan)" />
              AI Auditor Node Status
            </h3>
            <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span className={`status-indicator ${serverOnline ? "status-online" : "status-paused"}`} />
              <span style={{ fontSize: "0.85rem", fontWeight: "bold" }}>
                {serverOnline ? "ONLINE" : "SIMULATION"}
              </span>
            </span>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
            {serverOnline ? (
              "Node is connected to blockchain RPC and actively auditing created subscription streams using LLM verification."
            ) : (
              "Node backend (port 5001) not detected. The dashboard is running in simulation mode. Launch server.js to connect."
            )}
          </p>
        </div>

        {/* Dynamic Contract Address Configuration Form */}
        <div className="glass-card">
          <h3 style={{ fontSize: "1.1rem", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "10px" }}>
            <Settings size={18} color="var(--color-purple)" />
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
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: "0.85rem" }}
                value={serverConfig.rpcUrl}
                onChange={(e) => setServerConfig({ ...serverConfig, rpcUrl: e.target.value })}
                required
              />
            </div>
            
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                QieFlowRegistry Contract Address
              </label>
              <input 
                type="text" 
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: "0.85rem", fontFamily: "monospace" }}
                value={serverConfig.registryAddress}
                onChange={(e) => setServerConfig({ ...serverConfig, registryAddress: e.target.value })}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                QieFlowAIAuditor Contract Address
              </label>
              <input 
                type="text" 
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: "0.85rem", fontFamily: "monospace" }}
                value={serverConfig.auditorAddress}
                onChange={(e) => setServerConfig({ ...serverConfig, auditorAddress: e.target.value })}
                required
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                AI Auditor Private Key (Optional for Simulation)
              </label>
              <input 
                type="password" 
                placeholder="0x..."
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: "0.85rem" }}
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
          <h3 style={{ fontSize: "1.1rem", color: "var(--color-rose)", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertOctagon size={18} />
            Simulate Pricing Exploits
          </h3>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "16px" }}>
            Trigger a manual billing exploit warning. The AI Auditor node will receive the telemetry alert, audit the rate parameters, and pause the payment stream on-chain.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                Select Active Payment Stream
              </label>
              <select 
                className="glass-card" 
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(17, 24, 43, 0.9)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: "0.85rem" }}
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
                style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", color: "#fff", fontSize: "0.85rem" }}
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
              Inject Pricing Exploit
            </button>
          </div>
        </div>

      </div>

      {/* RIGHT COLUMN: Console Event Telemetry */}
      <div className="glass-card" style={{ display: "flex", flexDirection: "column", height: "550px", position: "relative" }}>
        
        {/* Terminal Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <h3 style={{ fontSize: "1.1rem", display: "flex", alignItems: "center", gap: "8px" }}>
            <Terminal size={18} color="var(--color-cyan)" />
            AI Node Telemetry Logs
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
                <div style={{ paddingLeft: "15px", color: "var(--text-secondary)", fontSize: "0.75rem", marginTop: "2px" }}>
                  {JSON.stringify(log.details)}
                </div>
              )}
            </div>
          ))}
          <div ref={consoleEndRef} />
        </div>

      </div>

    </div>
  );
}
