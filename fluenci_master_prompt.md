# Fluenci — Master Build Prompt
## AI-Shielded Recurring Payments & Subscription Streams on QIE Blockchain

> **Hackathon:** QIE Blockchain Hackathon 2026
> **Submission Deadline:** June 19, 2026 (23:59 UTC)
> **Building Phase Ends:** June 14, 2026
> **Target Track:** AI + Web3  /  DeFi & Payments
> **Deployment:** QIE Testnet (Chain ID: 1983)

---

## 🚨 CRITICAL: Hackathon Rules & MOAT Strategy

To win, the project must strictly follow the hackathon rules and optimize for judge evaluation:
1. **Original Codebase:** Do NOT copy-paste code from prior projects (like StonMaster or FlowShield) directly. Write this clean repository from scratch.
2. **QIE Component Integration (Bonus Points):** 
   * **QIE Pass:** Gated registration where merchants and subscribers verify their DIDs.
   * **QIE Stable Coin (qUSD):** Settles payments to prevent volatility.
   * **QIE Wallet:** Interacts with MetaMask utilizing the custom testnet RPC.
3. **The Moat:** Most payment streams execute blindly. Fluenci is unique because it integrates an **autonomous AI Auditor Agent** that actively flags fee changes or anomalies and triggers a contract-level stream pause, which can only be unlocked via a verified **QIE Pass** signature.

---

## 🏗️ Architecture Overview

```
Subscriber (Verify via QIE Pass)
        │
        ├──[FluenciRegistry.sol]   ← Manages subscriptions & streams (settles in qUSD)
        │       │
        │       ├── ratePerSecond  (Streaming rate, e.g., scaled by 1e6)
        │       ├── active         (Subscription status)
        │       └── pausedByAI     (Safety pause triggered by AI Auditor)
        │
        ├──[FluenciAIAuditor.sol]  ← Oracle interface: AI agent registers anomalies
        │
        └──[MockQUSD.sol]          ← Test stablecoin (qUSD) for streaming settlements

React Frontend:
  ├── Subscriber Panel   → View active streams, wallet balance, and AI security logs
  ├── Merchant Dashboard → Register business DID, track incoming flows, request payouts
  └── AI Security Desk   → Displays real-time transaction telemetry & audit decisions
```

---

## 📁 Folder Structure

```
qieflow/
├── contracts/                         # Hardhat project
│   ├── hardhat.config.ts
│   ├── package.json
│   ├── contracts/
│   │   ├── FluenciRegistry.sol        # ⭐ Core: subscription registers & streams
│   │   ├── FluenciAIAuditor.sol       # Oracle gate for AI pauses
│   │   └── MockQUSD.sol               # Mock stablecoin for testnet
│   ├── scripts/
│   │   └── deploy.ts                  # Hardhat deployment script
│   └── test/
│       └── Fluenci.test.ts            # Integration test suite
│
└── frontend/                          # Vite + React App
    ├── package.json
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   │   ├── SubscriberPanel.jsx    # Manage streams & approve updates
    │   │   ├── MerchantDashboard.jsx  # Register company and track income
    │   │   ├── AISecurityDesk.jsx     # AI logging, anomaly flags
    │   │   └── ConnectWallet.jsx      # MetaMask integration (QIE Testnet)
    │   └── hooks/
    │       └── useFluenci.js          # Web3 integration hooks
```

---

## 📝 Smart Contract Implementation

### Contract 1: `FluenciRegistry.sol`
*Manages payment streams, merchant registries, and verification gates.*

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IQiePass {
    function verifyIdentity(address user) external view returns (bool);
}

