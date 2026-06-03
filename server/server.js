require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const { OpenAI } = require("openai");
const crypto = require("crypto");

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5001;

// Telemetry database in memory
let telemetryLogs = [
  {
    id: 1,
    timestamp: new Date().toISOString(),
    type: "INFO",
    message: "AI Sentry Multi-Agent Node initializing...",
    details: {}
  }
];

// In-memory compliance & dispute report cache
let auditReports = {};

let monitoringActive = false;
let registryContract = null;
let auditorContract = null;
let provider = null;
let aiWallet = null;

// Settings
let RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
let REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS;
let AUDITOR_ADDRESS = process.env.AUDITOR_ADDRESS;
let AI_PRIVATE_KEY = process.env.AI_PRIVATE_KEY;

function logTelemetry(type, message, details = {}) {
  const logEntry = {
    id: telemetryLogs.length + 1,
    timestamp: new Date().toISOString(),
    type,
    message,
    details
  };
  telemetryLogs.push(logEntry);
  console.log(`[${type}] ${message}`, details);
}

// ==========================================
// MULTI-AGENT SENTRY ARCHITECTURE DEFINITION
// ==========================================

// 1. SENTRY AGENT: Blockchain Ingestion & Event Monitor
const SentryAgent = {
  async handleNewStream(subId, subscriber, merchant, tokenAddress, rate, cliff, stop) {
    logTelemetry("SENTRY_AGENT", `Captured new subscription stream: ${subId}. Forwarding to Analyst Agent...`, {
      subscriber,
      merchant,
      rate: rate.toString()
    });
    // Hand-off to Analyst Agent for compliance inspection
    await AnalystAgent.analyzeStream(subId, subscriber, merchant, tokenAddress, rate, cliff, stop);
  },

  handleStreamPaused(subId, reason) {
    logTelemetry("SENTRY_AGENT", `Registered StreamPaused event for ${subId}`, { reason });
  },

  handleStreamResumed(subId) {
    logTelemetry("SENTRY_AGENT", `Registered StreamResumed event for ${subId}`);
  },

  handleStreamTerminated(subId) {
    logTelemetry("SENTRY_AGENT", `Registered StreamTerminated event for ${subId}`);
  },

  handleFundsClaimed(subId, merchant, amount) {
    logTelemetry("SENTRY_AGENT", `Registered FundsWithdrawn event from stream ${subId}`, { merchant, amount: amount.toString() });
  },

  handleDisputeOpened(subId, subscriber) {
    logTelemetry("SENTRY_AGENT", `CRITICAL: DisputeOpened event captured for stream ${subId} by subscriber ${subscriber}`);
  },

  handleDisputeResolved(subId, subscriberRefund, merchantShare) {
    logTelemetry("SENTRY_AGENT", `DisputeResolved event captured for stream ${subId}`, {
      subscriberRefund: subscriberRefund.toString(),
      merchantShare: merchantShare.toString()
    });
  }
};

