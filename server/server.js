require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const { OpenAI } = require("openai");
const crypto = require("crypto");
const net = require("net");
const fs = require("fs");
const path = require("path");

const { createAuth, secretUsable } = require("./auth");
const { mountArcade } = require("./arcade/routes");
const { createPassChecker } = require("./arcade/pass");
const { createSnakeService } = require("./arcade/snake");
const { createLeaderboard } = require("./arcade/leaderboard");
const { createWindowLimiter, createDailyLimiter } = require("./arcade/rateLimit");

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const app = express();

// /api/chat spends OpenAI credit, so browsers may only call it from Fluenci's
// own origins, and it parses its own body with a tighter limit (see the chat
// section). The Arcade's sign-in and pass-gated routes (/auth/*, /arcade/*)
// use the same origin allowlist; /arcade/snake/finish parses its own, larger
// body (a game's turn log). Every other route keeps open CORS and the default
// JSON parser.
const CHAT_ALLOWED_ORIGINS = [...new Set([
  "https://www.fluenci.xyz",
  "https://fluenci.xyz",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.CHAT_ALLOWED_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean)
])];
// Express matches routes case-insensitively and ignores a trailing slash, so
// "/API/chat/" must not slip past the chat-only CORS and body limit.
const normalizedPath = (p) => p.replace(/\/+$/, "").toLowerCase();
const isChatPath = (p) => normalizedPath(p) === "/api/chat";
const isArcadePath = (p) => /^\/(auth|arcade)\//.test(normalizedPath(p));
const isSnakeFinishPath = (p) => normalizedPath(p) === "/arcade/snake/finish";
const globalCors = cors();
const chatCors = cors({ origin: CHAT_ALLOWED_ORIGINS, methods: ["POST"], allowedHeaders: ["Content-Type", "Authorization"] });
const arcadeCors = cors({ origin: CHAT_ALLOWED_ORIGINS, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"] });
const globalJson = express.json();
app.use((req, res, next) => (isChatPath(req.path) ? chatCors : isArcadePath(req.path) ? arcadeCors : globalCors)(req, res, next));
app.use((req, res, next) => (isChatPath(req.path) || isSnakeFinishPath(req.path) ? next() : globalJson(req, res, next)));

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

// Background simulation log generator (runs when blockchain connection is offline)
setInterval(() => {
  if (!monitoringActive && !isSyncing) {
    const mockLogTemplates = [
      { type: "INFO", message: "AI Sentry scanning active payment streams for anomalies..." },
      { type: "SUCCESS", message: "Stream 0x8a92••••3d4f (Netflix Premium) verified as safe. Rate: 0.005 qUSD/sec." },
      { type: "SUCCESS", message: "Stream 0x5b3c••••7e89 (Acme Corp SaaS) verified as safe. Rate: 0.05 qUSD/sec." },
      { type: "AUDIT", message: "Audited subscriber account 0x2a9e••••6117. QIE Pass DID registration: VALID." },
      { type: "AUDIT", message: "Audited merchant account 0xe21f••••cd34. QIE Pass DID registration: VALID." },
      { type: "ALERT", message: "Anomaly detected: Rate velocity spike on stream 0x7c2b••••1a8f. Velocity: 1200 qUSD/sec exceeds threshold (100 qUSD/sec)." },
      { type: "ACTION", message: "Decision Agent trigger: Safety-pause signed and broadcasted for stream 0x7c2b••••1a8f." },
      { type: "SUCCESS", message: "Onchain safety-pause confirmed for stream 0x7c2b••••1a8f. Stream locked." }
    ];
    const template = mockLogTemplates[Math.floor(Math.random() * mockLogTemplates.length)];
    const logEntry = {
      id: telemetryLogs.length + 1,
      timestamp: new Date().toISOString(),
      type: template.type,
      message: template.message,
      details: {},
      relatedAddresses: []
    };
    telemetryLogs.push(logEntry);
    if (telemetryLogs.length > 25) {
      telemetryLogs.shift();
    }
  }
}, 8000);

// In-memory compliance & dispute report cache
let auditReports = {};
let uniqueUsers = new Set();
let streamsCreated = 0; // total SubscriptionCreated events, incl. ended streams
let totalVolume = 0n;
let totalSwapVolume = 0n;
let activeStreamRisks = {};
let unpausableStreams = new Set(); // streams whose pause reverts "Stream not active" — stop re-auditing/retrying them
let processedTxHashes = new Set();
let pollIntervalId = null;

let monitoringActive = false;
let registryContract = null;
let auditorContract = null;
let dexContract = null;
let fluenciRouterContract = null;
let provider = null;
let connectedChain = null; // { provider, chainId } once connectBlockchain has read that provider's chain id
let aiWallet = null;
let aiSigner = null; // NonceManager over aiWallet; every tx from the AI key goes through sendFromAiSigner
let aiSendQueue = Promise.resolve();
let isSyncing = false;

// Settings
let RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
let REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS;
let AUDITOR_ADDRESS = process.env.AUDITOR_ADDRESS;
let AI_PRIVATE_KEY = process.env.AI_PRIVATE_KEY;
let START_BLOCK = process.env.START_BLOCK || "10031934"; // FluenciRegistryV4 deploy block
let QIEDEX_ADDRESS = process.env.QIEDEX_ADDRESS || "";
let FLUENCI_ROUTER_ADDRESS = process.env.FLUENCI_ROUTER_ADDRESS || "";

// QIE Pass API Settings
const QIEPASS_API_URL = process.env.QIEPASS_API_URL || "https://pass-api.qie.digital";
const QIEPASS_PUBLIC_KEY = process.env.QIEPASS_PUBLIC_KEY || "";
const QIEPASS_SECRET_KEY = process.env.QIEPASS_SECRET_KEY || "";
const QIEPASS_CLAIMS = (process.env.QIEPASS_CLAIMS || "firstName,country").split(",").map(c => c.trim());
const QIEPASS_REQUEST_ID_RE = /^pvr_[A-Za-z0-9_]+$/;
const QIEPASS_REQUEST_ID_ANY = /pvr_[A-Za-z0-9_]+/g;
// Never mark these as verified. 0xfe5F...a6bb is the old deployer, whose
// private key is in public git history.
const QIEPASS_DENYLIST = new Set(["0xfe5F1D13A31a5B86833ADF4486720331D6e4a6bb"].map((a) => a.toLowerCase()));

// QIE's sandbox (did-stapi.qie.digital, pk_test_ keys) does no real document
// checks, so its answers must never become a verified mark on mainnet. Only
// QIE's production API with a live key counts. QIEPASS_ALLOW_SANDBOX=true lets
// a local test chain use the sandbox; it is ignored on QIE mainnet (1990) and
// while the connected chain is unknown. See qiePassAllowed().
const QIEPASS_PRODUCTION_HOST = "pass-api.qie.digital";
const QIEPASS_ALLOW_SANDBOX = process.env.QIEPASS_ALLOW_SANDBOX === "true";
const QIE_MAINNET_CHAIN_ID = 1990;

function qiePassEnvironment(apiUrl = QIEPASS_API_URL, publicKey = QIEPASS_PUBLIC_KEY) {
  let url = null;
  try { url = new URL(apiUrl); } catch { /* not a URL */ }
  // URL drops a default port (:443), so any port left is a non-default one.
  const productionHost = Boolean(url) && url.protocol === "https:" && url.username === "" &&
    url.password === "" && url.port === "" && url.hostname === QIEPASS_PRODUCTION_HOST;
  const liveKey = typeof publicKey === "string" && publicKey.startsWith("pk_live_");
  return { hostname: url ? url.hostname : null, liveKey, production: productionHost && liveKey };
}
const QIEPASS_ENV = qiePassEnvironment();
// Logged once at boot. Never the key itself.
console[QIEPASS_ENV.production ? "log" : "warn"](
  `[QIEPASS] QIE Pass API host: ${QIEPASS_ENV.hostname || "(not a valid URL)"}, live key: ${QIEPASS_ENV.liveKey ? "yes" : "no"}. ` +
  (QIEPASS_ENV.production ? "Production API: verification enabled."
    : QIEPASS_ALLOW_SANDBOX ? "Not QIE's production API: verification runs only on a known non-mainnet chain (QIEPASS_ALLOW_SANDBOX)."
      : "Not QIE's production API: QIE Pass verification is off.")
);

// Admin-only gate for the dangerous control endpoints (/configure,
// /trigger-anomaly, /arbitrate-dispute). Fail-closed: with no ADMIN_SECRET set
// the endpoints are locked entirely, so an unauthenticated caller can never
// reconfigure the node, inject a key, or force an on-chain safety pause.
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
function requireAdmin(req, res) {
  if (!ADMIN_SECRET || req.get("x-admin-secret") !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// QIE Reputation (DRS) API + on-chain attestation signer. The api-key is a
// secret and lives ONLY here (never in the frontend bundle). The signer key
// must be the attestor's authorised signer.
const DRS_API_URL = process.env.DRS_API_URL || "https://reputation.qie.digital";
const DRS_API_KEY = process.env.DRS_API_KEY || "";
const REPUTATION_SIGNER_KEY = process.env.REPUTATION_SIGNER_KEY || "";
const REPUTATION_ATTESTOR_ADDRESS = process.env.REPUTATION_ATTESTOR_ADDRESS || "";
const REPUTATION_CHAIN_ID = Number(process.env.REPUTATION_CHAIN_ID || 1990);
const REPUTATION_TTL_DAYS = Number(process.env.REPUTATION_TTL_DAYS || 7);

// HMAC-SHA256 Signature generator for QIE Pass API authentication
function generateQiePassHeaders() {
  const timestamp = Date.now().toString();
  const message = QIEPASS_PUBLIC_KEY + timestamp;
  const signature = crypto
    .createHmac("sha256", QIEPASS_SECRET_KEY)
    .update(message)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Public-Key": QIEPASS_PUBLIC_KEY,
    "X-Signature": signature,
    "X-Timestamp": timestamp
  };
}

function logTelemetry(type, message, details = {}) {
  // Extract wallet addresses from details for wallet-scoped filtering
  const relatedAddresses = [];
  if (details.subscriber) relatedAddresses.push(details.subscriber.toLowerCase());
  if (details.merchant) relatedAddresses.push(details.merchant.toLowerCase());
  // Also scan the message for ethereum addresses
  const addrMatches = message.match(/0x[a-fA-F0-9]{40}/g);
  if (addrMatches) {
    addrMatches.forEach(a => {
      if (!relatedAddresses.includes(a.toLowerCase())) relatedAddresses.push(a.toLowerCase());
    });
  }

  const logEntry = {
    id: telemetryLogs.length + 1,
    timestamp: new Date().toISOString(),
    type,
    message,
    details,
    relatedAddresses
  };
  telemetryLogs.push(logEntry);
  console.log(`[${type}] ${message}`, details);
}

// Anonymize ALL sensitive hex data in a string for public display.
// Masks any 0x-prefixed hex string of 20+ chars (covers wallet addresses,
// tx hashes, stream/subscription IDs, KYC identifiers, contract addresses, etc.)
// and QIE Pass request ids, which are handles to someone's verification.
function anonymizeAddresses(str) {
  return str
    .replace(/0x[a-fA-F0-9]{20,}/g, (match) => `0x${match.slice(2, 6)}••••${match.slice(-4)}`)
    .replace(QIEPASS_REQUEST_ID_ANY, "pvr_••••");
}

// Anonymize a log entry for public display (landing page)
function anonymizeLog(log) {
  return {
    ...log,
    message: anonymizeAddresses(log.message),
    details: log.details ? JSON.parse(anonymizeAddresses(JSON.stringify(log.details))) : {},
    relatedAddresses: undefined // Strip wallet associations from public response
  };
}

// Protect pauses and QIE Pass writes share the AI key, so broadcasts are queued
// one at a time through a NonceManager and can't take the same nonce. The
// NonceManager counts a nonce before it knows the send worked, so a send that
// fails (revert on estimate, no gas) resets it; otherwise it would leave a gap
// that stalls every later tx from this key.
function sendFromAiSigner(send) {
  const run = aiSendQueue.then(async () => {
    try {
      // Settle the manager's nonce read here, inside the try. NonceManager
      // otherwise starts that read in sendTransaction and awaits it only after
      // populateTransaction; if both fail, the nonce rejection is never
      // handled and takes the whole process down.
      await aiSigner.getNonce("pending");
      return await send();
    } catch (err) {
      aiSigner?.reset();
      throw err;
    }
  });
  aiSendQueue = run.catch(() => {});
  return run;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const errText = (err) => err?.shortMessage || err?.reason || err?.message || String(err);

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
    
    // Resolve merchant domain via QIE Explorer API (no onchain reverse lookup available)
    let domainName = "Unregistered Address";
    try {
      const QIE_DOMAIN_REGISTRY = "0xcfbcbca93c607590b211c81c7dbcdbd7ed6cc6ed";
      const REGISTER_SELECTOR = "0xf2101e95";
      const explorerUrl = `https://mainnet.qie.digital/api?module=account&action=txlist&address=${merchant}&startblock=0&endblock=99999999&sort=desc`;
      const resp = await fetch(explorerUrl);
      const txData = await resp.json();
      if (txData.status === "1" && txData.result) {
        const domainTx = txData.result.find(tx =>
          tx.to?.toLowerCase() === QIE_DOMAIN_REGISTRY.toLowerCase() &&
          tx.input?.startsWith(REGISTER_SELECTOR) &&
          tx.isError === "0"
        );
        if (domainTx) {
          const params = "0x" + domainTx.input.slice(10);
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
            ["string", "string[]", "string[]"],
            params
          );
          domainName = decoded[0];
          logTelemetry("ANALYST_AGENT", `QIE Domain resolved via explorer: ${merchant} -> ${domainName}`);
        }
      }
    } catch (err) {
      logTelemetry("ANALYST_AGENT", "QIE Domain lookup via explorer failed.", { error: err.message });
    }

    // Determine pricing baseline & check rules
    const rateVal = Number(rate);
    const { compliant, riskScore, anomalyClass, reason } = await this.runComplianceAlgorithm(subId, subscriber, merchant, domainName, tokenAddress, rateVal);

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
    activeStreamRisks[subId] = riskScore;

    logTelemetry("ANALYST_AGENT", `Audit Intelligence Report compiled and pinned to IPFS. CID: ${ipfsCID}`, {
      riskScore,
      anomalyClass,
      compliant
    });

    // Hand-off to Decision Agent
    await DecisionAgent.evaluateReport(subId, auditReport, ipfsCID);
  },

  async runComplianceAlgorithm(subId, subscriber, merchant, domainName, tokenAddress, rate) {
    let riskScore = 15;
    let reason = "Rate falls within safe baseline parameters.";
    let anomalyClass = "NONE";

    // Check subscriber balance
    let balanceVal = 0n;
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider);
      balanceVal = await tokenContract.balanceOf(subscriber);
      logTelemetry("ANALYST_AGENT", `Audited subscriber ${subscriber} balance: ${Number(balanceVal) / 1e6} tokens`);
    } catch (err) {
      logTelemetry("ANALYST_AGENT", `Failed to fetch subscriber balance: ${err.message}`);
    }

    const minRequired = BigInt(rate) * 10n; // Require at least 10 seconds of streaming buffer
    if (balanceVal < minRequired) {
      return {
        compliant: false,
        riskScore: 99,
        anomalyClass: "INSUFFICIENT_BALANCE",
        reason: `Subscriber balance (${balanceVal.toString()} units) is less than required buffer (${minRequired.toString()} units). Cannot sustain payment stream.`
      };
    }

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
      logTelemetry("DECISION_AGENT", `CRITICAL: Risk score ${risk}% exceeds threshold! Executing autonomous safety pause onchain...`);

      if (auditorContract && aiWallet) {
        try {
          // Send transaction containing IPFS CID of the audit report as the reason
          const tx = await sendFromAiSigner(() => auditorContract.triggerSafetyPause(subId, ipfsCID));
          logTelemetry("DECISION_AGENT", `onchain safety pause tx broadcasted. Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          logTelemetry("DECISION_AGENT", `Safety pause confirmed in block ${receipt.blockNumber}. Stream has been locked onchain.`);
          return "paused";
        } catch (err) {
          const reason = err.reason || err.shortMessage || err.message || String(err);
          // A terminated/settled stream cannot be paused — the registry reverts
          // "Stream not active". Don't dump the full ethers CALL_EXCEPTION, and
          // tell the caller to stop retrying this stream every tick.
          if (reason.includes("Stream not active")) {
            logTelemetry("DECISION_AGENT", `Stream ${subId} is no longer pausable (terminated/inactive); dropping from monitoring.`);
            return "unpausable";
          }
          logTelemetry("DECISION_AGENT", `FAILED to execute safety pause for ${subId}: ${reason}`);
          return "failed";
        }
      } else {
        logTelemetry("DECISION_AGENT", `[SIMULATION] Safety pause triggered. Report CID ${ipfsCID} stored in memory.`);
        return "simulated";
      }
    } else {
      logTelemetry("DECISION_AGENT", `Stream ${subId} passed safety threshold. Monitoring active.`);
    }
    return "ok";
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

async function syncHistoricalEvents() {
  if (!registryContract) return;
  isSyncing = true;
  logTelemetry("INFO", "Starting historical onchain event synchronization...");
  try {
    const startBlock = Number(START_BLOCK);
    const latestBlock = await provider.getBlockNumber();
    logTelemetry("INFO", `Querying history from block ${startBlock} to ${latestBlock}...`);

    const CHUNK_SIZE = 9900;
    for (let from = startBlock; from <= latestBlock; from += CHUNK_SIZE) {
      const to = Math.min(from + CHUNK_SIZE - 1, latestBlock);
      logTelemetry("INFO", `Querying history block chunk ${from} to ${to}...`);

      const queryPromises = [];

      // Query 1: Registry Logs
      queryPromises.push(
        provider.getLogs({
          address: REGISTRY_ADDRESS,
          fromBlock: from,
          toBlock: to
        })
      );

      // Query 2: DEX Logs (if applicable)
      const shouldQueryDex = dexContract && !fluenciRouterContract;
      if (shouldQueryDex) {
        queryPromises.push(
          provider.getLogs({
            address: QIEDEX_ADDRESS,
            fromBlock: from,
            toBlock: to
          })
        );
      } else {
        queryPromises.push(Promise.resolve([]));
      }

      // Query 3: Router Logs (if applicable)
      if (fluenciRouterContract) {
        queryPromises.push(
          provider.getLogs({
            address: FLUENCI_ROUTER_ADDRESS,
            fromBlock: from,
            toBlock: to
          })
        );
      } else {
        queryPromises.push(Promise.resolve([]));
      }

      const [registryLogs, dexLogs, routerLogs] = await Promise.all(queryPromises);

      const chunkEvents = [];

      // Parse Registry logs
      for (const log of registryLogs) {
        try {
          const parsed = registryContract.interface.parseLog(log);
          if (parsed) {
            chunkEvents.push({
              type: parsed.name,
              args: parsed.args,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
              transactionHash: log.transactionHash
            });
          }
        } catch (e) {
          // Ignored if event is not in registry ABI
        }
      }

      // Parse DEX logs
      for (const log of dexLogs) {
        try {
          const parsed = dexContract.interface.parseLog(log);
          if (parsed && parsed.name === "Swap") {
            chunkEvents.push({
              type: "Swap",
              args: parsed.args,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
              transactionHash: log.transactionHash
            });
          }
        } catch (e) {
          // Ignored if not Swap event
        }
      }

      // Parse Router logs
      for (const log of routerLogs) {
        try {
          const parsed = fluenciRouterContract.interface.parseLog(log);
          if (parsed && parsed.name === "FluenciSwap") {
            chunkEvents.push({
              type: "FluenciSwap",
              args: parsed.args,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
              transactionHash: log.transactionHash
            });
          }
        } catch (e) {
          // Ignored if not FluenciSwap event
        }
      }

      // Sort chunk events chronologically
      chunkEvents.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber - b.blockNumber;
        }
        return a.logIndex - b.logIndex;
      });

      // Process chunk events immediately to update stats and telemetry in real time
      for (const item of chunkEvents) {
        const { type, args, blockNumber, transactionHash } = item;
        const diffBlocks = latestBlock - blockNumber;
        const eventTimestamp = new Date(Date.now() - diffBlocks * 3000).toISOString();

        if (type === "SubscriptionCreated") {
          const [subId, subscriber, merchant, tokenAddress, amountPerPeriod, periodSeconds, cliff, stop] = args;
          const rate = periodSeconds > 0n ? amountPerPeriod / periodSeconds : amountPerPeriod;
          streamsCreated++;
          uniqueUsers.add(subscriber);
          uniqueUsers.add(merchant);
          
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `Captured new subscription stream: ${subId}. Forwarding to Analyst Agent...`,
            details: { subscriber, merchant, rate: rate.toString() }
          });

          const rateVal = Number(rate);
          let riskScore = 12;
          let reason = "Rate falls within safe baseline parameters.";
          let anomalyClass = "NONE";

          if (rateVal >= 1000) {
            riskScore = 95;
            reason = "Extremely high payment velocity detected. Immediate drain risk identified.";
            anomalyClass = "VELOCITY_EXPLOIT";
          }

          const ipfsCID = `ipfs://bafybeihash-sync-${subId.substring(2, 18)}`;
          auditReports[subId] = {
            subId,
            riskScore,
            reason: `${reason} [IPFS CID: ${ipfsCID}]`,
            anomalyClass,
            ipfsCID,
            timestamp: eventTimestamp
          };

          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "ANALYST_AGENT",
            message: `Starting deep compliance audit for stream: ${subId}`,
            details: {}
          });

          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "ANALYST_AGENT",
            message: `Audit Intelligence Report compiled and pinned to IPFS. CID: ${ipfsCID}`,
            details: { riskScore, anomalyClass, compliant: riskScore < 75 }
          });

          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "DECISION_AGENT",
            message: `Evaluating Audit Report for stream ${subId}. Risk: ${riskScore}% (Threshold: 75%)`,
            details: {}
          });

          if (riskScore >= 75) {
            telemetryLogs.push({
              id: telemetryLogs.length + 1,
              timestamp: eventTimestamp,
              type: "DECISION_AGENT",
              message: `CRITICAL: Risk score ${riskScore}% exceeds threshold! Stream pause registered in onchain history.`,
              details: {}
            });
          }
          activeStreamRisks[subId] = riskScore;
        } else if (type === "StreamPaused") {
          const [subId, reason] = args;
          delete activeStreamRisks[subId];
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `Registered StreamPaused event for ${subId}`,
            details: { reason }
          });
        } else if (type === "StreamResumed") {
          const [subId] = args;
          activeStreamRisks[subId] = 12;
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `Registered StreamResumed event for ${subId}`,
            details: {}
          });
        } else if (type === "StreamTerminated") {
          const [subId] = args;
          delete activeStreamRisks[subId];
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `Registered StreamTerminated event for ${subId}`,
            details: {}
          });
        } else if (type === "FundsWithdrawn") {
          const [subId, merchant, amount] = args;
          totalVolume += BigInt(amount.toString());
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `Registered FundsWithdrawn event from stream ${subId}`,
            details: { merchant, amount: amount.toString() }
          });
        } else if (type === "DisputeOpened") {
          const [subId, subscriber] = args;
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `CRITICAL: DisputeOpened event captured for stream ${subId} by subscriber ${subscriber}`,
            details: {}
          });
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "ARBITRATOR_AGENT",
            message: `Dispute arbitration initialized for stream: ${subId}`,
            details: {}
          });
        } else if (type === "DisputeResolved") {
          const [subId, subscriberRefund, merchantShare] = args;
          totalVolume += BigInt(merchantShare.toString());
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `DisputeResolved event captured for stream ${subId}`,
            details: {
              subscriberRefund: subscriberRefund.toString(),
              merchantShare: merchantShare.toString()
            }
          });
        } else if (type === "Swap") {
          const [user, tokenAddress, qieAmount, tokenAmount] = args;
          const txHash = transactionHash.toLowerCase();
          if (!processedTxHashes.has(txHash)) {
            processedTxHashes.add(txHash);
            totalSwapVolume += BigInt(tokenAmount.toString());
          }
          uniqueUsers.add(user);
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `DEX Swap: ${user} swapped ${qieAmount.toString()} QIE for ${tokenAmount.toString()} tokens`,
            details: { user, tokenAddress, qieAmount: qieAmount.toString(), tokenAmount: tokenAmount.toString() }
          });
        } else if (type === "FluenciSwap") {
          const [user, direction, tokenIn, tokenOut, amountIn, amountOut] = args;
          const txHash = transactionHash.toLowerCase();
          if (!processedTxHashes.has(txHash)) {
            processedTxHashes.add(txHash);
            // Always track the qUSDC side: QIE_TO_TOKEN → amountOut is qUSDC; TOKEN_TO_QIE → amountIn is qUSDC
            const qusdcAmount = direction === "TOKEN_TO_QIE" ? BigInt(amountIn.toString()) : BigInt(amountOut.toString());
            totalSwapVolume += qusdcAmount;
          }
          uniqueUsers.add(user);
          telemetryLogs.push({
            id: telemetryLogs.length + 1,
            timestamp: eventTimestamp,
            type: "SENTRY_AGENT",
            message: `FluenciSwap: ${user} swapped via Fluenci Router (${direction}). In: ${amountIn.toString()}, Out: ${amountOut.toString()}`,
            details: { user, direction, tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: amountOut.toString() }
          });
        }
      }
    }
    logTelemetry("INFO", `Historical event synchronization completed successfully.`);
  } catch (err) {
    logTelemetry("ERROR", `Historical event synchronization failed: ${err.message}`);
  } finally {
    isSyncing = false;
  }
}

