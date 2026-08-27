import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 86_400;
const MONTH = 30 * DAY;
const USD = (n: number) => BigInt(Math.round(n * 1_000_000)); // qUSDC has 6 decimals

// Gate enum in FluenciRegistryV4
const OPEN = 0, QIE_ID = 1, QIE_PASS = 2, MIN_REPUTATION = 3;

async function deploy() {
  const [owner, subscriber, merchant, treasury, aiWorker, other] = await ethers.getSigners();

  const qusdc = await (await ethers.getContractFactory("MockQUSDC")).deploy();
  const pass = await (await ethers.getContractFactory("MockQiePass")).deploy();
  const rep = await (await ethers.getContractFactory("MockQieReputation")).deploy();
  const qid = await (await ethers.getContractFactory("MockQieIdentity")).deploy();

  const registry = await (await ethers.getContractFactory("FluenciRegistryV4"))
    .deploy(await pass.getAddress(), treasury.address);

  await registry.setQieReputation(await rep.getAddress());
  await registry.setQieIdentity(await qid.getAddress());

  // Merchant needs a Pass to withdraw (progressive KYC is on by default).
  await pass.registerIdentity(merchant.address, true);

  // Fund the subscriber and let the registry pull.
  await qusdc.mint(subscriber.address, USD(10_000));
  await qusdc.connect(subscriber).approve(await registry.getAddress(), USD(1_000_000));

  return { owner, subscriber, merchant, treasury, aiWorker, other, qusdc, pass, rep, qid, registry,
           qusdcAddress: await qusdc.getAddress() };
}

function subTx(f: any, amount = USD(20), period = MONTH, cliff = 0, stop = 0) {
  return f.registry.connect(f.subscriber).createSubscription(
    f.merchant.address, f.qusdcAddress, amount, period, cliff, stop
  );
}

async function openSub(f: any, amount = USD(20), period = MONTH, cliff = 0, stop = 0) {
  const tx = await f.registry.connect(f.subscriber).createSubscription(
    f.merchant.address, await f.qusdc.getAddress(), amount, period, cliff, stop
  );
  const rc = await tx.wait();
  const ev = rc!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated");
  return ev!.args[0] as string;
}