// 2. ANALYST AGENT: Metadata Inspector, Risk Modeling, & IPFS Report Generator
const AnalystAgent = {
  async analyzeStream(subId, subscriber, merchant, tokenAddress, rate, cliff, stop) {
    logTelemetry("ANALYST_AGENT", `Starting deep compliance audit for stream: ${subId}`);
    
    // Resolve merchant domain if possible via domain registry
    let domainName = "Unregistered Address";
    try {
      if (REGISTRY_ADDRESS) {
        // Retrieve qiedomain address dynamically from useFluenci addresses or local provider lookup
        // We use default deployment registry or address resolving
        const domainContractAddress = "0xD0B0432395B2f414A4d9B74BD51523687a02883c"; // Mainnet domain registry
        const domainContract = new ethers.Contract(domainContractAddress, [
          "function lookupAddress(address addr) external view returns (string memory)"
        ], provider);
        const res = await domainContract.lookupAddress(merchant);
        if (res && res !== "") {
          domainName = res;
          logTelemetry("ANALYST_AGENT", `Reverse domain lookup resolved: ${merchant} -> ${domainName}`);
        }
      }
    } catch (err) {
      logTelemetry("ANALYST_AGENT", "QieDomain reverse lookup failed or registry not configured.", { error: err.message });
    }

    // Determine pricing baseline & check rules
    const rateVal = Number(rate);
    const { compliant, riskScore, anomalyClass, reason } = await this.runComplianceAlgorithm(subId, merchant, domainName, tokenAddress, rateVal);

    // Compile Audit Intelligence Report
    const auditReport = {
      subId,
      timestamp: new Date().toISOString(),
      metadata: {
        subscriber,
        merchant,
        domainName,
        tokenAddress,
        rate: rate.toString(),
        cliff: cliff.toString(),
        stop: stop.toString()
      },
      evaluation: {
        compliant,
        riskScore,
        anomalyClass,
        reason
      }
    };

    // Pin report to simulated IPFS (Generate SHA256 CID)
    const jsonString = JSON.stringify(auditReport);
    const hash = crypto.createHash("sha256").update(jsonString).digest("hex");
    const ipfsCID = `ipfs://bafybeihash-${hash.substring(0, 32)}`;
    
    // Save report in local cache
    auditReports[subId] = {
      subId,
      riskScore,
      reason: `${reason} [IPFS CID: ${ipfsCID}]`,
      anomalyClass,
      ipfsCID,
      timestamp: new Date().toISOString()
    };

    logTelemetry("ANALYST_AGENT", `Audit Intelligence Report compiled and pinned to IPFS. CID: ${ipfsCID}`, {
      riskScore,
      anomalyClass,
      compliant
    });

    // Hand-off to Decision Agent
    await DecisionAgent.evaluateReport(subId, auditReport, ipfsCID);
  },

  async runComplianceAlgorithm(subId, merchant, domainName, tokenAddress, rate) {
    let riskScore = 15;
    let reason = "Rate falls within safe baseline parameters.";
    let anomalyClass = "NONE";

    // Auto-flag if rate is unusually high (e.g. rate >= 1000 tokens/sec)
    if (rate >= 1000) {
      riskScore = 95;
      reason = "Extremely high payment velocity detected. Immediate drain risk identified.";
      anomalyClass = "VELOCITY_EXPLOIT";
      return { compliant: false, riskScore, anomalyClass, reason };
    }

    if (openai) {
      try {
        logTelemetry("ANALYST_AGENT", `Querying OpenAI GPT-4o for risk assessment...`);
        const prompt = `
You are the autonomous AI Analyst Agent for Fluenci, a streaming payment protocol on the QIE Blockchain.
Analyze the stream parameters and determine if the stream rate is safe/compliant or represents a pricing exploit.

Stream Details:
- Subscription ID: ${subId}
- Merchant Wallet: ${merchant} (Domain Name: ${domainName})
- Token Address: ${tokenAddress}
- Streaming Rate: ${rate} units per second.

Decide if this rate is compliant or represents a billing anomaly/exploit.
Return your response EXACTLY as a JSON object, with no markdown styling, in this format:
{
  "compliant": true or false,
  "riskScore": (number from 0 to 100),
  "anomalyClass": "VELOCITY_EXPLOIT" or "SUSPICIOUS_MERCHANT" or "NONE",
  "reason": "Clear explanation of the decision"
}
`;
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content.trim());
        return {
          compliant: result.compliant,
          riskScore: result.riskScore || (result.compliant ? 15 : 85),
          anomalyClass: result.anomalyClass || (result.compliant ? "NONE" : "VELOCITY_EXPLOIT"),
          reason: result.reason
        };
      } catch (error) {
        logTelemetry("ANALYST_AGENT", `OpenAI API call failed: ${error.message}. Falling back to default rule heuristic.`);
      }
    }

    return { compliant: true, riskScore, anomalyClass, reason };
  }
};