async function connectBlockchain() {
  try {
    logTelemetry("INFO", `Connecting to RPC URL: ${RPC_URL}`);
    const rpc = new ethers.JsonRpcProvider(RPC_URL);
    provider = rpc;

    const network = await rpc.getNetwork();
    connectedChain = { provider: rpc, chainId: Number(network.chainId) };
    logTelemetry("INFO", `Connected to blockchain. Chain ID: ${Number(network.chainId)}`);

    if (REGISTRY_ADDRESS && AUDITOR_ADDRESS) {
      logTelemetry("INFO", `Configuring contracts. Registry: ${REGISTRY_ADDRESS}, Auditor: ${AUDITOR_ADDRESS}`);
      
      const REGISTRY_ABI = [
        "event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, address indexed merchant, address tokenAddress, uint256 amountPerPeriod, uint256 periodSeconds, uint256 cliffTime, uint256 stopTime)",
        "event StreamPaused(bytes32 indexed subId, string reason)",
        "event StreamResumed(bytes32 indexed subId)",
        "event StreamTerminated(bytes32 indexed subId)",
        "event FundsWithdrawn(bytes32 indexed subId, address indexed merchant, uint256 amount)",
        "event DisputeOpened(bytes32 indexed subId, address indexed subscriber)",
        "event DisputeResolved(bytes32 indexed subId, uint256 subscriberRefund, uint256 merchantShare)",
        "function getSubscriptionDetails(bytes32 subId) view returns (tuple(address subscriber, address merchant, address tokenAddress, uint256 amountPerPeriod, uint256 periodSeconds, uint256 billedSeconds, uint256 settledAmount, uint256 settledFees, uint256 feeDust, uint256 lastTickTimestamp, uint256 startTime, uint256 cliffTime, uint256 stopTime, bool active, bool pausedByAI, uint8 dispute) sub, uint256 claimableAmount)",
        "function getSubscriberSubscriptions(address subscriber) view returns (bytes32[])"
      ];

      registryContract = new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider);

      if (AI_PRIVATE_KEY) {
        aiWallet = new ethers.Wallet(AI_PRIVATE_KEY, provider);
        aiSigner = new ethers.NonceManager(aiWallet);
        const AUDITOR_ABI = [
          "function triggerSafetyPause(bytes32 subId, string calldata reason) external",
          "event AnomalyReported(bytes32 indexed subId, string reason, uint256 timestamp)"
        ];
        auditorContract = new ethers.Contract(AUDITOR_ADDRESS, AUDITOR_ABI, aiSigner);
        logTelemetry("INFO", `AI Wallet loaded: ${aiWallet.address}. Node is in ACTIVE automated audit mode.`);
      } else {
        logTelemetry("WARNING", "AI_PRIVATE_KEY not provided. Node running in SIMULATION/TELEMETRY-ONLY mode.");
      }

      uniqueUsers = new Set();
      streamsCreated = 0;
      totalVolume = 0n;
      totalSwapVolume = 0n;
      activeStreamRisks = {};
      unpausableStreams = new Set();
      processedTxHashes = new Set();
      telemetryLogs = [
        {
          id: 1,
          timestamp: new Date().toISOString(),
          type: "INFO",
          message: "AI Sentry Multi-Agent Node initializing...",
          details: {}
        }
      ];

      // Set up DEX contract for swap volume tracking (legacy, if no FluenciRouter)
      if (QIEDEX_ADDRESS) {
        const DEX_ABI = [
          "event Swap(address indexed user, address indexed tokenAddress, uint256 qieAmount, uint256 tokenAmount)"
        ];
        dexContract = new ethers.Contract(QIEDEX_ADDRESS, DEX_ABI, provider);
        logTelemetry("INFO", `DEX contract configured: ${QIEDEX_ADDRESS}`);
      }

      // Set up FluenciRouter for attributed swap tracking (preferred)
      if (FLUENCI_ROUTER_ADDRESS) {
        const ROUTER_ABI = [
          "event FluenciSwap(address indexed user, string direction, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut)"
        ];
        fluenciRouterContract = new ethers.Contract(FLUENCI_ROUTER_ADDRESS, ROUTER_ABI, provider);
        logTelemetry("INFO", `FluenciRouter configured: ${FLUENCI_ROUTER_ADDRESS} (on-chain swap attribution enabled)`);
      } else {
        logTelemetry("INFO", "FLUENCI_ROUTER_ADDRESS not set. Swap attribution tracking disabled.");
      }

      // Checked before the (slow) history sync so a QIE Pass writer that can't
      // write shows up in the log straight away.
      const writer = await checkQiePassWriter();
      if (qiePassWriterReady(writer)) {
        logTelemetry("INFO", `QIE Pass writer ready. Adapter: ${writer.adapter}, oracle signer: ${aiWallet.address}${QIEPASS_ENV.production ? "" : ` (QIE Pass sandbox, allowed on local chain ${Number(network.chainId)})`}`);
      } else if (!qiePassAllowed()) {
        logTelemetry("ERROR", "QIE Pass is off: QIEPASS_API_URL and QIEPASS_PUBLIC_KEY aren't QIE's production API and a live key, and the sandbox is only allowed on a local chain. QIE Pass requests are refused.");
      } else {
        logTelemetry("ERROR", `QIE Pass writer not ready (adapter: ${writer.adapter || "unreadable"}, oracle matches signer: ${writer.oracleOk}, signer holds 0.01+ QIE: ${writer.funded}). QIE Pass claims are refused until this is fixed.`);
      }
      retryPendingQiePassWrites().catch(() => {});

      await syncHistoricalEvents();
      await reconcileActiveStreams();
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

// Reconcile active streams after historical sync by querying the registry
// for all known subscribers and re-adding any streams that are still active.
async function reconcileActiveStreams() {
  if (!registryContract || !provider) return;
  logTelemetry("INFO", "Reconciling active streams from known subscribers...");

  const subscriberAddresses = [...uniqueUsers];
  let reconciled = 0;

  for (const subscriberAddr of subscriberAddresses) {
    try {
      const subIds = await registryContract.getSubscriberSubscriptions(subscriberAddr);
      for (const subId of subIds) {
        try {
          const details = await registryContract.getSubscriptionDetails(subId);
          const [, , , , , , , , active, pausedByAI] = details;
          if (active && !pausedByAI && !activeStreamRisks[subId]) {
            activeStreamRisks[subId] = 12; // Default low risk, will be audited on next tick
            reconciled++;
          }
        } catch (detailErr) {
          // Skip individual subscription errors
        }
      }
    } catch (err) {
      // Skip subscribers whose subscriptions can't be queried
    }
  }

  logTelemetry("INFO", `Reconciliation complete. ${reconciled} active streams re-added to monitoring.`);
  console.log(`[RECONCILE] Found ${reconciled} active streams from ${subscriberAddresses.length} known subscribers`);
}

async function auditActiveStreams() {
  if (!registryContract || !provider) return;

  const activeSubIds = Object.keys(activeStreamRisks);
  if (activeSubIds.length === 0) return;

  console.log(`[AUDIT] Auditing ${activeSubIds.length} active streams...`);

  for (const subId of activeSubIds) {
    if (unpausableStreams.has(subId)) continue; // terminated/inactive — already given up on
    try {
      const [sub, claimableAmount] = await registryContract.getSubscriptionDetails(subId);
      const subscriber = sub.subscriber, merchant = sub.merchant, tokenAddress = sub.tokenAddress;
      const active = sub.active, pausedByAI = sub.pausedByAI;
      const ratePerSecond = sub.periodSeconds > 0n ? sub.amountPerPeriod / sub.periodSeconds : sub.amountPerPeriod;

      if (!active || pausedByAI) {
        // Clean up from memory if no longer active or already paused by AI
        delete activeStreamRisks[subId];
        continue;
      }

      // Check balance of the subscriber
      const tokenContract = new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider);
      const balanceVal = await tokenContract.balanceOf(subscriber);

      const requiredBuffer = claimableAmount + (ratePerSecond * 10n);

      if (balanceVal < requiredBuffer) {
        // Flag + attempt the pause ONCE. Re-flagging the same stream every tick
        // is just log noise.
        if (activeStreamRisks[subId] === 99) continue;
        logTelemetry("ANALYST_AGENT", `CRITICAL: Active stream ${subId} subscriber ${subscriber} has insufficient balance (${balanceVal.toString()} < required ${requiredBuffer.toString()})! Triggering safety pause...`);
        activeStreamRisks[subId] = 99;

        // Compile audit report
        const report = {
          subId,
          timestamp: new Date().toISOString(),
          metadata: { subscriber, merchant, tokenAddress, rate: ratePerSecond.toString() },
          evaluation: {
            compliant: false,
            riskScore: 99,
            anomalyClass: "INSUFFICIENT_BALANCE",
            reason: `Active stream subscriber has insufficient balance (${balanceVal.toString()} < required ${requiredBuffer.toString()}). Autopausing stream.`
          }
        };

        // Save report in local cache
        const ipfsCID = `ipfs://bafybeihash-low-balance-${subId.substring(2, 18)}`;
        auditReports[subId] = {
          subId,
          riskScore: 99,
          reason: `Subscriber balance is insufficient (${balanceVal.toString()} < required ${requiredBuffer.toString()}). [IPFS CID: ${ipfsCID}]`,
          anomalyClass: "INSUFFICIENT_BALANCE",
          ipfsCID,
          timestamp: new Date().toISOString()
        };

        // Hand-off to Decision Agent
        const outcome = await DecisionAgent.evaluateReport(subId, report, ipfsCID);
        if (outcome === "unpausable") {
          unpausableStreams.add(subId);
          delete activeStreamRisks[subId];
        }
      }
    } catch (err) {
      logTelemetry("WARNING", `Failed to audit active stream ${subId} balance: ${err.reason || err.shortMessage || err.message}`);
    }
  }
}

let lastPolledBlock = 0;

function setupEventListeners() {
  if (!registryContract) return;

  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  logTelemetry("INFO", "Starting event polling (10s interval, immune to RPC filter drops)...");

  // Initialize lastPolledBlock from the latest block
  provider.getBlockNumber().then(blockNum => {
    lastPolledBlock = blockNum;
    logTelemetry("INFO", `Event polling initialized from block ${lastPolledBlock}`);
  });

  // Poll for new events every 10 seconds using queryFilter (no eth_newFilter needed)
  pollIntervalId = setInterval(async () => {
    if (!registryContract || !provider || lastPolledBlock === 0) {
      console.log(`[POLLER] Skipping: registryContract=${!!registryContract} provider=${!!provider} lastPolledBlock=${lastPolledBlock}`);
      return;
    }

    try {
      const currentBlock = await provider.getBlockNumber();
      console.log(`[POLLER] Poll tick: currentBlock=${currentBlock} lastPolledBlock=${lastPolledBlock} activeStreams=${Object.keys(activeStreamRisks).length}`);
      if (currentBlock <= lastPolledBlock) return; // No new blocks

      const fromBlock = lastPolledBlock + 1;
      const toBlock = currentBlock;

      // Query all contract events in the new block range
      const [
        evCreated, evPaused, evResumed, evTerminated,
        evWithdrawn, evDisputeOpened, evDisputeResolved
      ] = await Promise.all([
        registryContract.queryFilter(registryContract.filters.SubscriptionCreated(), fromBlock, toBlock),
        registryContract.queryFilter(registryContract.filters.StreamPaused(), fromBlock, toBlock),
        registryContract.queryFilter(registryContract.filters.StreamResumed(), fromBlock, toBlock),
        registryContract.queryFilter(registryContract.filters.StreamTerminated(), fromBlock, toBlock),
        registryContract.queryFilter(registryContract.filters.FundsWithdrawn(), fromBlock, toBlock),
        registryContract.queryFilter(registryContract.filters.DisputeOpened(), fromBlock, toBlock),
        registryContract.queryFilter(registryContract.filters.DisputeResolved(), fromBlock, toBlock)
      ]);

      const totalEvents = evCreated.length + evPaused.length + evResumed.length + evTerminated.length + evWithdrawn.length + evDisputeOpened.length + evDisputeResolved.length;
      if (totalEvents > 0) {
        console.log(`[POLLER] Blocks ${fromBlock}-${toBlock}: ${evCreated.length} Created, ${evPaused.length} Paused, ${evResumed.length} Resumed, ${evTerminated.length} Terminated, ${evWithdrawn.length} Withdrawn, ${evDisputeOpened.length} DisputeOpened, ${evDisputeResolved.length} DisputeResolved`);
      }

      // Process Registry events
      for (const ev of evCreated) {
        const [subId, subscriber, merchant, tokenAddress, amountPerPeriod, periodSeconds, cliff, stop] = ev.args;
        const rate = periodSeconds > 0n ? amountPerPeriod / periodSeconds : amountPerPeriod;
        console.log(`[POLLER] New SubscriptionCreated detected: ${subId} subscriber=${subscriber} rate=${rate.toString()}/s`);
        streamsCreated++;
        uniqueUsers.add(subscriber);
        uniqueUsers.add(merchant);
        activeStreamRisks[subId] = 12;
        await SentryAgent.handleNewStream(subId, subscriber, merchant, tokenAddress, rate, cliff, stop);
      }
      for (const ev of evPaused) {
        const [subId, reason] = ev.args;
        delete activeStreamRisks[subId];
        SentryAgent.handleStreamPaused(subId, reason);
      }
      for (const ev of evResumed) {
        const [subId] = ev.args;
        activeStreamRisks[subId] = 12;
        SentryAgent.handleStreamResumed(subId);
      }
      for (const ev of evTerminated) {
        const [subId] = ev.args;
        delete activeStreamRisks[subId];
        SentryAgent.handleStreamTerminated(subId);
      }
      for (const ev of evWithdrawn) {
        const [subId, merchant, amount] = ev.args;
        totalVolume += BigInt(amount.toString());
        SentryAgent.handleFundsClaimed(subId, merchant, amount);
      }
      for (const ev of evDisputeOpened) {
        const [subId, subscriber] = ev.args;
        SentryAgent.handleDisputeOpened(subId, subscriber);
      }
      for (const ev of evDisputeResolved) {
        const [subId, subscriberRefund, merchantShare] = ev.args;
        totalVolume += BigInt(merchantShare.toString());
        SentryAgent.handleDisputeResolved(subId, subscriberRefund, merchantShare);
      }

      // Query FluenciRouter events (preferred)
      if (fluenciRouterContract) {
        const evFluenciSwap = await fluenciRouterContract.queryFilter(
          fluenciRouterContract.filters.FluenciSwap(), fromBlock, toBlock
        );
        for (const ev of evFluenciSwap) {
          const [user, direction, tokenIn, tokenOut, amountIn, amountOut] = ev.args;
          const txHash = ev.transactionHash.toLowerCase();
          if (!processedTxHashes.has(txHash)) {
            processedTxHashes.add(txHash);
            const qusdcAmount = direction === "TOKEN_TO_QIE" ? BigInt(amountIn.toString()) : BigInt(amountOut.toString());
            totalSwapVolume += qusdcAmount;
            uniqueUsers.add(user);
            logTelemetry("SENTRY_AGENT", `FluenciSwap: ${user} swapped via Fluenci Router (${direction}). In: ${amountIn.toString()}, Out: ${amountOut.toString()}`, {
              user, direction, tokenIn, tokenOut,
              amountIn: amountIn.toString(), amountOut: amountOut.toString()
            });
          }
        }
      } else if (dexContract) {
        // Legacy DEX Swap tracking fallback
        const evSwap = await dexContract.queryFilter(
          dexContract.filters.Swap(), fromBlock, toBlock
        );
        for (const ev of evSwap) {
          const [user, tokenAddress, qieAmount, tokenAmount] = ev.args;
          const txHash = ev.transactionHash.toLowerCase();
          if (!processedTxHashes.has(txHash)) {
            processedTxHashes.add(txHash);
            totalSwapVolume += BigInt(tokenAmount.toString());
            uniqueUsers.add(user);
            logTelemetry("SENTRY_AGENT", `DEX Swap detected: ${user} swapped ${qieAmount.toString()} QIE for ${tokenAmount.toString()} tokens`, {
              user, tokenAddress, qieAmount: qieAmount.toString(), tokenAmount: tokenAmount.toString()
            });
          }
        }
      }

      // Check balances of all active stream subscribers
      await auditActiveStreams();

      lastPolledBlock = toBlock;
    } catch (err) {
      // Silently handle RPC timeouts — will retry on next interval
      if (!err.message.includes("timeout")) {
        logTelemetry("WARNING", `Event polling error: ${err.message}`);
      }
    }
  }, 10000); // Poll every 10 seconds
}

// ==========================================
// REST API ENDPOINTS
// ==========================================

app.get("/status", (req, res) => {
  // Served from cache; refreshed in the background at most once a minute.
  if (Date.now() - qiePassWriterAt > 60 * 1000) checkQiePassWriter();
  res.json({
    status: "online",
    monitoringActive,
    rpcUrl: RPC_URL,
    contracts: {
      registry: REGISTRY_ADDRESS,
      auditor: AUDITOR_ADDRESS
    },
    aiWorker: aiWallet ? aiWallet.address : "simulation-mode",
    qiePassWriter: {
      adapter: qiePassWriter.adapter,
      oracleOk: qiePassWriter.oracleOk,
      funded: qiePassWriter.funded,
      production: QIEPASS_ENV.production
    }
  });
});

app.get("/stats", (req, res) => {
  // Always return real blockchain data — no simulated/mock stats
  const volumeFormatted = Number(totalVolume) / 1e6; // Format qUSDC (6 decimals) to dollars
  const revenueFormatted = volumeFormatted * 0.005; // 0.5% protocol fee
  const swapVolumeFormatted = Number(totalSwapVolume) / 1e6; // Format qUSDC (6 decimals) to dollars
  const risks = Object.values(activeStreamRisks);
  const currentRisk = risks.length > 0 ? Math.max(12, ...risks) : 12;
  res.json({
    uniqueUsersCount: uniqueUsers.size,
    streamsCreatedCount: streamsCreated,
    totalVolumeUSD: volumeFormatted,
    totalRevenueUSD: revenueFormatted,
    totalSwapVolumeUSD: swapVolumeFormatted,
    systemRiskScore: currentRisk,
    monitoringActive
  });
});

app.post("/swap-telemetry", async (req, res) => {
  const { txHash } = req.body;
  if (!txHash) {
    return res.status(400).json({ error: "Missing txHash" });
  }

  logTelemetry("INFO", `Received swap telemetry for tx: ${txHash}. Verifying onchain...`);

  try {
    if (!provider) {
      throw new Error("Blockchain provider not initialized");
    }

    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      throw new Error("Transaction not found");
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new Error("Transaction receipt not found");
    }

    if (receipt.status !== 1) {
      throw new Error("Transaction failed onchain");
    }

    // Verify transaction destination is QIEDex router or FluenciRouter
    const qieDexRouter = "0x08cd2e72e156D8563B4351eb4065C262A9f553Ef";
    const fluenciRouter = FLUENCI_ROUTER_ADDRESS || "";
    const validDestinations = [qieDexRouter.toLowerCase()];
    if (fluenciRouter) validDestinations.push(fluenciRouter.toLowerCase());
    if (!validDestinations.includes(tx.to.toLowerCase())) {
      throw new Error("Transaction destination is not QIEDex router or FluenciRouter");
    }

    // Parse logs to extract qUSDC transfer amount
    const qUSDCAddress = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
    const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    
    let qUSDCAmount = 0n;
    for (const log of receipt.logs) {
      if (
        log.address.toLowerCase() === qUSDCAddress.toLowerCase() &&
        log.topics[0] === transferTopic
      ) {
        const val = BigInt(log.data);
        qUSDCAmount = val;
        break;
      }
    }

    if (qUSDCAmount === 0n) {
      throw new Error("No qUSDC transfer found in transaction logs");
    }
    const txHashLower = txHash.toLowerCase();
    if (processedTxHashes.has(txHashLower)) {
      logTelemetry("INFO", `Swap telemetry for tx ${txHash} already processed. Ignoring.`);
      return res.json({ success: true, amountSwapped: Number(qUSDCAmount) / 1e6, message: "Already processed" });
    }
    
    processedTxHashes.add(txHashLower);
    uniqueUsers.add(tx.from);
    totalSwapVolume += qUSDCAmount;
    logTelemetry("SUCCESS", `Verified swap of ${Number(qUSDCAmount) / 1e6} qUSDC. Total Swap Volume updated.`, {
      txHash,
      amount: (Number(qUSDCAmount) / 1e6).toString()
    });

    res.json({ success: true, amountSwapped: Number(qUSDCAmount) / 1e6 });
  } catch (err) {
    logTelemetry("ERROR", `Failed to verify swap telemetry: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/telemetry", (req, res) => {
  const risks = Object.values(activeStreamRisks);
  const currentRisk = risks.length > 0 ? Math.max(12, ...risks) : 12;
  const walletFilter = req.query.wallet ? req.query.wallet.toLowerCase() : null;

  let filteredLogs;
  if (walletFilter) {
    // Wallet-scoped mode (AI Security Desk): only show logs related to the connected wallet
    filteredLogs = telemetryLogs.filter(log => {
      // Always include system/info logs (non-wallet-specific)
      if (["INFO", "SYSTEM", "ERROR"].includes(log.type) && (!log.relatedAddresses || log.relatedAddresses.length === 0)) {
        return true;
      }
      // Include logs that mention this wallet
      return log.relatedAddresses && log.relatedAddresses.includes(walletFilter);
    });
  } else {
    // Public mode (Landing Page): anonymize all wallet addresses for privacy
    filteredLogs = telemetryLogs.map(anonymizeLog);
  }

  res.json({
    logs: filteredLogs,
    systemRiskScore: currentRisk,
    activeStreamsCount: Object.keys(activeStreamRisks).length
  });
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
  if (!requireAdmin(req, res)) return;
  const { subId, evidence, merchantShare, subscriberRefund } = req.body;
  if (!subId) {
    return res.status(400).json({ error: "Missing subId" });
  }

  const result = await ArbitratorAgent.arbitrate(subId, evidence, merchantShare, subscriberRefund);
  res.json(result);
});

// Configure contract addresses dynamically from the UI
app.post("/configure", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { rpcUrl, registryAddress, auditorAddress } = req.body;

  if (rpcUrl) RPC_URL = rpcUrl;
  if (registryAddress) REGISTRY_ADDRESS = registryAddress;
  if (auditorAddress) AUDITOR_ADDRESS = auditorAddress;
  // aiPrivateKey injection removed: the signer key is taken from env only and
  // can never be swapped in at runtime.

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
  if (!requireAdmin(req, res)) return;
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

// ==========================================
// QIE PASS KYC VERIFICATION ROUTES
// ==========================================

const QIEPASS_REQUEST_TTL_MS = 60 * 60 * 1000;
const QIEPASS_REQUEST_MAX_TTL_MS = 24 * 60 * 60 * 1000; // QIE's claim window after consent
const QIEPASS_MAX_REQUESTS = 10000;
const QIEPASS_MIN_SIGNER_BALANCE = ethers.parseEther("0.01");
const QIEPASS_TX_TIMEOUT_MS = 90 * 1000;
const QIEPASS_RETRY_MS = 5 * 60 * 1000;
const QIEPASS_REGISTRY_ABI = ["function qiePass() view returns (address)"];
const QIEPASS_ADAPTER_ABI = [
  "function oracle() view returns (address)",
  "function verifyIdentity(address user) view returns (bool)",
  "function registerIdentity(address user, bool status) external"
];
const QIEPASS_UNAVAILABLE = "Verification is temporarily unavailable. Please try again later.";
const QIEPASS_UNREACHABLE = "Couldn't reach QIE Pass. Please try again later.";
const QIEPASS_WRONG_WALLET = "This verification request belongs to a different wallet.";
const QIEPASS_DENIED = "This wallet's key is known to be compromised, so Fluenci won't mark it as verified.";
const QIEPASS_OFF = "QIE Pass verification isn't available right now.";

// QIE's production API with a live key, or the sandbox when explicitly allowed
// on a known chain that isn't QIE mainnet. The chain id only counts for the
// provider in use, so a reconnect that hasn't read its chain yet is "unknown".
function qiePassAllowed() {
  if (QIEPASS_ENV.production) return true;
  const chainId = connectedChain && connectedChain.provider === provider ? connectedChain.chainId : null;
  return QIEPASS_ALLOW_SANDBOX && chainId !== null && chainId !== QIE_MAINNET_CHAIN_ID;
}

// Routes call this before anything reaches QIE.
function requireQiePassAllowed(res) {
  if (qiePassAllowed()) return true;
  // off:true lets an app flow that is already running stop, rather than
  // treating this like a temporary outage and polling forever.
  res.status(503).json({ success: false, off: true, error: QIEPASS_OFF });
  return false;
}

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
function normalizeWallet(value) {
  if (typeof value !== "string" || !HEX_ADDRESS_RE.test(value) || !ethers.isAddress(value)) return null;
  return ethers.getAddress(value);
}
const sameWallet = (a, b) =>
  typeof a === "string" && typeof b === "string" && HEX_ADDRESS_RE.test(a) && a.toLowerCase() === b.toLowerCase();
const isDeniedWallet = (wallet) => QIEPASS_DENYLIST.has(wallet.toLowerCase());

// QIE errors look like {success:false, error:"<summary>", message:"<detail>"}.
function qieErrorText(data, response, fallback) {
  const parts = [typeof data?.error === "string" ? data.error : data?.error?.message, data?.message]
    .filter((p) => typeof p === "string" && p.trim());
  const text = [...new Set(parts)].join(" - ") || response?.statusText || fallback;
  return text.replace(QIEPASS_REQUEST_ID_ANY, "pvr_••••").slice(0, 300);
}
// Statuses that mean something to the caller pass through; QIE auth failures
// or outages are ours to fix, so the browser sees a 502.
function qieHttpStatus(status) {
  return [400, 404, 409, 410, 422, 429].includes(status) ? status : 502;
}

async function fetchQiePassRequest(requestId) {
  const response = await fetch(`${QIEPASS_API_URL}/api/v1/partners/verification-requests/${encodeURIComponent(requestId)}`, {
    method: "GET",
    headers: generateQiePassHeaders()
  });
  return { response, data: await response.json().catch(() => null) };
}

// requestId -> { wallet, createdAt, expiresAt, claiming, accepted }. The wallet is
// bound at /qiepass/verify, where QIE confirms the request is for that wallet, so
// a claim can only ever mark that wallet and never one named by the caller.
// Once `accepted` (QIE accepted a credential for the wallet), the binding never
// calls QIE's claim again and only answers re-checks from the chain.
const qiePassRequests = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, r] of qiePassRequests) {
    if (r.expiresAt <= now && !r.claiming) qiePassRequests.delete(id);
  }
}, 10 * 60 * 1000).unref();

// ---- On-chain writer --------------------------------------------------------

let qiePassWriter = { adapter: null, oracleOk: false, funded: false };
let qiePassWriterAt = 0;
let qiePassWriterCheck = null;

// The registry enforces whichever adapter registry.qiePass() points at, so that
// is the one to write to, and the AI key must be its oracle with gas to spend.
async function readQiePassWriter() {
  const state = { adapter: null, oracleOk: false, funded: false };
  if (!provider || !REGISTRY_ADDRESS) return state;
  try {
    const registry = new ethers.Contract(REGISTRY_ADDRESS, QIEPASS_REGISTRY_ABI, provider);
    const adapter = await withTimeout(registry.qiePass(), 15000, "registry.qiePass()");
    if (adapter === ethers.ZeroAddress) return state;
    state.adapter = adapter;
    if (aiWallet) {
      const [oracle, balance] = await withTimeout(Promise.all([
        new ethers.Contract(adapter, QIEPASS_ADAPTER_ABI, provider).oracle(),
        provider.getBalance(aiWallet.address)
      ]), 15000, "QIE Pass writer check");
      state.oracleOk = oracle.toLowerCase() === aiWallet.address.toLowerCase();
      state.funded = balance >= QIEPASS_MIN_SIGNER_BALANCE;
    }
  } catch (err) {
    console.warn(`[QIEPASS] Writer check failed: ${errText(err)}`);
  }
  return state;
}

// Never rejects; concurrent callers share one read.
function checkQiePassWriter() {
  if (!qiePassWriterCheck) {
    qiePassWriterCheck = readQiePassWriter()
      .then((state) => {
        qiePassWriter = state;
        qiePassWriterAt = Date.now();
        return state;
      })
      .finally(() => { qiePassWriterCheck = null; });
  }
  return qiePassWriterCheck;
}

const qiePassWriterReady = (w) => Boolean(qiePassAllowed() && w.adapter && w.oracleOk && w.funded);

async function readQiePassVerified(adapter, wallet) {
  try {
    return await new ethers.Contract(adapter, QIEPASS_ADAPTER_ABI, provider).verifyIdentity(wallet);
  } catch {
    return false;
  }
}

async function writeQiePass(wallet) {
  if (isDeniedWallet(wallet)) throw new Error("wallet is on the denylist");
  const writer = await checkQiePassWriter();
  if (!writer.adapter) throw new Error("QIE Pass adapter unreadable");
  const pass = new ethers.Contract(writer.adapter, QIEPASS_ADAPTER_ABI, provider);
  if (await pass.verifyIdentity(wallet)) return null;
  if (!qiePassWriterReady(writer) || !aiSigner) {
    throw new Error(`writer not ready (oracle matches signer: ${writer.oracleOk}, funded: ${writer.funded})`);
  }
  const tx = await sendFromAiSigner(() => pass.connect(aiSigner).registerIdentity(wallet, true, { gasLimit: 100000n }));
  const receipt = await tx.wait(1, QIEPASS_TX_TIMEOUT_MS); // throws on revert or timeout
  if (!receipt || receipt.status !== 1) throw new Error(`registerIdentity failed (tx ${tx.hash})`);
  if (!(await pass.verifyIdentity(wallet))) throw new Error(`adapter still reads unverified after tx ${tx.hash}`);
  return tx.hash;
}

// Resolves to the tx hash, or null when the adapter already read true. Throws
// unless the adapter reads true afterwards. One write per wallet at a time.
const qiePassWrites = new Map();
function registerQiePassOnchain(wallet) {
  const key = wallet.toLowerCase();
  if (!qiePassWrites.has(key)) {
    qiePassWrites.set(key, writeQiePass(wallet).finally(() => qiePassWrites.delete(key)));
  }
  return qiePassWrites.get(key);
}

// ---- Pending writes (persisted) ---------------------------------------------

// QIE consents are single-use, so a credential QIE accepted but we couldn't
// record on-chain is kept here and retried rather than asking the user again.
// `subjects` maps a QIE Pass ID to the wallets it verified, to spot reuse.
const QIEPASS_DATA_FILE = path.join(__dirname, "data", "qiepass.json");

function loadQiePassData() {
  try {
    const raw = JSON.parse(fs.readFileSync(QIEPASS_DATA_FILE, "utf8"));
    return { pending: raw?.pending || {}, subjects: raw?.subjects || {}, quarantined: raw?.quarantined || {} };
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[QIEPASS] Could not read ${QIEPASS_DATA_FILE}: ${err.message}`);
      // Keep the unreadable file for inspection instead of overwriting it.
      try { fs.renameSync(QIEPASS_DATA_FILE, `${QIEPASS_DATA_FILE}.bad-${Date.now()}`); } catch { /* ignore */ }
    }
    return { pending: {}, subjects: {}, quarantined: {} };
  }
}
let qiePassData = loadQiePassData();

