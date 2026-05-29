require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const { OpenAI } = require("openai");

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
    message: "AI Auditor node initializing...",
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

// Connect to Blockchain
async function connectBlockchain() {
  try {
    logTelemetry("INFO", `Connecting to RPC URL: ${RPC_URL}`);
    provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Check network
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

  // 1. Subscription Created Event
  registryContract.on("SubscriptionCreated", async (subId, subscriber, merchant, tokenAddress, rate, cliff, stop, event) => {
    logTelemetry("AUDIT", `New stream detected: ${subId}`, {
      subscriber,
      merchant,
      tokenAddress,
      rate: rate.toString(),
      cliff: cliff.toString(),
      stop: stop.toString()
    });

    // Run pricing audit
    const isCompliant = await runPricingAudit(subId, merchant, tokenAddress, Number(rate));
    
    if (!isCompliant) {
      logTelemetry("ALERT", `ANOMALY FLAGGED for stream: ${subId}. Rate of ${rate.toString()} exceeds compliance baseline.`, {
        subId,
        merchant,
        rate: rate.toString()
      });

      if (auditorContract && aiWallet) {
        try {
          logTelemetry("ACTION", `Sending automated safety pause tx on-chain for stream: ${subId}...`);
          const tx = await auditorContract.triggerSafetyPause(subId, "AI Auditor flag: rate exceeds baseline index limit");
          logTelemetry("ACTION", `Tx submitted. Hash: ${tx.hash}`);
          await tx.wait();
          logTelemetry("SUCCESS", `On-chain safety pause executed successfully for ${subId}`);
        } catch (err) {
          logTelemetry("ERROR", `Failed to execute on-chain safety pause: ${err.message}`);
        }
      } else {
        logTelemetry("SIMULATION", `Simulated safety pause triggered for ${subId}. (No private key loaded)`);
      }
    } else {
      logTelemetry("SUCCESS", `Stream ${subId} passed compliance audit. Status: Compliant.`);
    }
  });

  // 2. Stream Paused Event
  registryContract.on("StreamPaused", (subId, reason) => {
    logTelemetry("EVENT", `Stream paused on-chain: ${subId}`, { reason });
  });

  // 3. Stream Resumed Event
  registryContract.on("StreamResumed", (subId) => {
    logTelemetry("EVENT", `Stream resumed on-chain: ${subId}`);
  });

  // 4. Stream Terminated Event
  registryContract.on("StreamTerminated", (subId) => {
    logTelemetry("EVENT", `Stream terminated on-chain: ${subId}`);
  });

  // 5. Funds Claimed Event
  registryContract.on("FundsWithdrawn", (subId, merchant, amount) => {
    logTelemetry("EVENT", `Funds claimed from stream: ${subId}`, {
      merchant,
      amount: amount.toString()
    });
  });

  // 6. Dispute Opened Event
  registryContract.on("DisputeOpened", (subId, subscriber) => {
    logTelemetry("EVENT", `Dispute opened on stream: ${subId} by subscriber ${subscriber}`);
  });

  // 7. Dispute Resolved Event
  registryContract.on("DisputeResolved", (subId, subscriberRefund, merchantShare) => {
    logTelemetry("EVENT", `Dispute resolved on stream: ${subId}`, {
      subscriberRefund: subscriberRefund.toString(),
      merchantShare: merchantShare.toString()
    });
  });
}

// Compliance check logic using OpenAI (with local fallback if key is not configured)
async function runPricingAudit(subId, merchant, tokenAddress, rate) {
  logTelemetry("INFO", `Auditing merchant pricing stream: ${subId} (Rate: ${rate}/sec)`);
  
  let riskScore = 15;
  let reason = "Rate falls within safe baseline parameters.";
  let anomalyClass = "NONE";

  // Auto-flag if rate is unusually high (e.g. rate >= 1000 tokens/sec)
  if (rate >= 1000) {
    riskScore = 85;
    reason = "Extremely high payment velocity detected. High drain risk identified.";
    anomalyClass = "VELOCITY_EXPLOIT";
  }

  if (openai) {
    try {
      logTelemetry("INFO", `Querying OpenAI GPT-4o for safety compliance check on stream: ${subId}...`);
      
      const prompt = `
You are an autonomous AI security auditor for QieFlow, a streaming payment protocol on the QIE Blockchain.
You must analyze the stream parameters and determine if the stream rate is safe/compliant or represents an anomaly/exploit.

Stream Details:
- Subscription ID: ${subId}
- Merchant Wallet: ${merchant}
- Token Address: ${tokenAddress}
- Streaming Rate: ${rate} units per second.

Decide if this streaming rate is compliant or represents a billing anomaly/exploit.
Return your response EXACTLY as a JSON object, with no markdown styling around it, in this format:
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
      logTelemetry("INFO", `OpenAI response: Compliant=${result.compliant}. Reason: ${result.reason}`);
      
      auditReports[subId] = {
        subId,
        riskScore: result.riskScore || (result.compliant ? 15 : 85),
        reason: result.reason,
        anomalyClass: result.anomalyClass || (result.compliant ? "NONE" : "VELOCITY_EXPLOIT"),
        timestamp: new Date().toISOString()
      };

      return result.compliant;
    } catch (error) {
      logTelemetry("ERROR", `OpenAI API call failed: ${error.message}. Falling back to default rule-based heuristic.`);
    }
  }

  // Populate cache with default metrics
  auditReports[subId] = {
    subId,
    riskScore,
    reason,
    anomalyClass,
    timestamp: new Date().toISOString()
  };

  return riskScore < 80;
}

// REST API Endpoints
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
    timestamp: new Date().toISOString()
  };
  res.json(report);
});

// AI Dispute Arbitration: analyzes evidence and signs resolution
app.post("/arbitrate-dispute", async (req, res) => {
  const { subId, evidence } = req.body;
  if (!subId) {
    return res.status(400).json({ error: "Missing subId" });
  }

  logTelemetry("ARBITRATION", `Arbitrating dispute for stream: ${subId}. Evidence: ${evidence || "None"}`);

  // Base split calculation
  let merchantShare = 0;
  let subscriberRefund = 1000; // Mock default refund amount (in smallest decimals)
  let decisionText = "Refund approved. AI Auditor determined merchant failed to meet uptime expectations.";

  if (evidence && evidence.toLowerCase().includes("delivered")) {
    merchantShare = 700;
    subscriberRefund = 300;
    decisionText = "Partial claim approved. Service partially delivered.";
  }

  // In production, we'd query contract for actual accrued claimables to perform precise arithmetic splits.
  // For the local/testnet hackathon E2E demo flow, we return a signed refund authorization based on UI parameters.
  if (req.body.merchantShare !== undefined && req.body.subscriberRefund !== undefined) {
    merchantShare = req.body.merchantShare;
    subscriberRefund = req.body.subscriberRefund;
    decisionText = `Arbitrated split: ${merchantShare} units to merchant, ${subscriberRefund} refunded to subscriber.`;
  }

  if (aiWallet && REGISTRY_ADDRESS) {
    try {
      // 1. Generate the message hash matching the registry smart contract
      const msgHash = ethers.solidityPackedKeccak256(
        ["bytes32", "uint256", "uint256", "address"],
        [subId, subscriberRefund, merchantShare, REGISTRY_ADDRESS]
      );
      
      // 2. Sign message hash with AI Wallet private key
      const signature = await aiWallet.signMessage(ethers.getBytes(msgHash));

      logTelemetry("SUCCESS", `Dispute arbitrated and signature generated. Signer: ${aiWallet.address}`, {
        subId,
        merchantShare,
        subscriberRefund
      });

      return res.json({
        success: true,
        merchantShare,
        subscriberRefund,
        decision: decisionText,
        signature
      });
    } catch (err) {
      logTelemetry("ERROR", `Failed to sign dispute arbitration: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  } else {
    logTelemetry("WARNING", "Private key or registry address missing. Returning simulated arbitration details.");
    return res.json({
      success: true,
      merchantShare,
      subscriberRefund,
      decision: `${decisionText} (Simulated resolution - AI Worker keys not loaded)`,
      signature: "0x1234567890"
    });
  }
});

// Configure contract addresses dynamically from the UI for demo ease
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

  if (auditorContract && aiWallet) {
    try {
      logTelemetry("ACTION", `Sending safety pause transaction for ${subId}...`);
      const tx = await auditorContract.triggerSafetyPause(subId, reason || "Manual AI Auditor override");
      await tx.wait();
      logTelemetry("SUCCESS", `Safety pause tx confirmed on-chain for ${subId}`);
      return res.json({ success: true, txHash: tx.hash });
    } catch (err) {
      logTelemetry("ERROR", `Failed to send safety pause tx: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  } else {
    logTelemetry("SIMULATION", `Simulated safety pause triggered for ${subId} (No private key loaded)`);
    return res.json({ success: true, simulated: true });
  }
});

// Start Express Server and Connect
app.listen(PORT, async () => {
  console.log(`AI Auditor API Server running on port ${PORT}`);
  await connectBlockchain();
});