describe("FluenciRegistryV4", () => {

  describe("period-based pricing (the v3 rounding bug)", () => {
    it("bills $20/month exactly over a month, not $18.14", async () => {
      const f = await deploy();
      const subId = await openSub(f);

      await time.increase(MONTH);
      const before = await f.qusdc.balanceOf(f.merchant.address);
      await f.registry.connect(f.merchant).claimStream(subId);
      const gained = await f.qusdc.balanceOf(f.merchant.address) - before;

      // $20 minus the 0.5% protocol fee, allowing for the extra block-second.
      expect(gained).to.be.closeTo(USD(20) - USD(20) * 50n / 10000n, USD(0.001));
    });

    it("supports $1/month, which reverted outright in v3", async () => {
      const f = await deploy();
      const subId = await openSub(f, USD(1), MONTH);
      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(subId);
      expect(await f.registry.previewOwed(subId)).to.equal(0n);
    });

    it("pays the same whether the merchant claims once or 30 times", async () => {
      const f1 = await deploy();
      const lazy = await openSub(f1);
      const t0 = await time.latest();
      await time.increaseTo(t0 + MONTH);
      await f1.registry.connect(f1.merchant).claimStream(lazy);
      const lazyTotal = await f1.qusdc.balanceOf(f1.merchant.address);

      const f2 = await deploy();
      const eager = await openSub(f2);
      const t1 = await time.latest();
      for (let i = 1; i <= 30; i++) {
        await time.increaseTo(t1 + i * DAY);
        await f2.registry.connect(f2.merchant).claimStream(eager);
      }
      const eagerTotal = await f2.qusdc.balanceOf(f2.merchant.address);

      // v3 lost ~9% here to per-claim truncation. Under v4 the two must agree
      // to within a few units of dust, and frequent claiming must never pay less.
      expect(eagerTotal).to.be.closeTo(lazyTotal, 60n);
      expect(eagerTotal).to.be.gte(lazyTotal - 60n);
    });

    it("rejects a zero amount or zero period", async () => {
      const f = await deploy();
      const token = await f.qusdc.getAddress();
      await expect(
        f.registry.connect(f.subscriber).createSubscription(f.merchant.address, token, 0, MONTH, 0, 0)
      ).to.be.revertedWith("Amount must be greater than zero");
      await expect(
        f.registry.connect(f.subscriber).createSubscription(f.merchant.address, token, USD(20), 0, 0, 0)
      ).to.be.revertedWith("Period out of range");
    });
  });

  describe("merchant spending caps", () => {
    it("clamps a claim to the cap and leaves the remainder accrued", async () => {
      const f = await deploy();
      await f.registry.connect(f.subscriber).setSpendCap(f.merchant.address, USD(5), MONTH);
      const subId = await openSub(f, USD(20), MONTH);

      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(subId);

      const paid = await f.qusdc.balanceOf(f.merchant.address);
      expect(paid).to.equal(USD(5) - USD(5) * 50n / 10000n); // capped at $5, less fee
      expect(await f.registry.previewOwed(subId)).to.be.closeTo(USD(15), 10n); // $15 still owed
    });

    it("refuses to pay past the cap within the same window", async () => {
      const f = await deploy();
      await f.registry.connect(f.subscriber).setSpendCap(f.merchant.address, USD(5), MONTH);
      const subId = await openSub(f);
      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(subId);

      await time.increase(DAY);
      await expect(f.registry.connect(f.merchant).claimStream(subId))
        .to.be.revertedWith("Nothing claimable (or spending cap reached)");
    });

    it("lets the merchant draw again once the window rolls over", async () => {
      const f = await deploy();
      await f.registry.connect(f.subscriber).setSpendCap(f.merchant.address, USD(5), MONTH);
      const subId = await openSub(f);
      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(subId);

      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(subId);
      expect(await f.qusdc.balanceOf(f.merchant.address))
        .to.equal((USD(5) - USD(5) * 50n / 10000n) * 2n);
    });

    it("caps one merchant without affecting another", async () => {
      const f = await deploy();
      await f.pass.registerIdentity(f.other.address, true);
      await f.registry.connect(f.subscriber).setSpendCap(f.merchant.address, USD(5), MONTH);

      const capped = await openSub(f);
      const tx = await f.registry.connect(f.subscriber).createSubscription(
        f.other.address, await f.qusdc.getAddress(), USD(20), MONTH, 0, 0
      );
      const rc = await tx.wait();
      const uncapped = rc!.logs.find((l: any) => l.fragment?.name === "SubscriptionCreated")!.args[0];

      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(capped);
      await f.registry.connect(f.other).claimStream(uncapped);

      expect(await f.qusdc.balanceOf(f.merchant.address)).to.equal(USD(5) - USD(5) * 50n / 10000n);
      expect(await f.qusdc.balanceOf(f.other.address)).to.be.closeTo(USD(20) - USD(20) * 50n / 10000n, USD(0.001));
    });

    it("only the subscriber can change their own cap", async () => {
      const f = await deploy();
      await f.registry.connect(f.merchant).setSpendCap(f.merchant.address, USD(9999), MONTH);
      // The merchant only ever edits its own outbound cap, never the subscriber's.
      expect(await f.registry.remainingAllowance(f.subscriber.address, f.merchant.address))
        .to.equal(ethers.MaxUint256);
    });

    it("a zero cap blocks the merchant entirely", async () => {
      const f = await deploy();
      await f.registry.connect(f.subscriber).setSpendCap(f.merchant.address, 0, MONTH);
      const subId = await openSub(f);
      await time.increase(MONTH);
      await expect(f.registry.connect(f.merchant).claimStream(subId))
        .to.be.revertedWith("Nothing claimable (or spending cap reached)");
    });
  });

  describe("merchant-configurable gating", () => {
    it("is OPEN by default, so no KYC is needed to subscribe", async () => {
      const f = await deploy();
      await expect(subTx(f)).to.not.be.reverted;
    });

    it("enforces QIE Pass when the merchant requires it", async () => {
      const f = await deploy();
      await f.registry.connect(f.merchant).setMerchantPolicy(QIE_PASS, 0);
      await expect(subTx(f)).to.be.revertedWith("Subscriber does not meet merchant policy");

      await f.pass.registerIdentity(f.subscriber.address, true);
      await expect(subTx(f)).to.not.be.reverted;
    });

    it("enforces a minimum reputation score", async () => {
      const f = await deploy();
      await f.registry.connect(f.merchant).setMerchantPolicy(MIN_REPUTATION, 700);

      await f.rep.setScore(f.subscriber.address, 699);
      await expect(subTx(f)).to.be.revertedWith("Subscriber does not meet merchant policy");

      await f.rep.setScore(f.subscriber.address, 700);
      await expect(subTx(f)).to.not.be.reverted;
    });

    it("enforces QIE ID when required", async () => {
      const f = await deploy();
      await f.registry.connect(f.merchant).setMerchantPolicy(QIE_ID, 0);
      await expect(subTx(f)).to.be.revertedWith("Subscriber does not meet merchant policy");

      await f.qid.setIdentity(f.subscriber.address, true);
      await expect(subTx(f)).to.not.be.reverted;
    });

    it("fails closed if the reputation adapter reverts", async () => {
      const f = await deploy();
      const broken = await (await ethers.getContractFactory("RevertingReputation")).deploy();
      await f.registry.setQieReputation(await broken.getAddress());
      await f.registry.connect(f.merchant).setMerchantPolicy(MIN_REPUTATION, 1);
      await expect(subTx(f)).to.be.revertedWith("Subscriber does not meet merchant policy");
    });

    it("fails closed if the adapter was never configured", async () => {
      const f = await deploy();
      await f.registry.setQieReputation(ethers.ZeroAddress);
      await f.registry.connect(f.merchant).setMerchantPolicy(MIN_REPUTATION, 1);
      await expect(subTx(f)).to.be.revertedWith("Reputation adapter not configured");
    });
  });

  describe("fee split", () => {
    it("routes 0.5% to the treasury and the rest to the merchant", async () => {
      const f = await deploy();
      const subId = await openSub(f);
      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(subId);

      const fee = USD(20) * 50n / 10000n;
      expect(await f.qusdc.balanceOf(f.treasury.address)).to.be.closeTo(fee, USD(0.001));
      expect(await f.qusdc.balanceOf(f.merchant.address)).to.be.closeTo(USD(20) - fee, USD(0.001));
    });

    it("will not let the owner set a fee above 5%", async () => {
      const f = await deploy();
      await expect(f.registry.setProtocolFeeBps(501)).to.be.revertedWith("Fee cannot exceed 5%");
    });
  });

  describe("pause, resume and disputes", () => {
    it("does not bill for time spent paused", async () => {
      const f = await deploy();
      await f.registry.setAIAuditor(f.aiWorker.address);
      const subId = await openSub(f);

      await time.increase(MONTH / 2);
      await f.registry.connect(f.aiWorker).pauseStreamByAI(subId, "anomaly");
      await time.increase(MONTH);            // paused: must not accrue
      await f.registry.connect(f.subscriber).resumeStream(subId);
      await time.increase(MONTH / 2);

      await f.registry.connect(f.merchant).claimStream(subId);
      // Two half-months billed, the paused month skipped.
      expect(await f.qusdc.balanceOf(f.merchant.address))
        .to.be.closeTo(USD(20) - USD(20) * 50n / 10000n, USD(0.01));
    });

    it("blocks claiming while a dispute is open", async () => {
      const f = await deploy();
      const subId = await openSub(f);
      await time.increase(MONTH);
      await f.registry.connect(f.subscriber).openDispute(subId);
      await expect(f.registry.connect(f.merchant).claimStream(subId))
        .to.be.revertedWith("Stream is currently disputed");
    });
  });

  describe("lifecycle", () => {
    it("auto-settles on terminate", async () => {
      const f = await deploy();
      const subId = await openSub(f);
      await time.increase(MONTH);
      await f.registry.connect(f.subscriber).terminateStream(subId);
      expect(await f.qusdc.balanceOf(f.merchant.address))
        .to.be.closeTo(USD(20) - USD(20) * 50n / 10000n, USD(0.01));
    });

    it("blocks payout until the cliff, then pays the full accrual", async () => {
      const f = await deploy();
      const now = await time.latest();
      const subId = await openSub(f, USD(20), MONTH, now + MONTH, 0);

      await time.increase(MONTH / 2);
      await expect(f.registry.connect(f.merchant).claimStream(subId))
        .to.be.revertedWith("Vesting cliff not reached yet");

      await time.increase(MONTH);
      await f.registry.connect(f.merchant).claimStream(subId);
      // Accrual runs through the cliff; only the payout was deferred.
      expect(await f.qusdc.balanceOf(f.merchant.address)).to.be.gt(USD(20));
    });

    it("stops billing at stopTime", async () => {
      const f = await deploy();
      const now = await time.latest();
      const subId = await openSub(f, USD(20), MONTH, 0, now + MONTH);

      await time.increase(MONTH * 3);
      await f.registry.connect(f.merchant).claimStream(subId);
      expect(await f.qusdc.balanceOf(f.merchant.address))
        .to.be.closeTo(USD(20) - USD(20) * 50n / 10000n, USD(0.01));
    });

    it("settles the outgoing owner before an NFT transfer", async () => {
      const f = await deploy();
      const subId = await openSub(f);
      await time.increase(MONTH);

      // Receiving is a pull: the recipient caps the merchant, then accepts.
      await f.registry.connect(f.other).setSpendCap(f.merchant.address, USD(50), MONTH);

      const before = await f.qusdc.balanceOf(f.subscriber.address);
      await f.registry.connect(f.subscriber)
        .transferFrom(f.subscriber.address, f.other.address, BigInt(subId));
      await f.registry.connect(f.other).acceptSubscription(subId);

      // The seller pays what they owe; the buyer does not inherit the debt.
      expect(await f.qusdc.balanceOf(f.subscriber.address)).to.be.lt(before);
      expect(await f.registry.previewOwed(subId)).to.be.lessThanOrEqual(USD(0.01));
      expect(await f.registry.ownerOf(BigInt(subId))).to.equal(f.other.address);
    });
  });

  describe("merchant withdrawal KYC", () => {
    it("blocks an unverified merchant from withdrawing", async () => {
      const f = await deploy();
      await f.pass.registerIdentity(f.merchant.address, false);
      const subId = await openSub(f);
      await time.increase(MONTH);
      await expect(f.registry.connect(f.merchant).claimStream(subId))
        .to.be.revertedWith("Merchant must hold verified QIE Pass to withdraw");
    });

    it("can be disabled by the owner without a redeploy", async () => {
      const f = await deploy();
      await f.pass.registerIdentity(f.merchant.address, false);
      await f.registry.setRequireMerchantKyc(false);
      const subId = await openSub(f);
      await time.increase(MONTH);
      await expect(f.registry.connect(f.merchant).claimStream(subId)).to.not.be.reverted;
    });
  });
});