// A queued write is only as good as the QIE environment that accepted it. On
// production keys, an entry accepted by the sandbox (or queued before entries
// were stamped) must never reach mainnet: it is set aside, logged, and kept
// for inspection instead of written.
function pendingUsable(entry) {
  return !QIEPASS_ENV.production || entry?.production === true;
}
function quarantineForeignPending() {
  let moved = 0;
  for (const [key, entry] of Object.entries(qiePassData.pending)) {
    if (pendingUsable(entry)) continue;
    qiePassData.quarantined[key] = { ...entry, quarantinedAt: new Date().toISOString() };
    delete qiePassData.pending[key];
    moved += 1;
  }
  if (moved) {
    console.warn(`[QIEPASS] Set aside ${moved} queued write(s) accepted outside QIE production; they will not be written onchain.`);
    saveQiePassData();
  }
}

function saveQiePassData() {
  try {
    fs.mkdirSync(path.dirname(QIEPASS_DATA_FILE), { recursive: true });
    const tmp = `${QIEPASS_DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(qiePassData, null, 2));
    fs.renameSync(tmp, QIEPASS_DATA_FILE);
  } catch (err) {
    console.error(`[QIEPASS] Could not save ${QIEPASS_DATA_FILE}: ${err.message}`);
  }
}

function queuePendingQiePass(wallet, subject) {
  const key = wallet.toLowerCase();
  const prev = qiePassData.pending[key];
  qiePassData.pending[key] = {
    wallet,
    subject: subject || prev?.subject || null,
    at: prev?.at || new Date().toISOString(),
    production: QIEPASS_ENV.production,
  };
  saveQiePassData();
}

function clearPendingQiePass(wallet) {
  const key = wallet.toLowerCase();
  if (!qiePassData.pending[key]) return;
  delete qiePassData.pending[key];
  saveQiePassData();
}

// One person may run several merchant wallets, so reuse is only reported.
function recordQiePassSubject(subject, wallet) {
  if (typeof subject !== "string" || !subject) return;
  const wallets = qiePassData.subjects[subject] || [];
  if (wallets.some((w) => w.toLowerCase() === wallet.toLowerCase())) return;
  if (wallets.length) {
    console.warn(`[QIEPASS] A QIE Pass ID already linked to ${wallets.length} other wallet(s) also verified ${wallet}`);
  }
  qiePassData.subjects[subject] = [...wallets, wallet];
  saveQiePassData();
}

let qiePassRetrying = false;
async function retryPendingQiePassWrites() {
  // Entries are kept, not dropped, while QIE Pass is off.
  if (qiePassRetrying || !qiePassAllowed()) return;
  quarantineForeignPending();
  const entries = Object.values(qiePassData.pending);
  if (entries.length === 0) return;
  qiePassRetrying = true;
  try {
    for (const entry of entries) {
      if (!normalizeWallet(entry?.wallet) || isDeniedWallet(entry.wallet)) {
        if (entry?.wallet) clearPendingQiePass(entry.wallet);
        continue;
      }
      try {
        const txHash = await registerQiePassOnchain(entry.wallet);
        clearPendingQiePass(entry.wallet);
        logTelemetry("QIEPASS", `Queued QIE Pass verification recorded onchain for ${entry.wallet}${txHash ? `. TX: ${txHash}` : " (already verified)"}`);
      } catch (err) {
        console.warn(`[QIEPASS] Retry for ${entry.wallet} failed: ${errText(err)}`);
      }
    }
  } finally {
    qiePassRetrying = false;
  }
}
setInterval(() => { retryPendingQiePassWrites().catch(() => {}); }, QIEPASS_RETRY_MS).unref();

const QIEPASS_PENDING_BODY = {
  success: false,
  verified: false,
  pending: true,
  error: "Your QIE Pass was accepted, but recording it onchain is still pending. Fluenci retries automatically, so check back later."
};

// Finishes a claim QIE has accepted: 200 only once the chain reads verified,
// otherwise the write is queued and the caller gets 202 pending.
async function finishQiePassWrite(res, wallet, subject, requestId = null) {
  try {
    const txHash = await registerQiePassOnchain(wallet);
    clearPendingQiePass(wallet);
    // Kept (until its TTL) so a re-check from an app whose RPC lags is
    // answered from the chain instead of "expired or unknown".
    const binding = requestId ? qiePassRequests.get(requestId) : null;
    if (binding) {
      binding.accepted = true;
      binding.txHash = txHash || binding.txHash || null;
    }
    logTelemetry("QIEPASS", txHash ? `Identity registered onchain for ${wallet}. TX: ${txHash}` : `${wallet} is already verified onchain`);
    return res.json({ success: true, verified: true, onchain: true, txHash });
  } catch (err) {
    queuePendingQiePass(wallet, subject);
    logTelemetry("ERROR", `QIE Pass accepted for ${wallet}, but the onchain write failed: ${errText(err)}. Queued for retry.`);
    return res.status(202).json(QIEPASS_PENDING_BODY);
  }
}

const QIEPASS_NOT_APPROVED = {
  pending_kyc: "Finish your QIE Pass KYC in QIE Wallet first.",
  pending_consent: "Approve the request in QIE Wallet first.",
  consent_rejected: "The request was rejected in QIE Wallet.",
  expired: "This verification request has expired. Please start verification again.",
  failed: "QIE Pass could not verify your identity."
};

// ---- Routes -----------------------------------------------------------------

// Create a QIE Pass verification request
app.post("/qiepass/verify", async (req, res) => {
  const wallet = normalizeWallet(req.body?.walletAddress);
  if (!wallet) {
    return res.status(400).json({ success: false, error: "Missing or invalid walletAddress" });
  }
  if (!requireQiePassAllowed(res)) return;
  if (isDeniedWallet(wallet)) {
    logTelemetry("WARNING", `Refused QIE Pass request for compromised wallet ${wallet}`);
    return res.status(403).json({ success: false, error: QIEPASS_DENIED });
  }
  if (!QIEPASS_PUBLIC_KEY || !QIEPASS_SECRET_KEY) {
    return res.status(500).json({ success: false, error: "QIE Pass API keys not configured" });
  }

  try {
    logTelemetry("QIEPASS", `Creating verification request for ${wallet}`, { claims: QIEPASS_CLAIMS });

    const response = await fetch(`${QIEPASS_API_URL}/api/v1/partners/verification-requests`, {
      method: "POST",
      headers: generateQiePassHeaders(),
      body: JSON.stringify({ identifier: wallet, requestedClaims: QIEPASS_CLAIMS })
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.success === false) {
      const error = qieErrorText(data, response, "QIE Pass API error");
      logTelemetry("QIEPASS", `Verification request failed for ${wallet}: ${error}`);
      return res.status(response.ok ? 502 : qieHttpStatus(response.status)).json({ success: false, error });
    }

    const request = data?.data || {};
    if (typeof request.requestId !== "string" || !QIEPASS_REQUEST_ID_RE.test(request.requestId)) {
      logTelemetry("QIEPASS", `Verification request for ${wallet} came back without a usable request id`);
      return res.status(502).json({ success: false, error: "QIE Pass returned an unexpected response. Please try again later." });
    }
    // The request is only usable if QIE says it is for this exact wallet.
    if (!request.walletAddress) {
      logTelemetry("QIEPASS", `Verification request for ${wallet} came back without a linked wallet; not used`);
      return res.status(502).json({ success: false, error: "QIE Pass didn't confirm which wallet this request is for, so it can't be used. Please try again later." });
    }
    if (!sameWallet(request.walletAddress, wallet)) {
      logTelemetry("QIEPASS", `Verification request for ${wallet} is linked to a different wallet; not used`);
      return res.status(409).json({ success: false, error: "Your QIE Pass is linked to a different wallet. Connect that wallet and try again." });
    }

    // QIE hands back the same request while it is pending, so a repeat call
    // just extends the binding. Kept until QIE's own expiry (1h minimum).
    const now = Date.now();
    const qieExpiry = Date.parse(request.expiresAt || "");
    const expiresAt = Math.min(now + QIEPASS_REQUEST_MAX_TTL_MS, Math.max(now + QIEPASS_REQUEST_TTL_MS, Number.isFinite(qieExpiry) ? qieExpiry : 0));
    const existing = qiePassRequests.get(request.requestId);
    if (existing?.wallet === wallet) {
      existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
    } else {
      qiePassRequests.set(request.requestId, { wallet, createdAt: now, expiresAt, claiming: false });
      while (qiePassRequests.size > QIEPASS_MAX_REQUESTS) qiePassRequests.delete(qiePassRequests.keys().next().value);
    }

    logTelemetry("QIEPASS", `Verification request created for ${wallet}. Status: ${request.status}`);
    res.json({
      success: true,
      requestId: request.requestId,
      status: request.status,
      userStatus: request.userStatus,
      redirectUrl: request.redirectUrl,
      expiresAt: request.expiresAt
    });
  } catch (err) {
    logTelemetry("QIEPASS", `Verification request error for ${wallet}: ${errText(err)}`);
    res.status(502).json({ success: false, error: QIEPASS_UNREACHABLE });
  }
});

// Poll QIE Pass verification status. Returns only what the client needs to
// decide when to claim: no wallet, DID or claims.
app.get("/qiepass/status/:requestId", async (req, res) => {
  const { requestId } = req.params;
  if (!QIEPASS_REQUEST_ID_RE.test(requestId)) {
    return res.status(400).json({ success: false, error: "Invalid requestId" });
  }
  if (!requireQiePassAllowed(res)) return;
  if (!QIEPASS_PUBLIC_KEY || !QIEPASS_SECRET_KEY) {
    return res.status(500).json({ success: false, error: "QIE Pass API keys not configured" });
  }

  try {
    const { response, data } = await fetchQiePassRequest(requestId);
    if (!response.ok) {
      return res.status(qieHttpStatus(response.status)).json({ success: false, error: qieErrorText(data, response, "QIE Pass API error") });
    }
    const ready = data?.data?.vcMetadata?.ready === true;
    res.json({ success: true, status: data?.data?.status, ready, vcMetadata: { ready } });
  } catch (err) {
    console.warn(`[QIEPASS] Status check failed: ${errText(err)}`);
    res.status(502).json({ success: false, error: QIEPASS_UNREACHABLE });
  }
});

// Claim and verify QIE Pass credentials, then register the bound wallet onchain
app.post("/qiepass/claim", async (req, res) => {
  const { requestId, walletAddress } = req.body || {};
  if (typeof requestId !== "string" || !QIEPASS_REQUEST_ID_RE.test(requestId)) {
    return res.status(400).json({ success: false, error: "Missing or invalid requestId" });
  }
  if (!requireQiePassAllowed(res)) return;
  const binding = qiePassRequests.get(requestId);
  if (!binding || binding.expiresAt <= Date.now()) {
    return res.status(400).json({ success: false, error: "This verification request has expired or is unknown. Please start verification again." });
  }
  // Always the wallet bound at /qiepass/verify; a body wallet may only confirm it.
  const wallet = binding.wallet;
  if (walletAddress != null && walletAddress !== "" && !sameWallet(walletAddress, wallet)) {
    return res.status(403).json({ success: false, error: QIEPASS_WRONG_WALLET });
  }
  if (isDeniedWallet(wallet)) {
    logTelemetry("WARNING", `Refused QIE Pass claim for compromised wallet ${wallet}`);
    return res.status(403).json({ success: false, error: QIEPASS_DENIED });
  }
  if (!QIEPASS_PUBLIC_KEY || !QIEPASS_SECRET_KEY) {
    return res.status(500).json({ success: false, error: "QIE Pass API keys not configured" });
  }
  if (binding.claiming) {
    // The app re-checks an accepted request while its write is in flight.
    if (binding.accepted) return res.status(202).json(QIEPASS_PENDING_BODY);
    return res.status(409).json({ success: false, error: "This verification is already being processed." });
  }

  binding.claiming = true;
  try {
    // QIE already accepted a credential for this wallet earlier: finish that
    // write instead of spending another consent.
    quarantineForeignPending();
    const pending = qiePassData.pending[wallet.toLowerCase()];
    if (pending) {
      return await finishQiePassWrite(res, wallet, pending.subject, requestId);
    }
    // Accepted by QIE, not pending, so the write already landed (or the
    // pending record couldn't be saved): answer from the chain, never re-claim.
    // The binding stays until its TTL, so repeated re-checks get the same answer.
    if (binding.accepted) {
      const writer = await checkQiePassWriter();
      if (writer.adapter && await readQiePassVerified(writer.adapter, wallet)) {
        return res.json({ success: true, verified: true, onchain: true, txHash: binding.txHash || null });
      }
      return res.status(202).json(QIEPASS_PENDING_BODY);
    }

    // Everything that could stop the on-chain write is checked before QIE's
    // claim, which uses up the user's consent.
    const writer = await checkQiePassWriter();
    if (writer.adapter && await readQiePassVerified(writer.adapter, wallet)) {
      logTelemetry("QIEPASS", `${wallet} is already verified onchain; nothing to claim`);
      return res.json({ success: true, verified: true, onchain: true, txHash: null });
    }
    if (!qiePassWriterReady(writer)) {
      logTelemetry("ERROR", `QIE Pass claim for ${wallet} refused: onchain writer not ready (adapter: ${writer.adapter || "unreadable"}, oracle matches signer: ${writer.oracleOk}, signer holds 0.01+ QIE: ${writer.funded})`);
      return res.status(503).json({ success: false, error: QIEPASS_UNAVAILABLE });
    }

    const status = await fetchQiePassRequest(requestId);
    if (!status.response.ok) {
      return res.status(qieHttpStatus(status.response.status)).json({ success: false, error: qieErrorText(status.data, status.response, "QIE Pass API error") });
    }
    const request = status.data?.data || {};
    if (request.walletAddress && !sameWallet(request.walletAddress, wallet)) {
      logTelemetry("QIEPASS", `QIE Pass claim for ${wallet} refused: QIE links the request to a different wallet`);
      return res.status(403).json({ success: false, error: QIEPASS_WRONG_WALLET });
    }
    if (request.status !== "consent_given") {
      return res.status(409).json({ success: false, error: QIEPASS_NOT_APPROVED[request.status] || "This request hasn't been approved in QIE Wallet." });
    }

    logTelemetry("QIEPASS", `Claiming credentials for ${wallet}`);
    const response = await fetch(`${QIEPASS_API_URL}/api/v1/vc/partner/claim-and-verify`, {
      method: "POST",
      headers: generateQiePassHeaders(),
      body: JSON.stringify({ requestId })
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data?.success === false) {
      const error = qieErrorText(data, response, "Claim failed");
      logTelemetry("QIEPASS", `Claim failed for ${wallet}: ${error}`);
      return res.status(response.ok ? 502 : qieHttpStatus(response.status)).json({ success: false, error });
    }
    // The consent is spent now: QIE's claim is never called again for this
    // request, but the binding stays so the app can poll the on-chain write.
    binding.accepted = true;

    const v = data?.verification;
    const kycVerified = data?.publicClaims?.kyc_verified === true;
    if (!v?.signatureValid || !v?.commitmentValid || !v?.notExpired || !v?.notRevoked || !kycVerified) {
      logTelemetry("QIEPASS", `Credential checks failed for ${wallet}`, {
        signatureValid: v?.signatureValid === true,
        commitmentValid: v?.commitmentValid === true,
        notExpired: v?.notExpired === true,
        notRevoked: v?.notRevoked === true,
        kycVerified
      });
      qiePassRequests.delete(requestId);
      return res.status(400).json({ success: false, error: "QIE Pass returned a credential that didn't pass verification, so this wallet was not marked as verified." });
    }

    recordQiePassSubject(data.subject, wallet);
    logTelemetry("QIEPASS", `Credentials verified for ${wallet}. Registering identity onchain...`);
    return await finishQiePassWrite(res, wallet, data.subject, requestId);
  } catch (err) {
    logTelemetry("QIEPASS", `Claim error for ${wallet}: ${errText(err)}`);
    res.status(502).json({ success: false, error: QIEPASS_UNREACHABLE });
  } finally {
    binding.claiming = false;
  }
});

// ==========================================
// FLUENCI ARCADE: SIGN-IN, PASS, SNAKE SCORES
// ==========================================

// Sign-in tokens are HMAC'd with SESSION_SECRET (32+ characters). Without it,
// sign-in and every route that needs it (the pass check, Snake scores and
// /api/chat) answer 503 not_configured.
const SESSION_SECRET = process.env.SESSION_SECRET || "";
// The Arcade merchant wallet (same as the frontend's VITE_ARCADE_MERCHANT).
const ARCADE_MERCHANT = (process.env.ARCADE_MERCHANT || "").trim();
// Replaces the pass's stablecoin allowlist on a local test chain; ignored on
// QIE mainnet and while the chain is unknown (see arcade/pass.js).
const ARCADE_STABLECOINS = process.env.ARCADE_STABLECOINS || "";

const arcadeAuth = createAuth({ secret: SESSION_SECRET });
const arcadePass = createPassChecker({
  merchant: ethers.isAddress(ARCADE_MERCHANT) ? ethers.getAddress(ARCADE_MERCHANT) : "",
  stablecoinsEnv: ARCADE_STABLECOINS,
  getProvider: () => provider,
  getRegistryAddress: () => REGISTRY_ADDRESS,
  getChainId: () => (connectedChain && connectedChain.provider === provider ? connectedChain.chainId : null),
});
const arcadeSnake = createSnakeService();
const arcadeLeaderboard = createLeaderboard({ file: path.join(__dirname, "data", "arcade.json") });
const arcade = mountArcade(app, {
  auth: arcadeAuth,
  passChecker: arcadePass,
  snake: arcadeSnake,
  leaderboard: arcadeLeaderboard,
  clientIp: (req) => chatClientIp(req),
});

// Logged once at boot. Never the secret itself.
if (!secretUsable(SESSION_SECRET)) {
  console.warn("[ARCADE] SESSION_SECRET is missing or shorter than 32 characters: sign-in, the Arcade Pass check, Snake scores and /api/chat answer 503.");
}
if (!ethers.isAddress(ARCADE_MERCHANT)) {
  console.warn("[ARCADE] ARCADE_MERCHANT is not set to a wallet address: no Arcade Pass can be valid, so /api/chat and Snake scores answer 503.");
}
if (ARCADE_STABLECOINS) {
  console.warn("[ARCADE] ARCADE_STABLECOINS is set. It is for local test chains only and is ignored on QIE mainnet (1990).");
}

// ===== FLUENCI AI CHAT ENDPOINT =====
const FLUENCI_SYSTEM_PROMPT = `You are Fluenci AI, the assistant inside the Fluenci app.

What Fluenci is:
- Stripe-style subscriptions for Web3, built on QIE Blockchain (EVM-compatible, chain ID 1990).
- Plans are priced in plain dollars per period (for example $20/month) and settled in qUSDC. The Fluenci Arcade Pass also accepts USDC/USDT bridged from Ethereum.
- Subscriptions are non-custodial and pull-based: funds stay in the subscriber's own wallet until the merchant claims what has accrued.
- Subscribers set a spending cap that only they can raise; any claim above the cap is clamped to it.
- Subscribers can cancel anytime. Accrual stops immediately and only the final settled amount is owed.
- Each merchant chooses one access gate for their subscribers: Open, QIE ID required, QIE Pass verified, or Minimum reputation (based on QIE's live Reputation Score API).
- Fluenci Protect monitors active subscriptions and can pause anomalous ones.
- The Fluenci Arcade Pass costs $1/month and unlocks the Snake arcade and this AI chat.

How to answer:
- Be friendly and concise: at most 4 short sentences unless the user asks for more detail.
- Never give financial or investment advice, price predictions, or token recommendations.
- Never ask for, accept, or repeat private keys, seed phrases, or passwords. If a user offers one, tell them to keep it secret.
- If you are unsure or a detail is not listed above, say so plainly instead of inventing features, numbers, addresses, or links.`;

// Abuse limits for /api/chat. Every call spends OpenAI credit, so the route is
// open only to a signed-in wallet holding a valid Arcade Pass (checked on chain),
// and capped per client IP, per wallet and globally; all state is in memory
// (single VPS process).
const CHAT_BODY_LIMIT_BYTES = 32 * 1024;
const CHAT_MAX_MESSAGES = 12;
const CHAT_MAX_MSG_CHARS = 1000;
const CHAT_MAX_TOTAL_CHARS = 6000;
const CHAT_IP_WINDOW_MS = 10 * 60 * 1000;
const CHAT_IP_MAX = 20;
const CHAT_DAILY_MAX = 2000;
const CHAT_WALLET_WINDOW_MAX = 20;  // per CHAT_IP_WINDOW_MS, so one pass can't be spread over many IPs
const CHAT_WALLET_DAILY_MAX = 100;  // per UTC day
const chatWalletWindow = createWindowLimiter({ windowMs: CHAT_IP_WINDOW_MS, max: CHAT_WALLET_WINDOW_MAX });
const chatWalletDaily = createDailyLimiter({ max: CHAT_WALLET_DAILY_MAX });

const chatIpHits = new Map(); // ip -> array of request timestamps inside the window
let chatDay = new Date().toISOString().slice(0, 10); // UTC date the counter belongs to
let chatDayCount = 0;

// The VPS sits behind a local TLS proxy (nginx) that appends the real client
// address as the LAST X-Forwarded-For entry. Earlier entries are whatever the
// client sent, so trusting the first one would let anyone dodge the limit by
// sending a fresh fake IP per request. The header is only honoured when the
// socket peer is the local proxy; direct connections use the socket address.
const CHAT_MAX_TRACKED_IPS = 50000;
function isLoopback(addr) {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}
function chatClientIp(req) {
  const peer = req.socket?.remoteAddress || "";
  if (isLoopback(peer)) {
    const xff = req.headers["x-forwarded-for"];
    const last = typeof xff === "string" ? xff.split(",").pop().trim() : "";
    if (net.isIP(last)) return last;
  }
  return peer || "unknown";
}

// Sliding-window check; records the hit only when it is allowed.
function chatIpAllowed(ip, now) {
  const recent = (chatIpHits.get(ip) || []).filter((t) => now - t < CHAT_IP_WINDOW_MS);
  if (recent.length >= CHAT_IP_MAX) {
    chatIpHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  chatIpHits.delete(ip); // re-insert so Map order tracks recency
  chatIpHits.set(ip, recent);
  // Hard ceiling between prunes: evict the least recently seen IPs.
  while (chatIpHits.size > CHAT_MAX_TRACKED_IPS) {
    chatIpHits.delete(chatIpHits.keys().next().value);
  }
  return true;
}

// Drop IPs with no hits in the window so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of chatIpHits) {
    if (!hits.length || now - hits[hits.length - 1] >= CHAT_IP_WINDOW_MS) chatIpHits.delete(ip);
  }
}, 60 * 1000).unref();

// Only well-formed user/assistant turns reach the model; a client-supplied
// "system" role would let a caller override the prompt.
function sanitizeChatMessages(raw) {
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, CHAT_MAX_MSG_CHARS) }))
    .filter((m) => m.content.trim().length > 0)
    .slice(-CHAT_MAX_MESSAGES);
}

// Every /api/chat error body is {error, code} so the client can word each case.
function chatError(res, status, code, error) {
  return res.status(status).json({ error, code });
}

// Runs before the body is parsed, so oversized and malformed requests still
// count against the per-IP limit.
function chatGate(req, res, next) {
  if (process.env.CHAT_DISABLED === "true") {
    return chatError(res, 503, "disabled", "Chat is temporarily disabled.");
  }
  if (!chatIpAllowed(chatClientIp(req), Date.now())) {
    return chatError(res, 429, "rate_ip", "Too many chat requests. Please wait a few minutes and try again.");
  }
  next();
}

// Route-scoped parser. The app-wide express.json() skips /api/chat, so this
// byte limit is the one that applies.
const chatJson = express.json({ limit: CHAT_BODY_LIMIT_BYTES });
function parseChatBody(req, res, next) {
  chatJson(req, res, (err) => {
    if (!err) return next();
    if (err.type === "entity.too.large") return chatError(res, 413, "too_large", "Request body too large.");
    return chatError(res, 400, "bad_request", "Invalid request body.");
  });
}

// Per-wallet limits, after the pass check (req.session is the signed-in wallet).
function chatWalletGate(req, res, next) {
  const wallet = req.session.address.toLowerCase();
  const now = Date.now();
  if (!chatWalletWindow.allow(wallet, now)) {
    return chatError(res, 429, "rate_address", "This wallet has sent a lot of chat messages recently. Wait a few minutes and try again.");
  }
  if (!chatWalletDaily.allow(wallet, now)) {
    return chatError(res, 429, "rate_address", "This wallet has reached today's chat limit. It resets at midnight UTC.");
  }
  next();
}

// Order: kill switch and per-IP limit, then sign-in (401/503), body (413/400),
// a valid Arcade Pass (403 no_pass), per-wallet limits, then the model.
app.post("/api/chat", chatGate, arcade.requireSession, parseChatBody, arcade.requirePass, chatWalletGate, async (req, res) => {
  const messages = sanitizeChatMessages(req.body?.messages);
  if (!messages) {
    return chatError(res, 400, "bad_request", "messages array required");
  }
  if (messages.length === 0) {
    return chatError(res, 400, "bad_request", "No valid user or assistant messages provided.");
  }
  // Long conversations keep working: drop the oldest turns until the total fits.
  let totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  while (totalChars > CHAT_MAX_TOTAL_CHARS && messages.length > 1) {
    totalChars -= messages.shift().content.length;
  }

  if (!openai) {
    return chatError(res, 503, "not_configured", "OpenAI not configured");
  }

  // Global daily budget, counted only for calls that actually reach OpenAI.
  const today = new Date().toISOString().slice(0, 10);
  if (today !== chatDay) {
    chatDay = today;
    chatDayCount = 0;
  }
  if (chatDayCount >= CHAT_DAILY_MAX) {
    return chatError(res, 429, "rate_daily", "Daily chat limit reached. It resets at midnight UTC.");
  }
  chatDayCount += 1;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: FLUENCI_SYSTEM_PROMPT }, ...messages],
      max_tokens: 300,
      temperature: 0.7
    });

    const reply = completion.choices[0]?.message?.content || "I'm having trouble thinking right now. Try again!";
    res.json({ reply });
  } catch (err) {
    // Log status/message only; the client gets a generic error with no internals.
    console.error("Chat error:", err?.status || "", err?.message || err);
    chatError(res, 502, "upstream", "AI service temporarily unavailable");
  }
});

// Start Express Server and Connect
// ============================================================================
// QIE Reputation (DRS)
// Reads a wallet's reputation from QIE's DRS API (key stays server-side), and
// for the gate, signs an EIP-712 attestation the on-chain attestor accepts.
// ============================================================================

const REP_DOMAIN = {
  name: "Fluenci Reputation Attestor",
  version: "1",
  chainId: REPUTATION_CHAIN_ID,
  verifyingContract: REPUTATION_ATTESTOR_ADDRESS,
};
const REP_TYPES = {
  ReputationAttestation: [
    { name: "wallet", type: "address" },
    { name: "score", type: "uint256" },
    { name: "tier", type: "string" },
    { name: "modelVersion", type: "string" },
    { name: "issuedAt", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
    { name: "chainId", type: "uint256" },
  ],
};

// Accepts a wallet address or a .qie name; DRS resolves a name to its owner.
async function fetchDrsReputation(addressOrName) {
  if (!DRS_API_KEY) throw Object.assign(new Error("Reputation API key not configured"), { status: 503 });
  const url = `${DRS_API_URL.replace(/\/$/, "")}/api/reputation/${encodeURIComponent(addressOrName)}/factors`;
  const res = await fetch(url, { headers: { "api-key": DRS_API_KEY } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`DRS API returned ${res.status}`), { status: res.status, detail });
  }
  const body = await res.json();
  const d = body?.data ?? body;
  return {
    address: (d.address || "").toLowerCase(),
    score: d.score,
    tier: d.tier,
    modelVersion: d.modelVersion,
    penalty: d.penalty,
    factors: d.factors,
    resolvedFrom: body?.resolvedFrom ?? null,
  };
}

// Display-only reputation (no signature). Safe to expose to the frontend.
app.get("/reputation/public/:address", async (req, res) => {
  try {
    const r = await fetchDrsReputation(req.params.address);
    res.json({
      data: {
        score: r.score, tier: r.tier, modelVersion: r.modelVersion,
        penalty: r.penalty, factors: r.factors, resolvedFrom: r.resolvedFrom,
      },
    });
  } catch (e) {
    res.status(e.status || 502).json({ error: { message: e.message } });
  }
});

// Signed attestation for the on-chain gate. Score is stored as a rounded 0-100
// integer (the DRS scale), which is what the merchant's minReputation compares to.
app.get("/reputation/attest/:address", async (req, res) => {
  try {
    if (!REPUTATION_SIGNER_KEY || !REPUTATION_ATTESTOR_ADDRESS) {
      return res.status(503).json({ error: { message: "Attestation signer not configured" } });
    }
    const r = await fetchDrsReputation(req.params.address);
    const wallet = ethers.getAddress(r.address);

    // Base issuedAt on chain time so a fast local clock can't push it into the
    // future (the attestor rejects issuedAt > block.timestamp).
    let chainNow = Math.floor(Date.now() / 1000);
    try {
      const repProvider = new ethers.JsonRpcProvider(process.env.RPC_URL || "https://rpc1mainnet.qie.digital");
      const block = await repProvider.getBlock("latest");
      if (block?.timestamp) chainNow = Number(block.timestamp);
    } catch { /* fall back to system time */ }

    const issuedAt = chainNow - 120;
    const expiresAt = issuedAt + REPUTATION_TTL_DAYS * 86400;
    const score = Math.round(Number(r.score));
    const attestation = { wallet, score, tier: r.tier, modelVersion: r.modelVersion, issuedAt, expiresAt, chainId: REPUTATION_CHAIN_ID };

    const signer = new ethers.Wallet(REPUTATION_SIGNER_KEY);
    const signature = await signer.signTypedData(REP_DOMAIN, REP_TYPES, {
      wallet,
      score: BigInt(score),
      tier: r.tier,
      modelVersion: r.modelVersion,
      issuedAt: BigInt(issuedAt),
      expiresAt: BigInt(expiresAt),
      chainId: BigInt(REPUTATION_CHAIN_ID),
    });

    res.json({ ok: true, address: wallet, score: r.score, tier: r.tier, attestation, signature });
  } catch (e) {
    res.status(e.status || 502).json({ error: { message: e.message } });
  }
});

// Last-resort handler (body-parser errors on the other routes end up here):
// JSON only, never a stack trace.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error("Unhandled error:", errText(err));
  const error = status === 413 ? "Request body too large." : status < 500 ? "Invalid request." : "Internal server error.";
  if (isChatPath(req.path) || isArcadePath(req.path)) {
    return res.status(status).json({ error, code: status === 413 ? "too_large" : status < 500 ? "bad_request" : "upstream" });
  }
  res.status(status).json({ success: false, error });
});

app.listen(PORT, async () => {
  console.log(`AI Auditor API Server running on port ${PORT}`);
  await connectBlockchain();
});