contract FluenciRegistry {
    address public owner;
    address public qiePass;
    address public qieStableCoin;
    address public aiAuditor;

    struct Subscription {
        address subscriber;
        address merchant;
        uint256 ratePerSecond;        // Tokens scaled by 1e6 per second
        uint256 lastClaimedTimestamp;
        uint256 startTime;
        bool active;
        bool pausedByAI;
    }

    mapping(bytes32 => Subscription) public subscriptions;
    mapping(address => bytes32[]) public subscriberSubscriptions;
    mapping(address => bytes32[]) public merchantSubscriptions;

    event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, address indexed merchant, uint256 ratePerSecond);
    event StreamPaused(bytes32 indexed subId, string reason);
    event StreamResumed(bytes32 indexed subId);
    event StreamTerminated(bytes32 indexed subId);
    event FundsWithdrawn(bytes32 indexed subId, address indexed merchant, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlySubscriber(bytes32 subId) {
        require(subscriptions[subId].subscriber == msg.sender, "Only subscriber");
        _;
    }

    modifier onlyAuditor() {
        require(msg.sender == aiAuditor, "Only AI Auditor");
        _;
    }

    constructor(address _qiePass, address _qieStableCoin) {
        owner = msg.sender;
        qiePass = _qiePass;
        qieStableCoin = _qieStableCoin;
    }

    function setAIAuditor(address _aiAuditor) external onlyOwner {
        aiAuditor = _aiAuditor;
    }

    /**
     * @notice Create a subscription stream. Requires subscriber to have a verified QIE Pass.
     */
    function createSubscription(
        address merchant,
        uint256 ratePerSecond
    ) external returns (bytes32 subId) {
        // Gated by QIE Pass (Bonus points indicator)
        require(IQiePass(qiePass).verifyIdentity(msg.sender), "Subscriber must have a verified QIE Pass");
        require(merchant != address(0), "Invalid merchant address");
        require(ratePerSecond > 0, "Rate must be greater than zero");

        subId = keccak256(abi.encodePacked(msg.sender, merchant, block.timestamp));
        
        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            merchant: merchant,
            ratePerSecond: ratePerSecond,
            lastClaimedTimestamp: block.timestamp,
            startTime: block.timestamp,
            active: true,
            pausedByAI: false
        });

        subscriberSubscriptions[msg.sender].push(subId);
        merchantSubscriptions[merchant].push(subId);

        emit SubscriptionCreated(subId, msg.sender, merchant, ratePerSecond);
    }

    /**
     * @notice Merchant claims accumulated subscription streams.
     */
    function claimStream(bytes32 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Subscription is not active");
        require(!sub.pausedByAI, "Stream is paused by AI Auditor due to anomaly");

        uint256 claimableDuration = block.timestamp - sub.lastClaimedTimestamp;
        require(claimableDuration > 0, "Nothing to claim yet");

        uint256 claimableAmount = claimableDuration * sub.ratePerSecond;
        sub.lastClaimedTimestamp = block.timestamp;

        // Perform settlement in stablecoin (qUSD)
        require(
            IERC20(qieStableCoin).transferFrom(sub.subscriber, sub.merchant, claimableAmount),
            "Payment transfer failed"
        );

        emit FundsWithdrawn(subId, sub.merchant, claimableAmount);
    }

    /**
     * @notice AI Auditor pauses the stream upon detecting billing anomalies.
     */
    function pauseStreamByAI(bytes32 subId, string calldata reason) external onlyAuditor {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Stream not active");
        require(!sub.pausedByAI, "Already paused");

        sub.pausedByAI = true;
        emit StreamPaused(subId, reason);
    }

    /**
     * @notice Subscriber resolves issues and resumes the stream using their QIE Pass signature.
     */
    function resumeStream(bytes32 subId) external onlySubscriber(subId) {
        require(IQiePass(qiePass).verifyIdentity(msg.sender), "Subscriber must hold verified QIE Pass");
        Subscription storage sub = subscriptions[subId];
        require(sub.pausedByAI, "Stream not paused by AI");

        sub.pausedByAI = false;
        sub.lastClaimedTimestamp = block.timestamp; // Reset timer to prevent double-claiming during paused gap

        emit StreamResumed(subId);
    }

    /**
     * @notice Subscriber terminates a subscription stream permanently.
     */
    function terminateStream(bytes32 subId) external onlySubscriber(subId) {
        Subscription storage sub = subscriptions[subId];
        sub.active = false;
        emit StreamTerminated(subId);
    }
}
```

---

### Contract 2: `FluenciAIAuditor.sol`
*Defines registry metrics for the offchain AI transaction verification worker.*

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFluenciRegistry {
    function pauseStreamByAI(bytes32 subId, string calldata reason) external;
}

contract FluenciAIAuditor {
    address public owner;
    address public fluenciRegistry;
    address public trustedAiWorker;

    event AnomalyReported(bytes32 indexed subId, string reason, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAiWorker() {
        require(msg.sender == trustedAiWorker, "Only trusted AI worker");
        _;
    }

    constructor(address _registry) {
        owner = msg.sender;
        fluenciRegistry = _registry;
    }

    function setAiWorker(address _worker) external onlyOwner {
        trustedAiWorker = _worker;
    }

    /**
     * @notice AI worker reports a billing anomaly and pauses the corresponding stream.
     */
    function triggerSafetyPause(bytes32 subId, string calldata reason) external onlyAiWorker {
        IFluenciRegistry(fluenciRegistry).pauseStreamByAI(subId, reason);
        emit AnomalyReported(subId, reason, block.timestamp);
    }
}
```

---