// 3. DECISION AGENT: Hot-Wallet Controller & Execution Engine
const DecisionAgent = {
  async evaluateReport(subId, report, ipfsCID) {
    const riskThreshold = 75;
    const risk = report.evaluation.riskScore;

    logTelemetry("DECISION_AGENT", `Evaluating Audit Report for stream ${subId}. Risk: ${risk}% (Threshold: ${riskThreshold}%)`);

    if (risk >= riskThreshold) {
      logTelemetry("DECISION_AGENT", `CRITICAL: Risk score ${risk}% exceeds threshold! Executing autonomous safety pause on-chain...`);

      if (auditorContract && aiWallet) {
        try {
          // Send transaction containing IPFS CID of the audit report as the reason
          const tx = await auditorContract.triggerSafetyPause(subId, ipfsCID);
          logTelemetry("DECISION_AGENT", `On-chain safety pause tx broadcasted. Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          logTelemetry("DECISION_AGENT", `Safety pause confirmed in block ${receipt.blockNumber}. Stream has been locked on-chain.`);
        } catch (err) {
          logTelemetry("DECISION_AGENT", `FAILED to execute safety pause: ${err.message}`);
        }
      } else {
        logTelemetry("DECISION_AGENT", `[SIMULATION] Safety pause triggered. Report CID ${ipfsCID} stored in memory.`);
      }
    } else {
      logTelemetry("DECISION_AGENT", `Stream ${subId} passed safety threshold. Monitoring active.`);
    }
  }
};

// 4. ARBITRATOR AGENT: Verifiable EIP-712 Dispute Arbiter
const ArbitratorAgent = {
  async arbitrate(subId, evidence, merchantShareReq, subscriberRefundReq) {
    logTelemetry("ARBITRATOR_AGENT", `Dispute arbitration initialized for stream: ${subId}`);
    
    let subscriberRefund = subscriberRefundReq || 1000;
    let merchantShare = merchantShareReq || 0;
    let decisionText = "Refund approved. Arbitrator Agent determined merchant failed to deliver continuous uptime.";

    if (openai) {
      try {
        logTelemetry("ARBITRATOR_AGENT", "Querying OpenAI GPT-4o to resolve dispute...");
        const prompt = `
You are the autonomous AI Arbitrator Agent for Fluenci, a streaming payment protocol on the QIE Blockchain.
A dispute has been opened by a subscriber. You must evaluate the evidence and calculate a fair token split.

Dispute Details:
- Subscription ID: ${subId}
- Subscriber Evidence: "${evidence}"
- Request parameters: Merchant Share = ${merchantShareReq}, Subscriber Refund = ${subscriberRefundReq}

Provide your decision and calculate the exact split of the accrued tokens.
Return your response EXACTLY as a JSON object, with no markdown styling, in this format:
{
  "subscriberRefund": (number representing refund tokens),
  "merchantShare": (number representing payout tokens),
  "decision": "Detailed explanation of your arbitration ruling"
}
`;
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message.content.trim());
        subscriberRefund = Number(result.subscriberRefund);
        merchantShare = Number(result.merchantShare);
        decisionText = result.decision;
        logTelemetry("ARBITRATOR_AGENT", `Arbitration decision formulated: ${decisionText}`);
      } catch (error) {
        logTelemetry("ARBITRATOR_AGENT", `AI Arbitration API failed: ${error.message}. Falling back to default split.`);
      }
    }

    let signature = "0x1234567890";
    if (aiWallet && REGISTRY_ADDRESS) {
      try {
        const msgHash = ethers.solidityPackedKeccak256(
          ["bytes32", "uint256", "uint256", "address"],
          [subId, subscriberRefund, merchantShare, REGISTRY_ADDRESS]
        );
        signature = await aiWallet.signMessage(ethers.getBytes(msgHash));
        logTelemetry("ARBITRATOR_AGENT", `Arbitration signature generated successfully. Signer: ${aiWallet.address}`);
      } catch (err) {
        logTelemetry("ARBITRATOR_AGENT", `Failed to sign dispute arbitration: ${err.message}`);
      }
    }

    return {
      success: true,
      merchantShare,
      subscriberRefund,
      decision: decisionText,
      signature
    };
  }
};

// ==========================================
// BLOCKCHAIN CONNECTION MANAGER
// ==========================================

async function connectBlockchain() {
  try {
    logTelemetry("INFO", `Connecting to RPC URL: ${RPC_URL}`);
    provider = new ethers.JsonRpcProvider(RPC_URL);
    
    const network = await provider.getNetwork();
    logTelemetry("INFO", `Connected to blockchain. Chain ID: ${Number(network.chainId)}`);

    if (REGISTRY_ADDRESS && AUDITOR_ADDRESS) {
      logTelemetry("INFO", `Configuring contracts. Registry: ${REGISTRY_ADDRESS}, Auditor: ${AUDITOR_ADDRESS}`);
      
      const REGISTRY_ABI = [
        "event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, address indexed merchant, address tokenAddress, uint256 ratePerSecond, uint256 cliffTime, uint256 stopTime)",
        "event StreamPaused(bytes32 indexed subId, string reason)",
        "event StreamResumed(bytes32 indexed subId)",
        "event StreamTerminated(bytes32 indexed subId)",
        "event FundsWithdrawn(bytes32 indexed subId, address indexed merchant, uint256 amount)",
        "event DisputeOpened(bytes32 indexed subId, address indexed subscriber)",
        "event DisputeResolved(bytes32 indexed subId, uint256 subscriberRefund, uint256 merchantShare)"
      ];

      registryContract = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

      if (AI_PRIVATE_KEY) {
        aiWallet = new ethers.Wallet(AI_PRIVATE_KEY, provider);
        const AUDITOR_ABI = [
          "function triggerSafetyPause(bytes32 subId, string calldata reason) external",
          "event AnomalyReported(bytes32 indexed subId, string reason, uint256 timestamp)"
        ];
        auditorContract = new ethers.Contract(AUDITOR_ADDRESS, AUDITOR_ABI, aiWallet);
        logTelemetry("INFO", `AI Wallet loaded: ${aiWallet.address}. Node is in ACTIVE automated audit mode.`);
      } else {
        logTelemetry("WARNING", "AI_PRIVATE_KEY not provided. Node running in SIMULATION/TELEMETRY-ONLY mode.");
      }

      setupEventListeners();
      monitoringActive = true;
    } else {
      logTelemetry("WARNING", "Contract addresses not fully configured in env. Waiting for configuration...");
    }
  } catch (error) {
    logTelemetry("ERROR", `Failed to connect to blockchain: ${error.message}`);
    logTelemetry("INFO", "Node will retry connection when API settings are updated.");
  }
}

function setupEventListeners() {
  if (!registryContract) return;

  logTelemetry("INFO", "Registering on-chain contract event listeners...");

  registryContract.on("SubscriptionCreated", async (subId, subscriber, merchant, tokenAddress, rate, cliff, stop) => {
    await SentryAgent.handleNewStream(subId, subscriber, merchant, tokenAddress, rate, cliff, stop);
  });

  registryContract.on("StreamPaused", (subId, reason) => {
    SentryAgent.handleStreamPaused(subId, reason);
  });

  registryContract.on("StreamResumed", (subId) => {
    SentryAgent.handleStreamResumed(subId);
  });

  registryContract.on("StreamTerminated", (subId) => {
    SentryAgent.handleStreamTerminated(subId);
  });

  registryContract.on("FundsWithdrawn", (subId, merchant, amount) => {
    SentryAgent.handleFundsClaimed(subId, merchant, amount);
  });

  registryContract.on("DisputeOpened", (subId, subscriber) => {
    SentryAgent.handleDisputeOpened(subId, subscriber);
  });

  registryContract.on("DisputeResolved", (subId, subscriberRefund, merchantShare) => {
    SentryAgent.handleDisputeResolved(subId, subscriberRefund, merchantShare);
  });
}

// ==========================================
// REST API ENDPOINTS
// ==========================================

app.get("/status", (req, res) => {
  res.json({
    status: "online",
    monitoringActive,
    rpcUrl: RPC_URL,
    contracts: {
      registry: REGISTRY_ADDRESS,
      auditor: AUDITOR_ADDRESS
    },
    aiWorker: aiWallet ? aiWallet.address : "simulation-mode"
  });
});

app.get("/telemetry", (req, res) => {
  res.json(telemetryLogs);
});

// Fetch detailed AI audit report
app.get("/audit-report/:subId", (req, res) => {
  const { subId } = req.params;
  const report = auditReports[subId] || {
    subId,
    riskScore: 10,
    reason: "No active anomaly reports found. Stream is operating in compliant normal range.",
    anomalyClass: "NONE",
    ipfsCID: "N/A",
    timestamp: new Date().toISOString()
  };
  res.json(report);
});

// AI Dispute Arbitration endpoint (Delegates to ArbitratorAgent)
app.post("/arbitrate-dispute", async (req, res) => {
  const { subId, evidence, merchantShare, subscriberRefund } = req.body;
  if (!subId) {
    return res.status(400).json({ error: "Missing subId" });
  }

  const result = await ArbitratorAgent.arbitrate(subId, evidence, merchantShare, subscriberRefund);
  res.json(result);
});

// Configure contract addresses dynamically from the UI
app.post("/configure", async (req, res) => {
  const { rpcUrl, registryAddress, auditorAddress, aiPrivateKey } = req.body;
  
  if (rpcUrl) RPC_URL = rpcUrl;
  if (registryAddress) REGISTRY_ADDRESS = registryAddress;
  if (auditorAddress) AUDITOR_ADDRESS = auditorAddress;
  if (aiPrivateKey) AI_PRIVATE_KEY = aiPrivateKey;

  logTelemetry("INFO", "Configuration updated via API. Reconnecting to blockchain...");
  
  // Reset listeners
  if (registryContract) {
    registryContract.removeAllListeners();
  }
  
  // Re-establish connection
  await connectBlockchain();
  
  res.json({ success: true, message: "Configuration updated, node reconnecting." });
});

// Manually trigger a safety pause via REST API
app.post("/trigger-anomaly", async (req, res) => {
  const { subId, reason } = req.body;
  if (!subId) {
    return res.status(400).json({ error: "Missing subId" });
  }

  logTelemetry("ALERT", `MANUAL ANOMALY INJECTED for stream: ${subId}. Reason: ${reason || "User-triggered anomaly"}`);

  // Create a mock audit report for manual trigger
  const mockReport = {
    subId,
    timestamp: new Date().toISOString(),
    metadata: { rate: "1500" },
    evaluation: { compliant: false, riskScore: 99, anomalyClass: "VELOCITY_EXPLOIT", reason }
  };
  const jsonString = JSON.stringify(mockReport);
  const hash = crypto.createHash("sha256").update(jsonString).digest("hex");
  const ipfsCID = `ipfs://bafybeihash-${hash.substring(0, 32)}`;

  auditReports[subId] = {
    subId,
    riskScore: 99,
    reason: `${reason || "Manual Override"} [IPFS CID: ${ipfsCID}]`,
    anomalyClass: "VELOCITY_EXPLOIT",
    ipfsCID,
    timestamp: new Date().toISOString()
  };

  await DecisionAgent.evaluateReport(subId, mockReport, ipfsCID);
  res.json({ success: true, ipfsCID });
});

// Start Express Server and Connect
app.listen(PORT, async () => {
  console.log(`AI Auditor API Server running on port ${PORT}`);
  await connectBlockchain();
});
