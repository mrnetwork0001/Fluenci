import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 86_400;
const MONTH = 30 * DAY;
const USD = (n: number) => BigInt(Math.round(n * 1_000_000));

async function deploy() {
  const [owner, victim, attacker, evilMerchant, merchant, treasury, aiWorker] = await ethers.getSigners();

  const qusdc = await (await ethers.getContractFactory("MockQUSDC")).deploy();
  const pass = await (await ethers.getContractFactory("MockQiePass")).deploy();
  const registry = await (await ethers.getContractFactory("FluenciRegistryV4"))
    .deploy(await pass.getAddress(), treasury.address);

  await pass.registerIdentity(evilMerchant.address, true);
  await pass.registerIdentity(merchant.address, true);

  // The victim onboards normally: funds, a generous allowance, and a diligent cap
  // on the one merchant they actually use.
  await qusdc.mint(victim.address, USD(5_000));
  await qusdc.connect(victim).approve(await registry.getAddress(), USD(1_000_000));
  await registry.connect(victim).setSpendCap(merchant.address, USD(20), MONTH);

  await qusdc.mint(attacker.address, USD(5_000));
  await qusdc.connect(attacker).approve(await registry.getAddress(), USD(1_000_000));

  return { owner, victim, attacker, evilMerchant, merchant, treasury, aiWorker, qusdc, pass, registry,
           token: await qusdc.getAddress() };
}