### Contract 3: `MockQUSD.sol`
*Test stablecoin to represent the QIE Stable Coin (qUSD) in hardhat local and testnet tasks.*

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockQUSD {
    string public name = "Mock QIE Stable Coin";
    string public symbol = "qUSD";
    uint8 public decimals = 6;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        _mint(msg.sender, 1_000_000 * 10**decimals);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        if (allowance[sender][msg.sender] != type(uint256).max) {
            allowance[sender][msg.sender] -= amount;
        }
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
```

---

## ⚙️ Testnet Setup & Deployment Instructions

### 1. MetaMask Configuration
Connect to the **QIE Testnet** using MetaMask:
* **Network Name:** QIE Testnet
* **New RPC URL:** `https://rpc1testnet.qie.digital/`
* **Chain ID:** `1983`
* **Currency Symbol:** `QIE`
* **Block Explorer:** `https://testnet.qie.digital/`

### 2. Hardhat Network Configuration
Inside `contracts/hardhat.config.ts`, define the QIE testnet parameters:

```typescript
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    qieTestnet: {
      url: "https://rpc1testnet.qie.digital/",
      chainId: 1983,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    }
  }
};

export default config;
```

### 3. Deployment Script
Inside `contracts/scripts/deploy.ts`:

```typescript
import { ethers } from "hardhat";

async function main() {
  // 1. Deploy Mock Qie Pass (Mocking the L1 registry for local testing)
  const MockQiePass = await ethers.getContractFactory("MockQiePass");
  const qiePass = await MockQiePass.deploy();
  await qiePass.waitForDeployment();
  console.log(`MockQiePass deployed to: ${await qiePass.getAddress()}`);

  // 2. Deploy Mock Stablecoin (qUSD)
  const MockQUSD = await ethers.getContractFactory("MockQUSD");
  const qusd = await MockQUSD.deploy();
  await qusd.waitForDeployment();
  console.log(`MockQUSD deployed to: ${await qusd.getAddress()}`);

  // 3. Deploy Registry
  const FluenciRegistry = await ethers.getContractFactory("FluenciRegistry");
  const registry = await FluenciRegistry.deploy(await qiePass.getAddress(), await qusd.getAddress());
  await registry.waitForDeployment();
  console.log(`FluenciRegistry deployed to: ${await registry.getAddress()}`);

  // 4. Deploy AI Auditor
  const FluenciAIAuditor = await ethers.getContractFactory("FluenciAIAuditor");
  const auditor = await FluenciAIAuditor.deploy(await registry.getAddress());
  await auditor.waitForDeployment();
  console.log(`FluenciAIAuditor deployed to: ${await auditor.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

---

## 🤖 AI Auditor Worker Script (offchain Node Service)
Create a quick Node.js script inside a `/server` folder to act as the AI audit router.

```javascript
const { ethers } = require("ethers");
const axios = require("axios");

// Setup provider & AI wallet
const provider = new ethers.JsonRpcProvider("https://rpc1testnet.qie.digital/");
const aiWallet = new ethers.Wallet(process.env.AI_PRIVATE_KEY, provider);

const REGISTRY_ADDRESS = "0xRegistryAddressHere";
const AUDITOR_ADDRESS = "0xAuditorAddressHere";

async function monitorTelemetry() {
  console.log("AI Auditor Online. Monitoring QIE Testnet transactions...");
  
  // Listen to Stream Created Events
  const registryContract = new ethers.Contract(REGISTRY_ADDRESS, [
    "event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, address indexed merchant, uint256 ratePerSecond)"
  ], provider);

  registryContract.on("SubscriptionCreated", async (subId, subscriber, merchant, rate, event) => {
    console.log(`Checking subscription: ${subId}`);

    // Query OpenAI / Local LLM logic for billing compliance analysis
    const isCompliant = await auditMerchantPricing(merchant, rate);
    
    if (!isCompliant) {
      console.warn(`Anomaly detected for merchant: ${merchant}. Triggering safety pause...`);
      const auditorContract = new ethers.Contract(AUDITOR_ADDRESS, [
        "function triggerSafetyPause(bytes32 subId, string calldata reason) external"
      ], aiWallet);
      
      const tx = await auditorContract.triggerSafetyPause(subId, "Pricing anomaly: monthly rate changed without subscriber DID consent");
      await tx.wait();
      console.log(`Paused stream ${subId} successfully.`);
    }
  });
}

async function auditMerchantPricing(merchant, rate) {
  // Simple AI audit verification logic:
  // Decoupled offchain analyzer comparing active rate against baseline index database
  return true; // Return false if flagged
}

monitorTelemetry();
```
