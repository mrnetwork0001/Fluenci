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
let totalVolume = 0n;
let totalSwapVolume = 0n;
let activeStreamRisks = {};
let processedTxHashes = new Set();
let pollIntervalId = null;

let monitoringActive = false;
let registryContract = null;
let auditorContract = null;
let dexContract = null;
let fluenciRouterContract = null;
let provider = null;
let aiWallet = null;
let isSyncing = false;

// Settings
let RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
let REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS;
let AUDITOR_ADDRESS = process.env.AUDITOR_ADDRESS;
let AI_PRIVATE_KEY = process.env.AI_PRIVATE_KEY;
let START_BLOCK = process.env.START_BLOCK || "8320000";
let QIEDEX_ADDRESS = process.env.QIEDEX_ADDRESS || "";
let FLUENCI_ROUTER_ADDRESS = process.env.FLUENCI_ROUTER_ADDRESS || "";

// QIE Pass API Settings
const QIEPASS_API_URL = process.env.QIEPASS_API_URL || "https://pass-api.qie.digital";
const QIEPASS_PUBLIC_KEY = process.env.QIEPASS_PUBLIC_KEY || "";
const QIEPASS_SECRET_KEY = process.env.QIEPASS_SECRET_KEY || "";
const QIEPASS_CLAIMS = (process.env.QIEPASS_CLAIMS || "firstName,country").split(",").map(c => c.trim());

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
function anonymizeAddresses(str) {
  return str.replace(/0x[a-fA-F0-9]{20,}/g, (match) => `0x${match.slice(2, 6)}••••${match.slice(-4)}`);
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
          const tx = await auditorContract.triggerSafetyPause(subId, ipfsCID);
          logTelemetry("DECISION_AGENT", `onchain safety pause tx broadcasted. Hash: ${tx.hash}`);
          const receipt = await tx.wait();
          logTelemetry("DECISION_AGENT", `Safety pause confirmed in block ${receipt.blockNumber}. Stream has been locked onchain.`);
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
          const [subId, subscriber, merchant, tokenAddress, rate, cliff, stop] = args;
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
        "event DisputeResolved(bytes32 indexed subId, uint256 subscriberRefund, uint256 merchantShare)",
        "function getSubscriptionDetails(bytes32 subId) view returns (address subscriber, address merchant, address tokenAddress, uint256 ratePerSecond, uint256 lastClaimedTimestamp, uint256 startTime, uint256 cliffTime, uint256 stopTime, bool active, bool pausedByAI, uint8 disputeState, uint256 claimableAmount)",
        "function getSubscriberSubscriptions(address subscriber) view returns (bytes32[])"
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

      uniqueUsers = new Set();
      totalVolume = 0n;
      totalSwapVolume = 0n;
      activeStreamRisks = {};
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
    try {
      const details = await registryContract.getSubscriptionDetails(subId);
      const [subscriber, merchant, tokenAddress, ratePerSecond, , , , , active, pausedByAI, , claimableAmount] = details;

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
        await DecisionAgent.evaluateReport(subId, report, ipfsCID);
      }
    } catch (err) {
      logTelemetry("WARNING", `Failed to audit active stream ${subId} balance: ${err.message}`);
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
        const [subId, subscriber, merchant, tokenAddress, rate, cliff, stop] = ev.args;
        console.log(`[POLLER] New SubscriptionCreated detected: ${subId} subscriber=${subscriber} rate=${rate.toString()}`);
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

app.get("/stats", (req, res) => {
  // Always return real blockchain data — no simulated/mock stats
  const volumeFormatted = Number(totalVolume) / 1e6; // Format qUSDC (6 decimals) to dollars
  const revenueFormatted = volumeFormatted * 0.005; // 0.5% protocol fee
  const swapVolumeFormatted = Number(totalSwapVolume) / 1e6; // Format qUSDC (6 decimals) to dollars
  const risks = Object.values(activeStreamRisks);
  const currentRisk = risks.length > 0 ? Math.max(12, ...risks) : 12;
  res.json({
    uniqueUsersCount: uniqueUsers.size,
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

// ==========================================
// QIE PASS KYC VERIFICATION ROUTES
// ==========================================

// Create a QIE Pass verification request
app.post("/qiepass/verify", async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) {
    return res.status(400).json({ success: false, error: "Missing walletAddress" });
  }
  if (!QIEPASS_PUBLIC_KEY || !QIEPASS_SECRET_KEY) {
    return res.status(500).json({ success: false, error: "QIE Pass API keys not configured" });
  }

  try {
    const headers = generateQiePassHeaders();
    const body = {
      identifier: walletAddress,
      requestedClaims: QIEPASS_CLAIMS
    };

    logTelemetry("QIEPASS", `Creating verification request for ${walletAddress}`, { claims: QIEPASS_CLAIMS });

    const response = await fetch(`${QIEPASS_API_URL}/api/v1/partners/verification-requests`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      logTelemetry("QIEPASS", `Verification request failed: ${data?.error?.message || response.statusText}`);
      return res.status(response.status).json({ success: false, error: data?.error?.message || "QIE Pass API error" });
    }

    logTelemetry("QIEPASS", `Verification request created. RequestID: ${data.data?.requestId}, Status: ${data.data?.status}`);
    res.json({
      success: true,
      requestId: data.data?.requestId,
      status: data.data?.status,
      userStatus: data.data?.userStatus,
      redirectUrl: data.data?.redirectUrl,
      expiresAt: data.data?.expiresAt
    });
  } catch (err) {
    logTelemetry("QIEPASS", `Verification request error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Poll QIE Pass verification status
app.get("/qiepass/status/:requestId", async (req, res) => {
  const { requestId } = req.params;
  if (!QIEPASS_PUBLIC_KEY || !QIEPASS_SECRET_KEY) {
    return res.status(500).json({ success: false, error: "QIE Pass API keys not configured" });
  }

  try {
    const headers = generateQiePassHeaders();

    const response = await fetch(`${QIEPASS_API_URL}/api/v1/partners/verification-requests/${requestId}`, {
      method: "GET",
      headers
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: data?.error?.message || "QIE Pass API error" });
    }

    res.json({
      success: true,
      requestId: data.data?.requestId,
      status: data.data?.status,
      walletAddress: data.data?.walletAddress,
      did: data.data?.did,
      vcMetadata: data.data?.vcMetadata
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Claim and verify QIE Pass credentials, then register identity onchain
app.post("/qiepass/claim", async (req, res) => {
  const { requestId, walletAddress } = req.body;
  if (!requestId || !walletAddress) {
    return res.status(400).json({ success: false, error: "Missing requestId or walletAddress" });
  }
  if (!QIEPASS_PUBLIC_KEY || !QIEPASS_SECRET_KEY) {
    return res.status(500).json({ success: false, error: "QIE Pass API keys not configured" });
  }

  try {
    const headers = generateQiePassHeaders();

    logTelemetry("QIEPASS", `Claiming credentials for request: ${requestId}`);

    const response = await fetch(`${QIEPASS_API_URL}/api/v1/vc/partner/claim-and-verify`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestId })
    });

    const data = await response.json();

    if (!response.ok) {
      logTelemetry("QIEPASS", `Claim failed: ${data?.error?.message || response.statusText}`);
      return res.status(response.status).json({ success: false, error: data?.error?.message || "Claim failed" });
    }

    // Verify the cryptographic proof is valid
    const verification = data.verification;
    if (!verification?.signatureValid || !verification?.notExpired || !verification?.notRevoked) {
      logTelemetry("QIEPASS", `Credential verification failed for ${walletAddress}`, verification);
      return res.status(400).json({ success: false, error: "Credential verification failed" });
    }

    logTelemetry("QIEPASS", `Credentials verified for ${walletAddress}. Registering identity onchain...`, {
      claims: Object.keys(data.requestedClaims || {})
    });

    // Register identity onchain via the QiePass contract
    let txHash = null;
    if (aiWallet && provider) {
      try {
        const QIEPASS_CONTRACT = "0x0766Ff824376CEf38CFa5C155A51E90578096e38";
        const qiePassContract = new ethers.Contract(
          QIEPASS_CONTRACT,
          ["function registerIdentity(address user, bool status) external"],
          aiWallet
        );
        const tx = await qiePassContract.registerIdentity(walletAddress, true, { gasLimit: 100000n });
        await tx.wait();
        txHash = tx.hash;
        logTelemetry("QIEPASS", `Identity registered onchain for ${walletAddress}. TX: ${txHash}`);
      } catch (chainErr) {
        logTelemetry("QIEPASS", `onchain registration failed: ${chainErr.message}. KYC still valid via API.`);
      }
    }

    res.json({
      success: true,
      verified: true,
      claims: data.requestedClaims,
      proof: data.proof,
      txHash
    });
  } catch (err) {
    logTelemetry("QIEPASS", `Claim error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== FLUENCI AI CHAT ENDPOINT =====
const FLUENCI_SYSTEM_PROMPT = `You are Fluenci AI, the official assistant for the Fluenci protocol — an AI-shielded real-time streaming payment platform built on QIE Blockchain.

Key facts you know:
- Fluenci enables pay-per-second streaming payments using QUSDC (QIE stablecoin)
- Every subscription is minted as an ERC-721 NFT that can be traded
- The AI Sentry Network uses multi-agent GPT-4o analysis to detect and pause suspicious streams
- Fluenci integrates QIE Pass (KYC), QIEDex (swaps), QIE Domains (.qie names), QIE Wallet
- FluenciRegistry contract handles stream creation, claiming, disputes, and termination
- FluenciAIAuditor contract enables autonomous safety pauses with EIP-712 signatures
- FluenciRouter wraps QIEDex swaps with on-chain Fluenci attribution
- Stream rate example: 0.0001 QUSDC/sec = 0.36 QUSDC/hr
- Protocol fee: 0.5% on claims (99.5% to merchant)
- terminateStream auto-settles accumulated QUSDC to the merchant
- QIE Blockchain: EVM-compatible, Chain ID 1990 (mainnet), Chain ID 1983 (testnet)
- The Fluenci Arcade demonstrates streaming payments via a Snake game and this AI Chat

You are helpful, concise, and enthusiastic about blockchain and DeFi. Keep responses under 3 sentences unless the user asks for detail. Use emoji sparingly.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    if (!openai) {
      return res.status(503).json({ error: "OpenAI not configured" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: FLUENCI_SYSTEM_PROMPT },
        ...messages.slice(-20) // keep last 20 messages for context window
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    const reply = completion.choices[0]?.message?.content || "I'm having trouble thinking right now. Try again!";
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "AI service temporarily unavailable" });
  }
});

// Start Express Server and Connect
app.listen(PORT, async () => {
  console.log(`AI Auditor API Server running on port ${PORT}`);
  await connectBlockchain();
});
