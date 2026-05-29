import { expect } from "chai";
import { ethers } from "hardhat";
import { MockQiePass, MockQUSD, QieFlowRegistry, QieFlowAIAuditor } from "../typechain-types";

describe("QieFlow Integration Test Suite", function () {
  let qiePass: MockQiePass;
  let qusd: MockQUSD;
  let registry: QieFlowRegistry;
  let auditor: QieFlowAIAuditor;
  
  let owner: any;
  let subscriber: any;
  let merchant: any;
  let aiWorker: any;

  const DECIMALS = 6;
  const RATE_PER_SECOND = 100; // 100 units of qUSD (e.g. 0.0001 qUSD/sec)

  beforeEach(async function () {
    [owner, subscriber, merchant, aiWorker] = await ethers.getSigners();

    // 1. Deploy Mock Qie Pass
    const MockQiePassFactory = await ethers.getContractFactory("MockQiePass");
    qiePass = await MockQiePassFactory.deploy() as MockQiePass;
    await qiePass.waitForDeployment();

    // 2. Deploy Mock Stablecoin (qUSD)
    const MockQUSDFactory = await ethers.getContractFactory("MockQUSD");
    qusd = await MockQUSDFactory.deploy() as MockQUSD;
    await qusd.waitForDeployment();

    // 3. Deploy Registry
    const QieFlowRegistryFactory = await ethers.getContractFactory("QieFlowRegistry");
    registry = await QieFlowRegistryFactory.deploy(
      await qiePass.getAddress(),
      await qusd.getAddress()
    ) as QieFlowRegistry;
    await registry.waitForDeployment();

    // 4. Deploy AI Auditor
    const QieFlowAIAuditorFactory = await ethers.getContractFactory("QieFlowAIAuditor");
    auditor = await QieFlowAIAuditorFactory.deploy(await registry.getAddress()) as QieFlowAIAuditor;
    await auditor.waitForDeployment();

    // 5. Connect Registry to AI Auditor
    await registry.setAIAuditor(await auditor.getAddress());

    // 6. Set AI worker address
    await auditor.setAiWorker(aiWorker.address);

    // 7. Mint initial stablecoins to subscriber
    const mintAmount = ethers.parseUnits("1000", DECIMALS);
    await qusd.mint(subscriber.address, mintAmount);
    
    // 8. Subscriber approves Registry to transfer their stablecoin
    await qusd.connect(subscriber).approve(await registry.getAddress(), ethers.MaxUint256);
  });

  describe("Deployment & Configuration", function () {
    it("Should set the correct registry variables", async function () {
      expect(await registry.qiePass()).to.equal(await qiePass.getAddress());
      expect(await registry.qieStableCoin()).to.equal(await qusd.getAddress());
      expect(await registry.aiAuditor()).to.equal(await auditor.getAddress());
    });

    it("Should set the correct AI worker in QieFlowAIAuditor", async function () {
      expect(await auditor.trustedAiWorker()).to.equal(aiWorker.address);
    });
  });

  describe("Subscription Stream Lifecycle", function () {
    it("Should fail to create a subscription if subscriber lacks QIE Pass identity", async function () {
      await expect(
        registry.connect(subscriber).createSubscription(merchant.address, RATE_PER_SECOND)
      ).to.be.revertedWith("Subscriber must have a verified QIE Pass");
    });

    it("Should succeed to create subscription after verifying QIE Pass identity", async function () {
      // Verify subscriber in mock QIE Pass
      await qiePass.registerIdentity(subscriber.address, true);

      const tx = await registry.connect(subscriber).createSubscription(merchant.address, RATE_PER_SECOND);
      await expect(tx).to.emit(registry, "SubscriptionCreated");

      // Verify lists are updated
      const subIds = await registry.getSubscriberSubscriptions(subscriber.address);
      expect(subIds.length).to.equal(1);
    });

    it("Should accumulate claimable funds and execute claim successfully", async function () {
      await qiePass.registerIdentity(subscriber.address, true);
      const tx = await registry.connect(subscriber).createSubscription(merchant.address, RATE_PER_SECOND);
      const receipt = await tx.wait();
      
      const subIds = await registry.getSubscriberSubscriptions(subscriber.address);
      const subId = subIds[0];

      // Time travel 10 seconds in the future
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);

      // Check details
      const details = await registry.getSubscriptionDetails(subId);
      // details[7] is claimableAmount
      expect(details[7]).to.be.greaterThanOrEqual(BigInt(RATE_PER_SECOND * 10));

      const subscriberBalanceBefore = await qusd.balanceOf(subscriber.address);
      const merchantBalanceBefore = await qusd.balanceOf(merchant.address);

      // Claim stream
      const claimTx = await registry.connect(merchant).claimStream(subId);
      await expect(claimTx).to.emit(registry, "FundsWithdrawn");

      const subscriberBalanceAfter = await qusd.balanceOf(subscriber.address);
      const merchantBalanceAfter = await qusd.balanceOf(merchant.address);

      // Verify correct amount of tokens transferred
      const expectedTransferred = subscriberBalanceBefore - subscriberBalanceAfter;
      expect(expectedTransferred).to.be.greaterThan(0n);
      expect(merchantBalanceAfter - merchantBalanceBefore).to.equal(expectedTransferred);
    });
  });

  describe("AI Safety Pause & Resumption", function () {
    let subId: string;

    beforeEach(async function () {
      await qiePass.registerIdentity(subscriber.address, true);
      await registry.connect(subscriber).createSubscription(merchant.address, RATE_PER_SECOND);
      const subIds = await registry.getSubscriberSubscriptions(subscriber.address);
      subId = subIds[0];
    });

    it("Should allow trusted AI worker to trigger safety pause", async function () {
      const tx = await auditor.connect(aiWorker).triggerSafetyPause(subId, "Pricing anomaly: double billing rate");
      await expect(tx).to.emit(registry, "StreamPaused").withArgs(subId, "Pricing anomaly: double billing rate");

      const details = await registry.getSubscriptionDetails(subId);
      expect(details[6]).to.be.true; // pausedByAI is true
    });

    it("Should prevent claims while stream is paused by AI Auditor", async function () {
      await auditor.connect(aiWorker).triggerSafetyPause(subId, "Anomaly alert");

      // Attempt to claim
      await expect(
        registry.connect(merchant).claimStream(subId)
      ).to.be.revertedWith("Stream is paused by AI Auditor due to anomaly");
    });

    it("Should fail if unauthorized account attempts to trigger safety pause", async function () {
      await expect(
        auditor.connect(subscriber).triggerSafetyPause(subId, "Anomaly alert")
      ).to.be.revertedWith("Only trusted AI worker");
    });

    it("Should allow subscriber to resume stream and claim again", async function () {
      await auditor.connect(aiWorker).triggerSafetyPause(subId, "Anomaly alert");

      // Resume stream
      const tx = await registry.connect(subscriber).resumeStream(subId);
      await expect(tx).to.emit(registry, "StreamResumed");

      const details = await registry.getSubscriptionDetails(subId);
      expect(details[6]).to.be.false; // pausedByAI is false

      // Increase time and verify claim works
      await ethers.provider.send("evm_increaseTime", [5]);
      await ethers.provider.send("evm_mine", []);

      await expect(
        registry.connect(merchant).claimStream(subId)
      ).to.not.be.reverted;
    });

    it("Should allow subscriber to terminate stream permanently", async function () {
      const tx = await registry.connect(subscriber).terminateStream(subId);
      await expect(tx).to.emit(registry, "StreamTerminated");

      const details = await registry.getSubscriptionDetails(subId);
      expect(details[5]).to.be.false; // active is false

      // Claims on terminated streams should fail
      await expect(
        registry.connect(merchant).claimStream(subId)
      ).to.be.revertedWith("Subscription is not active");
    });
  });
});
