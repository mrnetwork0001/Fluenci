import { expect } from "chai";
import { ethers } from "hardhat";
import { 
  MockQiePass, 
  MockQUSDC, 
  MockWETH, 
  FluenciRegistry, 
  FluenciAIAuditor, 
  MockQieDex, 
  MockQieDomain 
} from "../typechain-types";

describe("Fluenci Integration Test Suite", function () {
  let qiePass: MockQiePass;
  let qusdc: MockQUSDC;
  let weth: MockWETH;
  let registry: FluenciRegistry;
  let auditor: FluenciAIAuditor;
  let dex: MockQieDex;
  let domainRegistry: MockQieDomain;
  
  let owner: any;
  let subscriber: any;
  let merchant: any;
  let aiWorker: any;
  let buyer: any;

  const DECIMALS_USDC = 6;
  const DECIMALS_WETH = 18;
  const RATE_USDC = 100; // 100 units per second

  beforeEach(async function () {
    [owner, subscriber, merchant, aiWorker, buyer] = await ethers.getSigners();

    // 1. Deploy Mock Qie Pass
    const MockQiePassFactory = await ethers.getContractFactory("MockQiePass");
    qiePass = await MockQiePassFactory.deploy() as MockQiePass;
    await qiePass.waitForDeployment();

    // 2. Deploy Mock Stablecoin (qUSDC)
    const MockQUSDCFactory = await ethers.getContractFactory("MockQUSDC");
    qusdc = await MockQUSDCFactory.deploy() as MockQUSDC;
    await qusdc.waitForDeployment();

    // 3. Deploy Mock WETH
    const MockWETHFactory = await ethers.getContractFactory("MockWETH");
    weth = await MockWETHFactory.deploy() as MockWETH;
    await weth.waitForDeployment();

    // 4. Deploy Registry
    const FluenciRegistryFactory = await ethers.getContractFactory("FluenciRegistry");
    registry = await FluenciRegistryFactory.deploy(await qiePass.getAddress()) as FluenciRegistry;
    await registry.waitForDeployment();

    // 5. Deploy AI Auditor
    const FluenciAIAuditorFactory = await ethers.getContractFactory("FluenciAIAuditor");
    auditor = await FluenciAIAuditorFactory.deploy(await registry.getAddress()) as FluenciAIAuditor;
    await auditor.waitForDeployment();

    // 6. Connect Registry to AI Auditor
    await registry.setAIAuditor(await auditor.getAddress());

    // 7. Set AI worker address
    await auditor.setAiWorker(aiWorker.address);

    // 8. Deploy MockQieDex
    const MockQieDexFactory = await ethers.getContractFactory("MockQieDex");
    dex = await MockQieDexFactory.deploy(await qusdc.getAddress(), await weth.getAddress()) as MockQieDex;
    await dex.waitForDeployment();

    // 9. Deploy MockQieDomain
    const MockQieDomainFactory = await ethers.getContractFactory("MockQieDomain");
    domainRegistry = await MockQieDomainFactory.deploy() as MockQieDomain;
    await domainRegistry.waitForDeployment();

    // Mint initial tokens to subscriber
    await qusdc.mint(subscriber.address, ethers.parseUnits("1000", DECIMALS_USDC));
    await weth.mint(subscriber.address, ethers.parseUnits("10", DECIMALS_WETH));
    
    // Subscriber approves Registry to transfer their stablecoin/WETH
    await qusdc.connect(subscriber).approve(await registry.getAddress(), ethers.MaxUint256);
    await weth.connect(subscriber).approve(await registry.getAddress(), ethers.MaxUint256);

    // Verify subscriber in QIE Pass
    await qiePass.registerIdentity(subscriber.address, true);
    await qiePass.registerIdentity(buyer.address, true);
  });

  describe("Deployment & Configuration", function () {
    it("Should set correct configurations", async function () {
      expect(await registry.qiePass()).to.equal(await qiePass.getAddress());
      expect(await registry.aiAuditor()).to.equal(await auditor.getAddress());
      expect(await auditor.trustedAiWorker()).to.equal(aiWorker.address);
    });
  });

  describe("Multi-Token Streaming with Cliff & Stop Time", function () {
    it("Should create a subscription with qUSDC", async function () {
      const tx = await registry.connect(subscriber).createSubscription(
        merchant.address,
        await qusdc.getAddress(),
        RATE_USDC,
        0, // no cliff
        0  // no stop
      );
      await expect(tx).to.emit(registry, "SubscriptionCreated");
    });

    it("Should respect cliff timing restriction", async function () {
      const blockNum = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNum);
      const currentTime = block!.timestamp;
      const cliffTime = currentTime + 100; // cliff in 100 seconds

      const tx = await registry.connect(subscriber).createSubscription(
        merchant.address,
        await qusdc.getAddress(),
        RATE_USDC,
        cliffTime,
        0
      );
      const receipt = await tx.wait();
      
      const subIds = await registry.getSubscriberSubscriptions(subscriber.address);
      const subId = subIds[0];

      // Claim immediately should revert
      await expect(
        registry.connect(merchant).claimStream(subId)
      ).to.be.revertedWith("Vesting cliff not reached yet");

      // Increase time past cliff
      await ethers.provider.send("evm_increaseTime", [105]);
      await ethers.provider.send("evm_mine", []);

      // Claim should now succeed
      await expect(registry.connect(merchant).claimStream(subId)).to.emit(registry, "FundsWithdrawn");
    });

    it("Should stop accumulating after stopTime", async function () {
      const blockNum = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(blockNum);
      const currentTime = block!.timestamp;
      const stopTime = currentTime + 50; // stop in 50 seconds

      await registry.connect(subscriber).createSubscription(
        merchant.address,
        await qusdc.getAddress(),
        RATE_USDC,
        0,
        stopTime
      );
      
      const subIds = await registry.getSubscriberSubscriptions(subscriber.address);
      const subId = subIds[0];

      // Time travel past stopTime
      await ethers.provider.send("evm_increaseTime", [100]);
      await ethers.provider.send("evm_mine", []);

      // Claim stream
      const tx = await registry.connect(merchant).claimStream(subId);
      await expect(tx).to.emit(registry, "StreamTerminated").withArgs(subId);

      const details = await registry.getSubscriptionDetails(subId);
      expect(details[8]).to.be.false; // active is false
    });
  });

  describe("Option A: AI dispute resolution", function () {
    it("Should allow subscriber to open a dispute and AI to sign arbitration", async function () {
      await registry.connect(subscriber).createSubscription(
        merchant.address,
        await qusdc.getAddress(),
        RATE_USDC,
        0,
        0
      );
      const subIds = await registry.getSubscriberSubscriptions(subscriber.address);
      const subId = subIds[0];

      // Accrue 10 seconds of streaming
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine", []);

      // Open dispute
      await expect(registry.connect(subscriber).openDispute(subId))
        .to.emit(registry, "DisputeOpened")
        .withArgs(subId, subscriber.address);

      // AI arbitrates: total accrued is 1000 units. AI rules that 400 goes to merchant, 600 refunded.
      const subscriberRefund = 600;
      const merchantShare = 400;

      const hash = await registry.getMessageHash(subId, subscriberRefund, merchantShare);
      const signature = await aiWorker.signMessage(ethers.getBytes(hash));

      const balanceBefore = await qusdc.balanceOf(merchant.address);

      // Resolve dispute
      const tx = await registry.resolveDispute(subId, subscriberRefund, merchantShare, signature);
      await expect(tx).to.emit(registry, "DisputeResolved").withArgs(subId, subscriberRefund, merchantShare);

      const balanceAfter = await qusdc.balanceOf(merchant.address);
      expect(balanceAfter - balanceBefore).to.equal(merchantShare);
    });
  });

  describe("Option B: NFT Subscription Transfers", function () {
    it("Should permit transferring a subscription NFT to change the subscriber", async function () {
      await registry.connect(subscriber).createSubscription(
        merchant.address,
        await qusdc.getAddress(),
        RATE_USDC,
        0,
        0
      );
      const subIds = await registry.getSubscriberSubscriptions(subscriber.address);
      const subId = subIds[0];
      const tokenId = BigInt(subId);

      expect(await registry.ownerOf(tokenId)).to.equal(subscriber.address);

      // Transfer NFT to buyer
      await registry.connect(subscriber).transferFrom(subscriber.address, buyer.address, tokenId);

      // Check new owner
      expect(await registry.ownerOf(tokenId)).to.equal(buyer.address);

      const details = await registry.getSubscriptionDetails(subId);
      expect(details[0]).to.equal(buyer.address); // subscriber is now buyer
    });
  });

  describe("QIE Ecosystem Integrations: DEX and Domains", function () {
    it("Should swap native QIE for qUSDC using MockQieDex", async function () {
      const swapVal = ethers.parseEther("10"); // 10 QIE
      const rate = await dex.ratePerQie(await qusdc.getAddress()); // 2
      // 10 QIE * 2 = 20 qUSDC (since decimals matches)
      
      const balanceBefore = await qusdc.balanceOf(subscriber.address);
      await dex.connect(subscriber).swapQieForTokens(await qusdc.getAddress(), { value: swapVal });
      const balanceAfter = await qusdc.balanceOf(subscriber.address);
      
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseUnits("20", DECIMALS_USDC));
    });

    it("Should register and resolve .qie domains correctly", async function () {
      await domainRegistry.registerDomain("netflix.qie", merchant.address);
      expect(await domainRegistry.resolveDomain("netflix.qie")).to.equal(merchant.address);
      expect(await domainRegistry.lookupAddress(merchant.address)).to.equal("netflix.qie");
    });
  });
});