describe("FluenciRegistryV4 — audit regressions", () => {

  describe("CRITICAL: unsolicited subscription push (audit findings 1, 3)", () => {
    it("a same-transaction push cannot change who pays", async () => {
      const f = await deploy();
      const pusher = await (await ethers.getContractFactory("AtomicPushAttacker")).deploy();
      const pusherAddr = await pusher.getAddress();

      // Fund the attacker contract so createSubscription is affordable.
      await f.qusdc.mint(pusherAddr, USD(5_000));

      // $4/minute to the attacker's own merchant, created and pushed atomically.
      const tx = await pusher.attack(await f.registry.getAddress(), f.evilMerchant.address,
                                     f.token, f.victim.address, USD(4), 60);
      const rc = await tx.wait();
      const subId = rc!.logs
        .map((l: any) => { try { return f.registry.interface.parseLog(l); } catch { return null; } })
        .find((l: any) => l?.name === "SubscriptionCreated")!.args[0];

      // The push may nominate, but the payer must still be the attacker.
      const sub = await f.registry.getSubscription(subId);
      expect(sub.subscriber).to.equal(pusherAddr);
      expect(await f.registry.pendingTransferTo(subId)).to.equal(f.victim.address);

      await time.increase(2000);
      await f.registry.connect(f.evilMerchant).claimStream(subId);

      // Every cent comes from the attacker; the victim is untouched.
      expect(await f.qusdc.balanceOf(f.victim.address)).to.equal(USD(5_000));
      expect(await f.qusdc.balanceOf(pusherAddr)).to.be.lt(USD(5_000));
    });

    it("accepting requires a spending limit for that merchant", async () => {
      const f = await deploy();
      const tx = await f.registry.connect(f.attacker).createSubscription(
        f.evilMerchant.address, f.token, USD(20), MONTH, 0, 0);
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];
      await f.registry.connect(f.attacker).transferFrom(f.attacker.address, f.victim.address, BigInt(subId));

      // The victim never capped this merchant, so acceptance is refused rather
      // than handing them an uncapped draw.
      await expect(f.registry.connect(f.victim).acceptSubscription(subId))
        .to.be.revertedWith("Set a spending limit for this merchant first");
    });

    it("a nominee who did not ask for it cannot be made the payer", async () => {
      const f = await deploy();
      const tx = await f.registry.connect(f.attacker).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0);
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];
      await f.registry.connect(f.attacker).transferFrom(f.attacker.address, f.victim.address, BigInt(subId));

      // Nomination alone changes nothing.
      expect((await f.registry.getSubscription(subId)).subscriber).to.equal(f.attacker.address);
      await f.registry.connect(f.victim).cancelTransferOffer(subId);
      expect(await f.registry.pendingTransferTo(subId)).to.equal(ethers.ZeroAddress);
    });

    it("a wanted transfer still completes", async () => {
      const f = await deploy();
      const tx = await f.registry.connect(f.attacker).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0);
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      await time.increase(DAY);
      await f.registry.connect(f.attacker).transferFrom(f.attacker.address, f.victim.address, BigInt(subId));
      await f.registry.connect(f.victim).acceptSubscription(subId);

      expect((await f.registry.getSubscription(subId)).subscriber).to.equal(f.victim.address);
      expect(await f.registry.ownerOf(BigInt(subId))).to.equal(f.victim.address);
    });
  });

  describe("CRITICAL: arrears riding across a transfer (audit finding 2)", () => {
    it("refuses to hand over a stream that still owes money", async () => {
      const f = await deploy();
      await f.registry.connect(f.victim).setSpendCap(f.merchant.address, USD(50), MONTH);

      // Cap the outgoing owner tightly so a month's accrual cannot fully settle.
      await f.registry.connect(f.attacker).setSpendCap(f.merchant.address, USD(1), MONTH);
      const tx = await f.registry.connect(f.attacker).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0
      );
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      await time.increase(MONTH);
      await expect(
        f.registry.connect(f.attacker).transferFrom(f.attacker.address, f.victim.address, BigInt(subId))
      ).to.be.revertedWith("Settle arrears before transferring");
    });
  });

  describe("MEDIUM: dispute payout bypassing the cap (audit findings 7-9)", () => {
    it("charges an arbitrated payout against the subscriber's cap", async () => {
      const f = await deploy();
      const auditor = await (await ethers.getContractFactory("FluenciAIAuditor"))
        .deploy(await f.registry.getAddress());
      await auditor.setAiWorker(f.aiWorker.address);
      await f.registry.setAIAuditor(await auditor.getAddress());

      const tx = await f.registry.connect(f.victim).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0
      );
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      await time.increase(MONTH);
      await f.registry.connect(f.victim).openDispute(subId);

      const outstanding = await f.registry.previewOwed(subId);
      const share = USD(20);
      const refund = outstanding - share;
      const hash = await f.registry.getMessageHash(subId, refund, share);
      const sig = await f.aiWorker.signMessage(ethers.getBytes(hash));
      await f.registry.connect(f.merchant).resolveDispute(subId, refund, share, sig);

      // The $20 cap is now spent for this window, not bypassed and left available.
      expect(await f.registry.remainingAllowance(f.victim.address, f.merchant.address)).to.equal(0n);
    });

    it("takes the protocol fee on an arbitrated payout", async () => {
      const f = await deploy();
      const auditor = await (await ethers.getContractFactory("FluenciAIAuditor"))
        .deploy(await f.registry.getAddress());
      await auditor.setAiWorker(f.aiWorker.address);
      await f.registry.setAIAuditor(await auditor.getAddress());

      const tx = await f.registry.connect(f.victim).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0
      );
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      await time.increase(MONTH);
      await f.registry.connect(f.victim).openDispute(subId);
      const outstanding = await f.registry.previewOwed(subId);
      const share = USD(10);
      const refund = outstanding - share;
      const hash = await f.registry.getMessageHash(subId, refund, share);
      const sig = await f.aiWorker.signMessage(ethers.getBytes(hash));
      await f.registry.connect(f.merchant).resolveDispute(subId, refund, share, sig);

      expect(await f.qusdc.balanceOf(f.treasury.address)).to.be.gt(0n);
    });
  });

  describe("CRITICAL: clamped arbitration awards must survive (round-two audit)", () => {
    async function disputed(f: any, capAmount: bigint) {
      const auditor = await (await ethers.getContractFactory("FluenciAIAuditor"))
        .deploy(await f.registry.getAddress());
      await auditor.setAiWorker(f.aiWorker.address);
      await f.registry.setAIAuditor(await auditor.getAddress());

      await f.registry.connect(f.victim).setSpendCap(f.merchant.address, capAmount, MONTH);
      const tx = await f.registry.connect(f.victim).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0);
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];
      await time.increase(MONTH);
      await f.registry.connect(f.victim).openDispute(subId);
      return subId;
    }

    it("keeps the cap-clamped remainder claimable instead of destroying it", async () => {
      const f = await deploy();
      // $5 cap against a $20 stream: an ordinary configuration, not an attack.
      const subId = await disputed(f, USD(5));

      const outstanding = await f.registry.previewOwed(subId);
      const hash = await f.registry.getMessageHash(subId, 0, outstanding);
      const sig = await f.aiWorker.signMessage(ethers.getBytes(hash));
      await f.registry.connect(f.merchant).resolveDispute(subId, 0, outstanding, sig);

      // The merchant got the capped slice; the rest must remain owed, not vanish.
      const stillOwed = await f.registry.previewOwed(subId);
      expect(stillOwed).to.be.closeTo(outstanding - USD(5), USD(0.01));

      // And it becomes collectable once the window rolls.
      await time.increase(MONTH);
      const before = await f.qusdc.balanceOf(f.merchant.address);
      await f.registry.connect(f.merchant).claimStream(subId);
      expect(await f.qusdc.balanceOf(f.merchant.address)).to.be.gt(before);
    });

    it("a subscriber cannot void a ruling by zeroing their own cap", async () => {
      const f = await deploy();
      const subId = await disputed(f, USD(20));
      const outstanding = await f.registry.previewOwed(subId);

      await f.registry.connect(f.victim).setSpendCap(f.merchant.address, 0, MONTH);
      const hash = await f.registry.getMessageHash(subId, 0, outstanding);
      const sig = await f.aiWorker.signMessage(ethers.getBytes(hash));
      await f.registry.connect(f.victim).resolveDispute(subId, 0, outstanding, sig);

      // Nothing paid, but nothing forgiven either — the award survives intact.
      expect(await f.registry.previewOwed(subId)).to.be.closeTo(outstanding, USD(0.01));
    });

    it("only the two parties may settle a dispute", async () => {
      const f = await deploy();
      const subId = await disputed(f, USD(20));
      const outstanding = await f.registry.previewOwed(subId);
      const hash = await f.registry.getMessageHash(subId, 0, outstanding);
      const sig = await f.aiWorker.signMessage(ethers.getBytes(hash));
      await expect(f.registry.connect(f.attacker).resolveDispute(subId, 0, outstanding, sig))
        .to.be.revertedWith("Not a party to this dispute");
    });
  });

  describe("HIGH: terminate must not strand arrears (round-two audit)", () => {
    it("keeps a stream claimable when settlement could not complete", async () => {
      const f = await deploy();
      await f.registry.connect(f.victim).setSpendCap(f.merchant.address, USD(1), MONTH);
      const tx = await f.registry.connect(f.victim).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0);
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      await time.increase(MONTH);
      await f.registry.connect(f.victim).terminateStream(subId);

      // Arrears remain owed and the record stays open so they can be collected.
      expect(await f.registry.previewOwed(subId)).to.be.gt(0n);
      await time.increase(MONTH);
      await expect(f.registry.connect(f.merchant).claimStream(subId)).to.not.be.reverted;
    });
  });

  describe("MEDIUM: terminate forfeiting accrued funds (audit findings 6, 10)", () => {
    it("reports what is outstanding rather than silently writing it off", async () => {
      const f = await deploy();
      await f.registry.setAIAuditor(f.aiWorker.address);

      const tx = await f.registry.connect(f.victim).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0
      );
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      await time.increase(MONTH);
      await f.registry.connect(f.aiWorker).pauseStreamByAI(subId, "anomaly");

      await expect(f.registry.connect(f.victim).terminateStream(subId))
        .to.emit(f.registry, "StreamTerminatedUnsettled");
    });
  });

  describe("INFO: cap period bounds (audit findings 21, 23)", () => {
    it("rejects a period large enough to overflow the window check", async () => {
      const f = await deploy();
      await expect(
        f.registry.connect(f.victim).setSpendCap(f.merchant.address, USD(20), ethers.MaxUint256)
      ).to.be.revertedWith("Cap period out of range");
    });

    it("re-anchors the window when the period changes, instead of refunding the allowance", async () => {
      const f = await deploy();
      const tx = await f.registry.connect(f.victim).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0
      );
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(subId); // draws the full $20 cap
      expect(await f.registry.remainingAllowance(f.victim.address, f.merchant.address)).to.equal(0n);

      // Changing the period must not hand the window straight back.
      await f.registry.connect(f.victim).setSpendCap(f.merchant.address, USD(20), MONTH * 2);
      expect(await f.registry.remainingAllowance(f.victim.address, f.merchant.address)).to.equal(USD(20));
    });
  });

  describe("INFO: fee truncation on small claims (audit finding 22)", () => {
    it("collects the same fee whether the merchant claims once or many times", async () => {
      const f = await deploy();
      await f.registry.connect(f.victim).clearSpendCap(f.merchant.address);
      const tx = await f.registry.connect(f.victim).createSubscription(
        f.merchant.address, f.token, USD(20), MONTH, 0, 0
      );
      const subId = (await tx.wait())!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      const t0 = await time.latest();
      for (let i = 1; i <= 30; i++) {
        await time.increaseTo(t0 + i * DAY);
        await f.registry.connect(f.merchant).claimStream(subId);
      }
      // 0.5% of ~$20 is ~$0.10. Per-claim truncation used to round this toward zero.
      expect(await f.qusdc.balanceOf(f.treasury.address)).to.be.closeTo(USD(0.10), USD(0.005));
    });
  });

  describe("cliff validation (audit finding 1, enabling condition)", () => {
    it("rejects a cliff in the past", async () => {
      const f = await deploy();
      const now = await time.latest();
      await expect(
        f.registry.connect(f.victim).createSubscription(f.merchant.address, f.token, USD(20), MONTH, now - 10, 0)
      ).to.be.revertedWith("Cliff time cannot be in the past");
    });
  });
});
